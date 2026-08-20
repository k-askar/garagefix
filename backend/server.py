from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response
from fastapi.security import HTTPBearer
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

# --- DB ---
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# --- App ---
app = FastAPI(title="Garage Inventory API")
api_router = APIRouter(prefix="/api")

JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Password helpers ---
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access"
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# --- Models ---
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: Literal["owner", "staff"] = "staff"

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Supplier(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    contact: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    address: Optional[str] = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class SupplierCreate(BaseModel):
    name: str
    contact: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    address: Optional[str] = ""

class Customer(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    vehicle: Optional[str] = ""
    address: Optional[str] = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class CustomerCreate(BaseModel):
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    vehicle: Optional[str] = ""
    address: Optional[str] = ""

class InventoryItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sku: str
    barcode: str
    name: str
    category: str = "General"
    description: Optional[str] = ""
    cost_price: float = 0.0
    selling_price: float = 0.0
    quantity: int = 0
    reorder_point: int = 5
    unit: str = "pcs"
    supplier_id: Optional[str] = None
    location: Optional[str] = ""
    compatible_vehicles: Optional[str] = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class InventoryItemCreate(BaseModel):
    sku: Optional[str] = None
    barcode: Optional[str] = None
    name: str
    category: str = "General"
    description: Optional[str] = ""
    cost_price: float = 0.0
    selling_price: float = 0.0
    quantity: int = 0
    reorder_point: int = 5
    unit: str = "pcs"
    supplier_id: Optional[str] = None
    location: Optional[str] = ""
    compatible_vehicles: Optional[str] = ""

class InventoryItemUpdate(BaseModel):
    sku: Optional[str] = None
    barcode: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    cost_price: Optional[float] = None
    selling_price: Optional[float] = None
    quantity: Optional[int] = None
    reorder_point: Optional[int] = None
    unit: Optional[str] = None
    supplier_id: Optional[str] = None
    location: Optional[str] = None
    compatible_vehicles: Optional[str] = None

class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["IN", "OUT"]
    item_id: str
    item_name: str
    item_sku: str
    quantity: int
    unit_price: float
    total: float
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = ""
    customer_id: Optional[str] = None
    customer_name: Optional[str] = ""
    note: Optional[str] = ""
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class TransactionCreate(BaseModel):
    type: Literal["IN", "OUT"]
    item_id: str
    quantity: int = Field(gt=0)
    unit_price: float = Field(ge=0)
    supplier_id: Optional[str] = None
    customer_id: Optional[str] = None
    note: Optional[str] = ""

# --- Auth Routes ---
@api_router.post("/auth/register")
async def register(payload: UserRegister, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id, "email": email, "name": payload.name, "role": payload.role,
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, email, payload.role)
    return {"token": token, "user": {"id": user_id, "email": email, "name": payload.name, "role": payload.role}}

@api_router.post("/auth/login")
async def login(payload: UserLogin):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user["id"], user["email"], user["role"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

# --- Suppliers ---
@api_router.get("/suppliers", response_model=List[Supplier])
async def list_suppliers(user: dict = Depends(get_current_user)):
    rows = await db.suppliers.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return rows

@api_router.post("/suppliers", response_model=Supplier)
async def create_supplier(payload: SupplierCreate, user: dict = Depends(get_current_user)):
    obj = Supplier(**payload.model_dump())
    await db.suppliers.insert_one(obj.model_dump())
    return obj

@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, user: dict = Depends(get_current_user)):
    await db.suppliers.delete_one({"id": supplier_id})
    return {"ok": True}

# --- Customers ---
@api_router.get("/customers", response_model=List[Customer])
async def list_customers(user: dict = Depends(get_current_user)):
    rows = await db.customers.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return rows

@api_router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, user: dict = Depends(get_current_user)):
    obj = Customer(**payload.model_dump())
    await db.customers.insert_one(obj.model_dump())
    return obj

@api_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, user: dict = Depends(get_current_user)):
    await db.customers.delete_one({"id": customer_id})
    return {"ok": True}

# --- Inventory ---
def _generate_sku() -> str:
    return "SKU-" + uuid.uuid4().hex[:8].upper()

def _generate_barcode() -> str:
    # 12-digit numeric barcode string (Code128-safe)
    import random
    return "".join([str(random.randint(0, 9)) for _ in range(12)])

@api_router.get("/inventory", response_model=List[InventoryItem])
async def list_inventory(user: dict = Depends(get_current_user)):
    rows = await db.inventory.find({}, {"_id": 0}).sort("name", 1).to_list(2000)
    return rows

@api_router.get("/inventory/lookup")
async def lookup_inventory(code: str, user: dict = Depends(get_current_user)):
    item = await db.inventory.find_one({"$or": [{"barcode": code}, {"sku": code}]}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item

@api_router.get("/inventory/{item_id}", response_model=InventoryItem)
async def get_inventory(item_id: str, user: dict = Depends(get_current_user)):
    item = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item

@api_router.post("/inventory", response_model=InventoryItem)
async def create_inventory(payload: InventoryItemCreate, user: dict = Depends(get_current_user)):
    data = payload.model_dump()
    if not data.get("sku"):
        data["sku"] = _generate_sku()
    if not data.get("barcode"):
        data["barcode"] = _generate_barcode()
    if await db.inventory.find_one({"$or": [{"sku": data["sku"]}, {"barcode": data["barcode"]}]}):
        raise HTTPException(status_code=400, detail="SKU or barcode already exists")
    obj = InventoryItem(**data)
    await db.inventory.insert_one(obj.model_dump())
    return obj

@api_router.put("/inventory/{item_id}", response_model=InventoryItem)
async def update_inventory(item_id: str, payload: InventoryItemUpdate, user: dict = Depends(get_current_user)):
    existing = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.inventory.update_one({"id": item_id}, {"$set": updates})
    return await db.inventory.find_one({"id": item_id}, {"_id": 0})

@api_router.delete("/inventory/{item_id}")
async def delete_inventory(item_id: str, user: dict = Depends(get_current_user)):
    await db.inventory.delete_one({"id": item_id})
    return {"ok": True}

# --- Transactions ---
@api_router.get("/transactions", response_model=List[Transaction])
async def list_transactions(limit: int = 200, user: dict = Depends(get_current_user)):
    rows = await db.transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return rows

@api_router.post("/transactions", response_model=Transaction)
async def create_transaction(payload: TransactionCreate, user: dict = Depends(get_current_user)):
    item = await db.inventory.find_one({"id": payload.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if payload.type == "OUT" and payload.quantity > item["quantity"]:
        raise HTTPException(status_code=400, detail=f"Not enough stock. Available: {item['quantity']}")

    supplier_name = ""
    customer_name = ""
    if payload.supplier_id:
        s = await db.suppliers.find_one({"id": payload.supplier_id}, {"_id": 0})
        supplier_name = s["name"] if s else ""
    if payload.customer_id:
        c = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0})
        customer_name = c["name"] if c else ""

    txn = Transaction(
        type=payload.type,
        item_id=item["id"],
        item_name=item["name"],
        item_sku=item["sku"],
        quantity=payload.quantity,
        unit_price=payload.unit_price,
        total=round(payload.unit_price * payload.quantity, 2),
        supplier_id=payload.supplier_id,
        supplier_name=supplier_name,
        customer_id=payload.customer_id,
        customer_name=customer_name,
        note=payload.note or "",
        created_by=user.get("email", ""),
    )
    await db.transactions.insert_one(txn.model_dump())

    delta = payload.quantity if payload.type == "IN" else -payload.quantity
    new_qty = item["quantity"] + delta
    update_fields = {"quantity": new_qty, "updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.type == "IN":
        update_fields["cost_price"] = payload.unit_price
    await db.inventory.update_one({"id": item["id"]}, {"$set": update_fields})
    return txn

# --- Dashboard ---
@api_router.get("/dashboard/summary")
async def dashboard_summary(user: dict = Depends(get_current_user)):
    items = await db.inventory.find({}, {"_id": 0}).to_list(5000)
    total_stock_value = round(sum((i.get("cost_price", 0) * i.get("quantity", 0)) for i in items), 2)
    total_retail_value = round(sum((i.get("selling_price", 0) * i.get("quantity", 0)) for i in items), 2)
    total_items = len(items)
    total_units = sum(i.get("quantity", 0) for i in items)
    low_stock = [i for i in items if i.get("quantity", 0) <= i.get("reorder_point", 0)]
    out_of_stock = [i for i in items if i.get("quantity", 0) <= 0]

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    todays_txns = await db.transactions.find({"created_at": {"$gte": today_start}}, {"_id": 0}).to_list(1000)
    in_today = sum(t["total"] for t in todays_txns if t["type"] == "IN")
    out_today = sum(t["total"] for t in todays_txns if t["type"] == "OUT")

    # Top movers (last 30 days)
    thirty = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    recent = await db.transactions.find({"created_at": {"$gte": thirty}, "type": "OUT"}, {"_id": 0}).to_list(5000)
    movers = {}
    for t in recent:
        movers.setdefault(t["item_id"], {"name": t["item_name"], "sku": t["item_sku"], "qty": 0, "revenue": 0})
        movers[t["item_id"]]["qty"] += t["quantity"]
        movers[t["item_id"]]["revenue"] += t["total"]
    top_movers = sorted(movers.values(), key=lambda x: x["qty"], reverse=True)[:5]

    return {
        "total_stock_value": total_stock_value,
        "total_retail_value": total_retail_value,
        "total_items": total_items,
        "total_units": total_units,
        "low_stock_count": len(low_stock),
        "out_of_stock_count": len(out_of_stock),
        "low_stock_items": low_stock[:10],
        "in_today": round(in_today, 2),
        "out_today": round(out_today, 2),
        "todays_txn_count": len(todays_txns),
        "top_movers": top_movers,
    }

@api_router.get("/reports/movement")
async def report_movement(days: int = 14, user: dict = Depends(get_current_user)):
    start = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    txns = await db.transactions.find({"created_at": {"$gte": start}}, {"_id": 0}).to_list(10000)
    buckets = {}
    for i in range(days):
        d = (datetime.now(timezone.utc) - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        buckets[d] = {"date": d, "in": 0, "out": 0}
    for t in txns:
        d = t["created_at"][:10]
        if d in buckets:
            buckets[d]["in" if t["type"] == "IN" else "out"] += t["total"]
    return list(buckets.values())

@api_router.get("/")
async def root():
    return {"message": "Garage Inventory API"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.inventory.create_index("sku", unique=True)
    await db.inventory.create_index("barcode", unique=True)
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@garage.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Garage Owner",
            "role": "owner",
            "password_hash": hash_password(admin_password),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin user: {admin_email}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
