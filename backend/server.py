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

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, BackgroundTasks, Header
from fastapi.security import HTTPBearer
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict
import httpx, secrets, re, ipaddress
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

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

async def require_owner(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return user

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
    item_cost: float = 0.0
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = ""
    customer_id: Optional[str] = None
    customer_name: Optional[str] = ""
    note: Optional[str] = ""
    repair_id: Optional[str] = None
    invoice_id: Optional[str] = None
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
async def list_inventory(vehicle: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {}
    if vehicle:
        query["compatible_vehicles"] = {"$regex": vehicle, "$options": "i"}
    rows = await db.inventory.find(query, {"_id": 0}).sort("name", 1).to_list(2000)
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
async def update_inventory(item_id: str, payload: InventoryItemUpdate, user: dict = Depends(require_owner)):
    existing = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.inventory.update_one({"id": item_id}, {"$set": updates})
    return await db.inventory.find_one({"id": item_id}, {"_id": 0})

@api_router.delete("/inventory/{item_id}")
async def delete_inventory(item_id: str, user: dict = Depends(require_owner)):
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
        item_cost=float(item.get("cost_price") or 0),
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

# --- Users / Staff (owner only) ---
@api_router.get("/users")
async def list_users(user: dict = Depends(require_owner)):
    rows = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return rows

@api_router.post("/users")
async def create_user(payload: UserRegister, user: dict = Depends(require_owner)):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "email": email, "name": payload.name, "role": payload.role,
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(doc)
    return {"id": uid, "email": email, "name": payload.name, "role": payload.role, "created_at": doc["created_at"]}

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_owner)):
    if user["id"] == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    await db.users.delete_one({"id": user_id})
    return {"ok": True}

# --- Garage Settings ---
class GarageSettings(BaseModel):
    name: str = "PitStock Garage"
    address: str = ""
    phone: str = ""
    email: str = ""
    tax_id: str = ""
    footer_note: str = "Thank you for choosing us!"
    logo_url: str = "/logo-shawish.png"

@api_router.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0})
    if not s:
        s = GarageSettings().model_dump()
    return s

@api_router.put("/settings")
async def update_settings(payload: GarageSettings, user: dict = Depends(require_owner)):
    await db.settings.update_one({"_id": "garage"}, {"$set": payload.model_dump()}, upsert=True)
    return payload.model_dump()

# --- CSV Import ---
from fastapi import UploadFile, File
import csv, io

@api_router.post("/inventory/import")
async def import_inventory(file: UploadFile = File(...), user: dict = Depends(require_owner)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")
    raw = (await file.read()).decode("utf-8-sig", errors="ignore")
    reader = csv.DictReader(io.StringIO(raw))
    created, updated, errors = 0, 0, []
    for idx, row in enumerate(reader, start=2):
        try:
            name = (row.get("name") or "").strip()
            if not name:
                errors.append(f"Row {idx}: missing name")
                continue
            sku = (row.get("sku") or "").strip() or _generate_sku()
            barcode = (row.get("barcode") or "").strip() or _generate_barcode()
            data = {
                "sku": sku,
                "barcode": barcode,
                "name": name,
                "category": (row.get("category") or "General").strip() or "General",
                "description": (row.get("description") or "").strip(),
                "cost_price": float(row.get("cost_price") or 0),
                "selling_price": float(row.get("selling_price") or 0),
                "quantity": int(float(row.get("quantity") or 0)),
                "reorder_point": int(float(row.get("reorder_point") or 5)),
                "unit": (row.get("unit") or "pcs").strip() or "pcs",
                "location": (row.get("location") or "").strip(),
                "compatible_vehicles": (row.get("compatible_vehicles") or "").strip(),
            }
            existing = await db.inventory.find_one({"sku": sku}, {"_id": 0})
            if existing:
                data["updated_at"] = datetime.now(timezone.utc).isoformat()
                await db.inventory.update_one({"id": existing["id"]}, {"$set": data})
                updated += 1
            else:
                obj = InventoryItem(**data)
                await db.inventory.insert_one(obj.model_dump())
                created += 1
        except Exception as e:
            errors.append(f"Row {idx}: {str(e)}")
    return {"created": created, "updated": updated, "errors": errors[:20]}

# =========================
# Purchase Orders
# =========================
class POLine(BaseModel):
    item_id: str
    sku: str
    name: str
    quantity: int = Field(gt=0)
    unit_cost: float = Field(ge=0)

class PurchaseOrder(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    po_number: str
    supplier_id: Optional[str] = None
    supplier_name: str = ""
    items: List[POLine] = []
    status: Literal["draft", "sent", "received", "cancelled"] = "draft"
    total: float = 0.0
    note: Optional[str] = ""
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    sent_at: Optional[str] = None
    received_at: Optional[str] = None

class POCreate(BaseModel):
    supplier_id: Optional[str] = None
    items: List[POLine]
    note: Optional[str] = ""

def _next_number(prefix: str) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%y%m%d')}-{uuid.uuid4().hex[:4].upper()}"

@api_router.get("/purchase-orders", response_model=List[PurchaseOrder])
async def list_pos(user: dict = Depends(get_current_user)):
    return await db.purchase_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.get("/purchase-orders/suggest")
async def suggest_pos(user: dict = Depends(get_current_user)):
    items = await db.inventory.find({}, {"_id": 0}).to_list(5000)
    low = [i for i in items if i.get("quantity", 0) <= i.get("reorder_point", 0)]
    # group by supplier_id
    groups = {}
    for i in low:
        key = i.get("supplier_id") or "unassigned"
        groups.setdefault(key, {"supplier_id": i.get("supplier_id"), "supplier_name": "", "items": []})
        target_qty = max((i.get("reorder_point", 0) * 2) - i.get("quantity", 0), 1)
        groups[key]["items"].append({
            "item_id": i["id"], "sku": i["sku"], "name": i["name"],
            "quantity": target_qty, "unit_cost": float(i.get("cost_price") or 0),
        })
    # resolve supplier names
    sups = {s["id"]: s["name"] for s in await db.suppliers.find({}, {"_id": 0}).to_list(1000)}
    for k, g in groups.items():
        g["supplier_name"] = sups.get(g["supplier_id"] or "", "Unassigned")
        g["total"] = round(sum(l["quantity"] * l["unit_cost"] for l in g["items"]), 2)
    return list(groups.values())

@api_router.post("/purchase-orders", response_model=PurchaseOrder)
async def create_po(payload: POCreate, user: dict = Depends(require_owner)):
    supplier_name = ""
    if payload.supplier_id:
        s = await db.suppliers.find_one({"id": payload.supplier_id}, {"_id": 0})
        supplier_name = s["name"] if s else ""
    total = round(sum(l.quantity * l.unit_cost for l in payload.items), 2)
    po = PurchaseOrder(
        po_number=_next_number("PO"),
        supplier_id=payload.supplier_id,
        supplier_name=supplier_name,
        items=payload.items,
        total=total,
        note=payload.note or "",
        created_by=user.get("email", ""),
    )
    await db.purchase_orders.insert_one(po.model_dump())
    return po

@api_router.post("/purchase-orders/{po_id}/send")
async def send_po(po_id: str, user: dict = Depends(require_owner)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po["status"] != "draft":
        raise HTTPException(status_code=400, detail=f"PO is {po['status']}")
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}})
    return {"ok": True}

@api_router.post("/purchase-orders/{po_id}/receive")
async def receive_po(po_id: str, user: dict = Depends(require_owner)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po["status"] == "received":
        raise HTTPException(status_code=400, detail="Already received")
    now = datetime.now(timezone.utc).isoformat()
    for line in po["items"]:
        item = await db.inventory.find_one({"id": line["item_id"]}, {"_id": 0})
        if not item:
            continue
        txn = Transaction(
            type="IN",
            item_id=item["id"], item_name=item["name"], item_sku=item["sku"],
            quantity=line["quantity"], unit_price=line["unit_cost"],
            total=round(line["quantity"] * line["unit_cost"], 2),
            item_cost=line["unit_cost"],
            supplier_id=po.get("supplier_id"),
            supplier_name=po.get("supplier_name", ""),
            note=f"PO {po['po_number']}",
            created_by=user.get("email", ""),
        )
        await db.transactions.insert_one(txn.model_dump())
        await db.inventory.update_one({"id": item["id"]}, {"$set": {
            "quantity": item["quantity"] + line["quantity"],
            "cost_price": line["unit_cost"],
            "updated_at": now,
        }})
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {"status": "received", "received_at": now}})
    return {"ok": True}

@api_router.delete("/purchase-orders/{po_id}")
async def delete_po(po_id: str, user: dict = Depends(require_owner)):
    await db.purchase_orders.delete_one({"id": po_id})
    return {"ok": True}

# =========================
# Invoices
# =========================
class InvoiceLine(BaseModel):
    item_id: Optional[str] = None
    sku: str = ""
    name: str
    quantity: float = 1
    unit_price: float
    total: float

class Invoice(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    invoice_number: str
    customer_id: Optional[str] = None
    customer_name: str = ""
    lines: List[InvoiceLine] = []
    subtotal: float = 0.0
    tax: float = 0.0
    total: float = 0.0
    status: Literal["draft", "paid"] = "draft"
    note: Optional[str] = ""
    transaction_ids: List[str] = []
    repair_id: Optional[str] = None
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    paid_at: Optional[str] = None

class InvoiceFromTxns(BaseModel):
    customer_id: Optional[str] = None
    transaction_ids: List[str]
    tax_rate: float = 0.0
    note: Optional[str] = ""

@api_router.get("/invoices", response_model=List[Invoice])
async def list_invoices(user: dict = Depends(get_current_user)):
    return await db.invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.post("/invoices/from-transactions", response_model=Invoice)
async def invoice_from_txns(payload: InvoiceFromTxns, user: dict = Depends(get_current_user)):
    txns = await db.transactions.find({"id": {"$in": payload.transaction_ids}, "type": "OUT"}, {"_id": 0}).to_list(500)
    if not txns:
        raise HTTPException(status_code=400, detail="No OUT transactions found")
    lines = [InvoiceLine(item_id=t["item_id"], sku=t["item_sku"], name=t["item_name"],
                         quantity=t["quantity"], unit_price=t["unit_price"], total=t["total"]) for t in txns]
    subtotal = round(sum(l.total for l in lines), 2)
    tax = round(subtotal * (payload.tax_rate or 0) / 100, 2)
    total = round(subtotal + tax, 2)
    customer_name = ""
    if payload.customer_id:
        c = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0})
        customer_name = c["name"] if c else ""
    inv = Invoice(
        invoice_number=_next_number("INV"),
        customer_id=payload.customer_id,
        customer_name=customer_name,
        lines=lines, subtotal=subtotal, tax=tax, total=total,
        transaction_ids=payload.transaction_ids,
        note=payload.note or "",
        created_by=user.get("email", ""),
    )
    await db.invoices.insert_one(inv.model_dump())
    await db.transactions.update_many({"id": {"$in": payload.transaction_ids}}, {"$set": {"invoice_id": inv.id}})
    return inv

@api_router.post("/invoices/{inv_id}/mark-paid")
async def mark_paid(inv_id: str, user: dict = Depends(get_current_user)):
    r = await db.invoices.update_one({"id": inv_id}, {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return {"ok": True}

@api_router.delete("/invoices/{inv_id}")
async def delete_invoice(inv_id: str, user: dict = Depends(require_owner)):
    await db.invoices.delete_one({"id": inv_id})
    return {"ok": True}

@api_router.get("/customers/{cid}/balance")
async def customer_balance(cid: str, user: dict = Depends(get_current_user)):
    invs = await db.invoices.find({"customer_id": cid}, {"_id": 0}).to_list(500)
    unpaid = round(sum(i["total"] for i in invs if i["status"] != "paid"), 2)
    paid = round(sum(i["total"] for i in invs if i["status"] == "paid"), 2)
    return {"customer_id": cid, "unpaid": unpaid, "paid": paid, "invoice_count": len(invs)}

# =========================
# Repair Cards / Job Cards
# =========================
class PartUsed(BaseModel):
    txn_id: Optional[str] = None
    item_id: str
    sku: str
    name: str
    quantity: int = Field(gt=0)
    unit_price: float = Field(ge=0)
    total: float

class RepairCard(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    card_number: str
    customer_id: Optional[str] = None
    customer_name: str = ""
    customer_phone: str = ""
    car_make: str = ""
    car_model: str = ""
    car_year: str = ""
    car_plate: str = ""
    car_color: str = ""
    car_km: str = ""
    mechanic_id: Optional[str] = None
    mechanic_name: str = ""
    complaint: str = ""
    diagnosis: str = ""
    work_done: str = ""
    parts_used: List[PartUsed] = []
    labor_charge: float = 0.0
    parts_total: float = 0.0
    grand_total: float = 0.0
    status: Literal["open", "in_progress", "completed"] = "open"
    notes: str = ""
    invoice_id: Optional[str] = None
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    completed_at: Optional[str] = None
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class RepairCreate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: str = ""
    customer_phone: str = ""
    car_make: str = ""
    car_model: str = ""
    car_year: str = ""
    car_plate: str = ""
    car_color: str = ""
    car_km: str = ""
    mechanic_id: Optional[str] = None
    complaint: str = ""
    notes: str = ""

class RepairUpdate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    car_make: Optional[str] = None
    car_model: Optional[str] = None
    car_year: Optional[str] = None
    car_plate: Optional[str] = None
    car_color: Optional[str] = None
    car_km: Optional[str] = None
    mechanic_id: Optional[str] = None
    complaint: Optional[str] = None
    diagnosis: Optional[str] = None
    work_done: Optional[str] = None
    labor_charge: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[Literal["open", "in_progress", "completed"]] = None

class AddPart(BaseModel):
    item_id: str
    quantity: int = Field(gt=0)
    unit_price: Optional[float] = None  # defaults to item selling_price

def _recalc_repair(card: dict) -> dict:
    parts_total = round(sum(p["total"] for p in card.get("parts_used", [])), 2)
    grand = round(parts_total + float(card.get("labor_charge") or 0), 2)
    card["parts_total"] = parts_total
    card["grand_total"] = grand
    return card

@api_router.get("/repairs", response_model=List[RepairCard])
async def list_repairs(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    query = {"status": status} if status else {}
    return await db.repairs.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.get("/repairs/{rid}", response_model=RepairCard)
async def get_repair(rid: str, user: dict = Depends(get_current_user)):
    c = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Card not found")
    return c

@api_router.post("/repairs", response_model=RepairCard)
async def create_repair(payload: RepairCreate, user: dict = Depends(get_current_user)):
    customer_name = payload.customer_name or ""
    customer_phone = payload.customer_phone or ""
    if payload.customer_id:
        c = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0})
        if c:
            customer_name = c.get("name") or customer_name
            customer_phone = c.get("phone") or customer_phone
    mechanic_name = ""
    if payload.mechanic_id:
        m = await db.users.find_one({"id": payload.mechanic_id}, {"_id": 0})
        if m: mechanic_name = m.get("name") or m.get("email", "")
    card = RepairCard(
        card_number=_next_number("JOB"),
        customer_id=payload.customer_id,
        customer_name=customer_name,
        customer_phone=customer_phone,
        car_make=payload.car_make, car_model=payload.car_model, car_year=payload.car_year,
        car_plate=payload.car_plate, car_color=payload.car_color, car_km=payload.car_km,
        mechanic_id=payload.mechanic_id, mechanic_name=mechanic_name,
        complaint=payload.complaint, notes=payload.notes,
        created_by=user.get("email", ""),
    )
    await db.repairs.insert_one(card.model_dump())
    return card

@api_router.put("/repairs/{rid}", response_model=RepairCard)
async def update_repair(rid: str, payload: RepairUpdate, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "mechanic_id" in updates and updates["mechanic_id"]:
        m = await db.users.find_one({"id": updates["mechanic_id"]}, {"_id": 0})
        if m: updates["mechanic_name"] = m.get("name") or m.get("email", "")
    if updates.get("status") == "completed" and card.get("status") != "completed":
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Merge and recompute totals so labor_charge changes persist
    merged = {**card, **updates}
    merged = _recalc_repair(merged)
    updates["parts_total"] = merged["parts_total"]
    updates["grand_total"] = merged["grand_total"]
    await db.repairs.update_one({"id": rid}, {"$set": updates})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

@api_router.delete("/repairs/{rid}")
async def delete_repair(rid: str, user: dict = Depends(require_owner)):
    # restock any parts used
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if card:
        for p in card.get("parts_used", []):
            await db.inventory.update_one({"id": p["item_id"]}, {"$inc": {"quantity": p["quantity"]}})
        await db.transactions.delete_many({"repair_id": rid})
    await db.repairs.delete_one({"id": rid})
    return {"ok": True}

@api_router.post("/repairs/{rid}/parts", response_model=RepairCard)
async def add_part_to_repair(rid: str, payload: AddPart, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    item = await db.inventory.find_one({"id": payload.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if payload.quantity > item["quantity"]:
        raise HTTPException(status_code=400, detail=f"Not enough stock. Available: {item['quantity']}")
    unit_price = float(payload.unit_price) if payload.unit_price is not None else float(item.get("selling_price") or 0)
    total = round(unit_price * payload.quantity, 2)
    # OUT transaction
    txn = Transaction(
        type="OUT",
        item_id=item["id"], item_name=item["name"], item_sku=item["sku"],
        quantity=payload.quantity, unit_price=unit_price, total=total,
        item_cost=float(item.get("cost_price") or 0),
        customer_id=card.get("customer_id"),
        customer_name=card.get("customer_name", ""),
        note=f"Repair {card['card_number']}",
        repair_id=rid,
        created_by=user.get("email", ""),
    )
    await db.transactions.insert_one(txn.model_dump())
    await db.inventory.update_one({"id": item["id"]}, {"$set": {
        "quantity": item["quantity"] - payload.quantity,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    part = PartUsed(
        txn_id=txn.id, item_id=item["id"], sku=item["sku"], name=item["name"],
        quantity=payload.quantity, unit_price=unit_price, total=total,
    )
    card["parts_used"] = (card.get("parts_used") or []) + [part.model_dump()]
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "parts_used": card["parts_used"],
        "parts_total": card["parts_total"],
        "grand_total": card["grand_total"],
        "updated_at": card["updated_at"],
    }})
    return card

@api_router.delete("/repairs/{rid}/parts/{txn_id}", response_model=RepairCard)
async def remove_part_from_repair(rid: str, txn_id: str, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    parts = card.get("parts_used", [])
    target = next((p for p in parts if p.get("txn_id") == txn_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Part not on card")
    # restock
    await db.inventory.update_one({"id": target["item_id"]}, {"$inc": {"quantity": target["quantity"]}})
    await db.transactions.delete_one({"id": txn_id})
    parts = [p for p in parts if p.get("txn_id") != txn_id]
    card["parts_used"] = parts
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "parts_used": parts, "parts_total": card["parts_total"], "grand_total": card["grand_total"],
        "updated_at": card["updated_at"],
    }})
    return card

@api_router.post("/repairs/{rid}/invoice", response_model=Invoice)
async def invoice_repair(rid: str, tax_rate: float = 0.0, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    lines = [InvoiceLine(item_id=p["item_id"], sku=p["sku"], name=p["name"],
                         quantity=p["quantity"], unit_price=p["unit_price"], total=p["total"]) for p in card.get("parts_used", [])]
    if card.get("labor_charge", 0) > 0:
        lines.append(InvoiceLine(sku="LABOR", name=f"Labor · {card.get('work_done') or 'workshop time'}",
                                 quantity=1, unit_price=card["labor_charge"], total=card["labor_charge"]))
    subtotal = round(sum(l.total for l in lines), 2)
    tax = round(subtotal * (tax_rate or 0) / 100, 2)
    total = round(subtotal + tax, 2)
    inv = Invoice(
        invoice_number=_next_number("INV"),
        customer_id=card.get("customer_id"),
        customer_name=card.get("customer_name", ""),
        lines=lines, subtotal=subtotal, tax=tax, total=total,
        transaction_ids=[p["txn_id"] for p in card.get("parts_used", []) if p.get("txn_id")],
        note=f"Repair {card['card_number']} · {card.get('car_make','')} {card.get('car_model','')} {card.get('car_plate','')}".strip(),
        repair_id=rid,
        created_by=user.get("email", ""),
    )
    await db.invoices.insert_one(inv.model_dump())
    await db.repairs.update_one({"id": rid}, {"$set": {"invoice_id": inv.id, "status": "completed",
                                                       "completed_at": datetime.now(timezone.utc).isoformat()}})
    return inv

# =========================
# Profit Report
# =========================
@api_router.get("/reports/profit")
async def report_profit(start: Optional[str] = None, end: Optional[str] = None, user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    try:
        end_dt = datetime.fromisoformat(end).replace(tzinfo=timezone.utc) if end else now
        start_dt = datetime.fromisoformat(start).replace(tzinfo=timezone.utc) if start else (now - timedelta(days=30))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date. Use YYYY-MM-DD.")
    # inclusive end-of-day
    end_iso = end_dt.replace(hour=23, minute=59, second=59).isoformat()
    start_iso = start_dt.replace(hour=0, minute=0, second=0).isoformat()

    txns = await db.transactions.find({"type": "OUT", "created_at": {"$gte": start_iso, "$lte": end_iso}}, {"_id": 0}).to_list(20000)
    # snapshot current items to know category if txn didn't store it
    items_map = {i["id"]: i for i in await db.inventory.find({}, {"_id": 0}).to_list(5000)}

    by_item = {}
    by_cat = {}
    total_rev = total_cost = 0.0
    for t in txns:
        rev = float(t.get("total") or 0)
        cost_unit = float(t.get("item_cost") or 0)
        if cost_unit == 0:
            it = items_map.get(t["item_id"])
            cost_unit = float(it.get("cost_price") or 0) if it else 0
        cost = cost_unit * float(t.get("quantity") or 0)
        profit = rev - cost
        total_rev += rev; total_cost += cost
        key = t["item_id"]
        if key not in by_item:
            it = items_map.get(key, {})
            by_item[key] = {"item_id": key, "sku": t["item_sku"], "name": t["item_name"],
                            "category": it.get("category", "General"),
                            "qty_sold": 0, "revenue": 0, "cost": 0, "profit": 0}
        by_item[key]["qty_sold"] += t["quantity"]
        by_item[key]["revenue"] += rev
        by_item[key]["cost"] += cost
        by_item[key]["profit"] += profit
        cat = by_item[key]["category"]
        by_cat.setdefault(cat, {"category": cat, "revenue": 0, "cost": 0, "profit": 0, "qty_sold": 0})
        by_cat[cat]["revenue"] += rev
        by_cat[cat]["cost"] += cost
        by_cat[cat]["profit"] += profit
        by_cat[cat]["qty_sold"] += t["quantity"]

    def _round(d):
        for k in ("revenue", "cost", "profit"):
            if k in d: d[k] = round(d[k], 2)
        d["margin"] = round((d["profit"] / d["revenue"]) * 100, 2) if d.get("revenue") else 0
        return d

    items_list = sorted([_round(v) for v in by_item.values()], key=lambda x: -x["profit"])
    cat_list = sorted([_round(v) for v in by_cat.values()], key=lambda x: -x["profit"])
    return {
        "start": start_iso[:10], "end": end_iso[:10],
        "total_revenue": round(total_rev, 2),
        "total_cost": round(total_cost, 2),
        "total_profit": round(total_rev - total_cost, 2),
        "margin": round(((total_rev - total_cost) / total_rev) * 100, 2) if total_rev else 0,
        "txn_count": len(txns),
        "by_item": items_list,
        "by_category": cat_list,
    }

app.include_router(api_router)

# =========================
# Email (Resend managed proxy) + Service Reminders + Cash Register + Cron
# =========================
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "PitStock Garage")
WEBHOOK_CRON_SECRET = os.environ.get("WEBHOOK_CRON_SECRET", "")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "seed phrase", "recovery phrase", "verify your card", "social security number")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)

def _host_ok(h):
    if not h or "xn--" in h: return False
    try: ipaddress.ip_address(h); return False
    except ValueError: pass
    return not any(h == s or h.endswith("." + s) for s in _SHORTENERS)

class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__(); self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []
    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href"); self._text = []
    def handle_data(self, data):
        if self._href is not None: self._text.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text))); self._href, self._text = None, []

def _assert_safe_email(subject, html):
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}: raise ValueError("No forms in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body: raise ValueError(f"Credential ask: {p} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")): continue
        if not low.startswith("https://"): raise ValueError(f"Non-https: {url} (G3)")
        h = urlparse(low).hostname or ""
        if not _host_ok(h) or urlparse(low).username is not None:
            raise ValueError(f"Unsafe URL: {url} (G3)")

async def send_email(*, to, subject, html):
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        r.raise_for_status()
        return r.json().get("id")
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        raise HTTPException(status_code=502, detail="Failed to send email")

# --- Reminders ---
class Reminder(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customer_id: str
    customer_name: str = ""
    customer_email: str = ""
    car_plate: str = ""
    car_make: str = ""
    car_model: str = ""
    reason: str = "Scheduled service"
    due_date: str  # ISO date
    due_km: Optional[int] = None
    last_service_km: Optional[int] = None
    status: Literal["pending", "sent", "cancelled"] = "pending"
    channel: Literal["email"] = "email"
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    sent_at: Optional[str] = None

class ReminderCreate(BaseModel):
    customer_id: str
    reason: str = "Scheduled service"
    due_date: str
    due_km: Optional[int] = None
    last_service_km: Optional[int] = None
    car_plate: str = ""
    car_make: str = ""
    car_model: str = ""

def _reminder_html(rem, garage_name):
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;'
            f'font-family:Arial,sans-serif;color:#111;max-width:560px">'
            f'<h2 style="margin:0 0 12px">Service reminder from {escape(garage_name)}</h2>'
            f'<p>Hi {escape(rem.get("customer_name") or "there")},</p>'
            f'<p>Your <strong>{escape((rem.get("car_make") or "") + " " + (rem.get("car_model") or ""))}</strong>'
            f'{" (" + escape(rem["car_plate"]) + ")" if rem.get("car_plate") else ""} '
            f'is due for <strong>{escape(rem.get("reason") or "service")}</strong> on '
            f'<strong>{escape(rem["due_date"])}</strong>'
            f'{" or at " + str(rem["due_km"]) + " km" if rem.get("due_km") else ""}.</p>'
            f'<p>Give us a call to book a slot that suits you.</p>'
            f'<p style="font-size:12px;color:#888;margin-top:24px">Sent by {escape(garage_name)}. '
            f'We never ask for your password or card details by email.</p>'
            f'</td></tr></table>')

async def _send_reminder(rem_id: str):
    rem = await db.reminders.find_one({"id": rem_id}, {"_id": 0})
    if not rem or rem["status"] != "pending":
        return
    if not rem.get("customer_email"):
        await db.reminders.update_one({"id": rem_id}, {"$set": {"status": "cancelled"}})
        return
    settings = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    garage_name = settings.get("name") or "PitStock Garage"
    html = _reminder_html(rem, garage_name)
    try:
        await send_email(to=rem["customer_email"],
                         subject=f"Service reminder — {rem.get('reason') or 'workshop visit'}",
                         html=html)
        await db.reminders.update_one({"id": rem_id}, {"$set": {"status": "sent",
                                                                "sent_at": datetime.now(timezone.utc).isoformat()}})
    except Exception as e:
        logger.error(f"reminder send failed: {e}")

@api_router.get("/reminders", response_model=List[Reminder])
async def list_reminders(user: dict = Depends(get_current_user)):
    return await db.reminders.find({}, {"_id": 0}).sort("due_date", 1).to_list(500)

@api_router.post("/reminders", response_model=Reminder)
async def create_reminder(payload: ReminderCreate, user: dict = Depends(get_current_user)):
    c = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    rem = Reminder(**payload.model_dump(),
                   customer_name=c.get("name", ""), customer_email=c.get("email", ""),
                   created_by=user.get("email", ""))
    await db.reminders.insert_one(rem.model_dump())
    return rem

@api_router.post("/reminders/{rid}/send")
async def send_reminder_now(rid: str, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    rem = await db.reminders.find_one({"id": rid}, {"_id": 0})
    if not rem:
        raise HTTPException(status_code=404, detail="Not found")
    if not rem.get("customer_email"):
        raise HTTPException(status_code=400, detail="Customer has no email on file")
    background.add_task(_send_reminder, rid)
    return {"ok": True}

@api_router.delete("/reminders/{rid}")
async def delete_reminder(rid: str, user: dict = Depends(get_current_user)):
    await db.reminders.delete_one({"id": rid})
    return {"ok": True}

# --- Cash Register / Daily Till ---
@api_router.get("/cash-register")
async def cash_register(date: Optional[str] = None, user: dict = Depends(get_current_user)):
    d = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start = d + "T00:00:00+00:00"
    end = d + "T23:59:59+00:00"
    invs = await db.invoices.find({"paid_at": {"$gte": start, "$lte": end}, "status": "paid"}, {"_id": 0}).to_list(2000)
    txns = await db.transactions.find({"created_at": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    in_total = round(sum(t["total"] for t in txns if t["type"] == "IN"), 2)
    out_total = round(sum(t["total"] for t in txns if t["type"] == "OUT"), 2)
    revenue = round(sum(i["total"] for i in invs), 2)
    tax = round(sum(i.get("tax", 0) for i in invs), 2)
    by_customer = {}
    for i in invs:
        k = i.get("customer_name") or "Walk-in"
        by_customer.setdefault(k, {"customer": k, "count": 0, "total": 0})
        by_customer[k]["count"] += 1
        by_customer[k]["total"] += i["total"]
    for v in by_customer.values(): v["total"] = round(v["total"], 2)
    return {
        "date": d,
        "invoice_count": len(invs),
        "revenue": revenue,
        "tax": tax,
        "in_total": in_total,
        "out_total": out_total,
        "net_flow": round(revenue - in_total, 2),
        "by_customer": sorted(by_customer.values(), key=lambda x: -x["total"]),
        "invoices": sorted(invs, key=lambda i: i.get("paid_at", "")),
    }

# --- Cron endpoint (daily reminders sweep) ---
@api_router.post("/cron/reminders")
async def cron_reminders(background: BackgroundTasks, authorization: Optional[str] = Header(default=None)):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer")
    token = authorization[7:]
    if not secrets.compare_digest(token, WEBHOOK_CRON_SECRET or ""):
        raise HTTPException(status_code=401, detail="Bad token")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    due = await db.reminders.find({"status": "pending", "due_date": {"$lte": today}}, {"_id": 0}).to_list(500)
    for r in due:
        background.add_task(_send_reminder, r["id"])
    return {"queued": len(due)}

# Re-include the router now that new routes have been declared.
app.router.routes = [r for r in app.router.routes if not (getattr(r, 'path', '') or '').startswith('/api')]
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
