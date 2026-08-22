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
    token = auth_header[7:] if auth_header.startswith("Bearer ") else (
        request.query_params.get("auth") or request.cookies.get("access_token")
    )
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

class Vehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customer_id: str
    make: str = ""
    model: str = ""
    year: str = ""
    plate: str = ""
    color: str = ""
    vin: str = ""
    km: str = ""
    notes: Optional[str] = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class VehicleCreate(BaseModel):
    make: str = ""
    model: str = ""
    year: str = ""
    plate: str = ""
    color: str = ""
    vin: str = ""
    km: str = ""
    notes: Optional[str] = ""

class VehicleUpdate(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[str] = None
    plate: Optional[str] = None
    color: Optional[str] = None
    vin: Optional[str] = None
    km: Optional[str] = None
    notes: Optional[str] = None

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

class MarkPaidPayload(BaseModel):
    payment_method_id: Optional[str] = None

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
    await db.vehicles.delete_many({"customer_id": customer_id})
    return {"ok": True}

# --- Vehicles (linked to customers) ---
@api_router.get("/customers/{cid}/vehicles", response_model=List[Vehicle])
async def list_customer_vehicles(cid: str, user: dict = Depends(get_current_user)):
    return await db.vehicles.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(200)

@api_router.post("/customers/{cid}/vehicles", response_model=Vehicle)
async def add_customer_vehicle(cid: str, payload: VehicleCreate, user: dict = Depends(get_current_user)):
    c = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    obj = Vehicle(customer_id=cid, **payload.model_dump())
    await db.vehicles.insert_one(obj.model_dump())
    return obj

@api_router.put("/vehicles/{vid}", response_model=Vehicle)
async def update_vehicle(vid: str, payload: VehicleUpdate, user: dict = Depends(get_current_user)):
    existing = await db.vehicles.find_one({"id": vid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.vehicles.update_one({"id": vid}, {"$set": updates})
    return await db.vehicles.find_one({"id": vid}, {"_id": 0})

@api_router.delete("/vehicles/{vid}")
async def delete_vehicle(vid: str, user: dict = Depends(get_current_user)):
    await db.vehicles.delete_one({"id": vid})
    return {"ok": True}

# =========================
# Appointments (calendar)
# =========================
class Appointment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customer_id: Optional[str] = None
    customer_name: str = ""
    vehicle_id: Optional[str] = None
    vehicle_label: str = ""
    car_plate: str = ""
    mechanic_id: Optional[str] = None
    mechanic_name: str = ""
    scheduled_at: str  # ISO datetime
    duration_min: int = 60
    service_type: str = "General service"
    notes: str = ""
    status: Literal["scheduled", "confirmed", "in_service", "completed", "cancelled"] = "scheduled"
    repair_id: Optional[str] = None
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class AppointmentCreate(BaseModel):
    customer_id: Optional[str] = None
    vehicle_id: Optional[str] = None
    mechanic_id: Optional[str] = None
    scheduled_at: str
    duration_min: int = 60
    service_type: str = "General service"
    notes: str = ""

class AppointmentUpdate(BaseModel):
    customer_id: Optional[str] = None
    vehicle_id: Optional[str] = None
    mechanic_id: Optional[str] = None
    scheduled_at: Optional[str] = None
    duration_min: Optional[int] = None
    service_type: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[Literal["scheduled", "confirmed", "in_service", "completed", "cancelled"]] = None

async def _resolve_appointment_meta(customer_id, vehicle_id, mechanic_id):
    cust = veh = mech = None
    if customer_id:
        cust = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if vehicle_id:
        veh = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if mechanic_id:
        mech = await db.users.find_one({"id": mechanic_id}, {"_id": 0})
    return cust, veh, mech

@api_router.get("/appointments", response_model=List[Appointment])
async def list_appointments(start: Optional[str] = None, end: Optional[str] = None,
                             user: dict = Depends(get_current_user)):
    q = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        q["scheduled_at"] = rng
    return await db.appointments.find(q, {"_id": 0}).sort("scheduled_at", 1).to_list(2000)

@api_router.post("/appointments", response_model=Appointment)
async def create_appointment(payload: AppointmentCreate, user: dict = Depends(get_current_user)):
    try:
        datetime.fromisoformat(payload.scheduled_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at datetime")
    cust, veh, mech = await _resolve_appointment_meta(payload.customer_id, payload.vehicle_id, payload.mechanic_id)
    veh_label = ""
    if veh:
        veh_label = " ".join(str(x) for x in [veh.get("make"), veh.get("model"), veh.get("year")] if x).strip()
    obj = Appointment(
        customer_id=payload.customer_id,
        customer_name=cust.get("name", "") if cust else "",
        vehicle_id=payload.vehicle_id,
        vehicle_label=veh_label,
        car_plate=veh.get("plate", "") if veh else "",
        mechanic_id=payload.mechanic_id,
        mechanic_name=(mech.get("name") or mech.get("email", "")) if mech else "",
        scheduled_at=payload.scheduled_at,
        duration_min=payload.duration_min or 60,
        service_type=payload.service_type or "General service",
        notes=payload.notes or "",
        created_by=user.get("email", ""),
    )
    await db.appointments.insert_one(obj.model_dump())
    return obj

@api_router.put("/appointments/{aid}", response_model=Appointment)
async def update_appointment(aid: str, payload: AppointmentUpdate, user: dict = Depends(get_current_user)):
    existing = await db.appointments.find_one({"id": aid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Appointment not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if any(k in updates for k in ("customer_id", "vehicle_id", "mechanic_id")):
        cust, veh, mech = await _resolve_appointment_meta(
            updates.get("customer_id", existing.get("customer_id")),
            updates.get("vehicle_id", existing.get("vehicle_id")),
            updates.get("mechanic_id", existing.get("mechanic_id")),
        )
        if "customer_id" in updates:
            updates["customer_name"] = cust.get("name", "") if cust else ""
        if "vehicle_id" in updates and veh:
            updates["vehicle_label"] = " ".join(str(x) for x in [veh.get("make"), veh.get("model"), veh.get("year")] if x).strip()
            updates["car_plate"] = veh.get("plate", "")
        if "mechanic_id" in updates:
            updates["mechanic_name"] = (mech.get("name") or mech.get("email", "")) if mech else ""
    if updates:
        await db.appointments.update_one({"id": aid}, {"$set": updates})
    return await db.appointments.find_one({"id": aid}, {"_id": 0})

@api_router.delete("/appointments/{aid}")
async def delete_appointment(aid: str, user: dict = Depends(get_current_user)):
    await db.appointments.delete_one({"id": aid})
    return {"ok": True}

@api_router.post("/appointments/{aid}/convert")
async def convert_appointment_to_repair(aid: str, user: dict = Depends(get_current_user)):
    appt = await db.appointments.find_one({"id": aid}, {"_id": 0})
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt.get("repair_id"):
        existing = await db.repairs.find_one({"id": appt["repair_id"]}, {"_id": 0})
        if existing:
            return existing
    veh = await db.vehicles.find_one({"id": appt["vehicle_id"]}, {"_id": 0}) if appt.get("vehicle_id") else None
    cust = await db.customers.find_one({"id": appt["customer_id"]}, {"_id": 0}) if appt.get("customer_id") else None
    card = RepairCard(
        card_number=_next_number("JOB"),
        customer_id=appt.get("customer_id"),
        customer_name=cust.get("name", "") if cust else appt.get("customer_name", ""),
        customer_phone=cust.get("phone", "") if cust else "",
        vehicle_id=appt.get("vehicle_id"),
        car_make=veh.get("make", "") if veh else "",
        car_model=veh.get("model", "") if veh else "",
        car_year=veh.get("year", "") if veh else "",
        car_plate=veh.get("plate", "") if veh else appt.get("car_plate", ""),
        car_color=veh.get("color", "") if veh else "",
        car_km=veh.get("km", "") if veh else "",
        mechanic_id=appt.get("mechanic_id"),
        mechanic_name=appt.get("mechanic_name", ""),
        complaint=f"{appt.get('service_type','')}{(' — ' + appt['notes']) if appt.get('notes') else ''}",
        created_by=user.get("email", ""),
    )
    await db.repairs.insert_one(card.model_dump())
    await db.appointments.update_one({"id": aid}, {"$set": {"repair_id": card.id, "status": "in_service"}})
    return card.model_dump()

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

    # Open repair cards (in workshop right now)
    open_cards_raw = await db.repairs.find(
        {"status": {"$in": ["open", "in_progress"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    now = datetime.now(timezone.utc)
    open_cars = []
    total_mech_minutes = 0.0
    for c in open_cards_raw:
        try:
            created = datetime.fromisoformat(c["created_at"].replace("Z", "+00:00"))
            hours_in_shop = round((now - created).total_seconds() / 3600.0, 1)
        except Exception:
            hours_in_shop = 0
        # cover photo = first photo path
        cover = None
        if c.get("photos"):
            cover = c["photos"][0].get("id")
        open_cars.append({
            "id": c["id"],
            "card_number": c["card_number"],
            "customer_name": c.get("customer_name") or "Walk-in",
            "car_make": c.get("car_make", ""),
            "car_model": c.get("car_model", ""),
            "car_plate": c.get("car_plate", ""),
            "car_year": c.get("car_year", ""),
            "mechanic_name": c.get("mechanic_name", ""),
            "status": c.get("status"),
            "grand_total": c.get("grand_total", 0),
            "hours_in_shop": hours_in_shop,
            "cover_photo_id": cover,
            "parts_count": len(c.get("parts_used") or []),
        })
        total_mech_minutes += float(c.get("labor_minutes") or 0)

    # Weekly / monthly revenue (paid invoices)
    now_iso = now.isoformat()
    week_start = (now - timedelta(days=7)).isoformat()
    month_start = (now - timedelta(days=30)).isoformat()
    week_invs = await db.invoices.find({"status": "paid", "paid_at": {"$gte": week_start, "$lte": now_iso}}, {"_id": 0, "total": 1}).to_list(2000)
    month_invs = await db.invoices.find({"status": "paid", "paid_at": {"$gte": month_start, "$lte": now_iso}}, {"_id": 0, "total": 1}).to_list(5000)
    revenue_week = round(sum(i["total"] for i in week_invs), 2)
    revenue_month = round(sum(i["total"] for i in month_invs), 2)

    # Today's mechanic-hours (all completed time logs today)
    today_iso_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    all_cards = await db.repairs.find({}, {"_id": 0, "time_logs": 1, "mechanic_name": 1}).to_list(5000)
    today_minutes = 0.0
    by_mech = {}
    for c in all_cards:
        for l in (c.get("time_logs") or []):
            if l.get("stopped_at") and (l.get("stopped_at", "") >= today_iso_start):
                m = float(l.get("minutes") or 0)
                today_minutes += m
                name = l.get("mechanic_name") or c.get("mechanic_name") or "—"
                by_mech[name] = by_mech.get(name, 0) + m
    mechanic_hours_today = [
        {"name": k, "hours": round(v / 60.0, 2)} for k, v in sorted(by_mech.items(), key=lambda x: -x[1])
    ]

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
        "open_cars": open_cars,
        "open_cars_count": len(open_cars),
        "revenue_today": round(sum(i.get("total", 0) for i in await db.invoices.find({"status": "paid", "paid_at": {"$gte": today_iso_start}}, {"_id": 0, "total": 1}).to_list(1000)), 2),
        "revenue_week": revenue_week,
        "revenue_month": revenue_month,
        "mechanic_hours_today": mechanic_hours_today,
        "mechanic_minutes_today": round(today_minutes, 1),
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
    labor_rate: float = 45.0  # € per hour used to auto-fill labor charge from time logs
    default_tax_rate: float = 21.0  # BTW / VAT %  (NL standard 21, reduced 9)
    # --- Invoice branding ---
    invoice_accent_color: str = "#0EA5E9"       # hex used for header rule + "PAID" pill background
    invoice_prefix: str = "INV"                 # invoice number prefix, e.g. INV / FACT / 2026-
    payment_terms_days: int = 14                # 14 / 21 / 30 / 45 — used to compute due_date + overdue reminders
    iban: str = ""                              # bank IBAN shown on invoice footer
    kvk_number: str = ""                        # Chamber-of-Commerce (KvK) number for NL businesses
    invoice_terms: str = ""                     # multi-line payment / warranty terms
    show_plate_badge: bool = True               # render yellow NL plate on the invoice

@api_router.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0})
    defaults = GarageSettings().model_dump()
    if not s:
        return defaults
    # Fill in any missing default keys (e.g. labor_rate on legacy docs)
    return {**defaults, **s}

@api_router.put("/settings")
async def update_settings(payload: GarageSettings, user: dict = Depends(require_owner)):
    await db.settings.update_one({"_id": "garage"}, {"$set": payload.model_dump()}, upsert=True)
    return payload.model_dump()

from fastapi import UploadFile, File

@api_router.post("/settings/logo")
async def upload_settings_logo(file: UploadFile = File(...), user: dict = Depends(require_owner)):
    """Upload a garage logo to Emergent Object Storage and save its public URL on settings."""
    from backup import _put_object
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are supported")
    data = await file.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Logo too large (max 3 MB)")
    ext = (file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "png").lower()
    pid = str(uuid.uuid4())
    path = f"pitstock/logos/{pid}.{ext}"
    try:
        result = _put_object(path, data, file.content_type)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Storage error: {str(e)[:200]}")
    # We save the storage path — the frontend reads it as /api/settings/logo/{storage_path}
    logo_ref = f"/api/settings/logo-file?path={result['path']}"
    await db.settings.update_one({"_id": "garage"}, {"$set": {"logo_url": logo_ref}}, upsert=True)
    return {"logo_url": logo_ref}

@api_router.get("/settings/logo-file")
async def download_settings_logo(path: str, user: dict = Depends(get_current_user)):
    from backup import _get_object
    try:
        data = _get_object(path)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Logo not found: {str(e)[:120]}")
    # Best-effort content type from extension
    ct = "image/png"
    if path.lower().endswith((".jpg", ".jpeg")): ct = "image/jpeg"
    elif path.lower().endswith(".webp"): ct = "image/webp"
    elif path.lower().endswith(".svg"): ct = "image/svg+xml"
    return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=3600"})

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
    payment_method_id: Optional[str] = None
    payment_method_name: Optional[str] = ""
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
async def receive_po(po_id: str, payload: MarkPaidPayload = MarkPaidPayload(), user: dict = Depends(require_owner)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po["status"] == "received":
        raise HTTPException(status_code=400, detail="Already received")
    # Validate payment method up-front to avoid partial inventory writes
    method = None
    if payload.payment_method_id:
        method = await db.payment_methods.find_one({"id": payload.payment_method_id}, {"_id": 0})
        if not method:
            raise HTTPException(status_code=404, detail="Payment method not found")
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
    update = {"status": "received", "received_at": now}
    if method:
        update["payment_method_id"] = payload.payment_method_id
        update["payment_method_name"] = method.get("name", "")
        await _log_payment(
            method_id=payload.payment_method_id, direction="out",
            amount=float(po.get("total") or 0), reference_type="po",
            reference_id=po_id, reference_no=po.get("po_number", ""),
            counterpart=po.get("supplier_name", "") or "Supplier",
            note=f"PO payment",
            created_by=user.get("email", ""),
        )
    await db.purchase_orders.update_one({"id": po_id}, {"$set": update})
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
    payment_method_id: Optional[str] = None
    payment_method_name: Optional[str] = ""
    payment_terms_days: int = 14
    due_date: Optional[str] = None              # YYYY-MM-DD — created_at + payment_terms_days
    reminder_sent_at: Optional[str] = None
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

@api_router.get("/invoices/overdue")
async def list_overdue_invoices(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = await db.invoices.find({
        "status": {"$ne": "paid"},
        "due_date": {"$ne": None, "$lt": today},
    }, {"_id": 0}).sort("due_date", 1).to_list(1000)
    for r in rows:
        try:
            r["days_overdue"] = (datetime.now(timezone.utc).date() - datetime.strptime(r["due_date"], "%Y-%m-%d").date()).days
        except Exception:
            r["days_overdue"] = 0
    return rows

def _overdue_email_html(inv, garage_name, iban):
    days = inv.get("days_overdue", 0)
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;'
            f'font-family:Arial,sans-serif;color:#111;max-width:560px">'
            f'<h2 style="margin:0 0 12px">Payment overdue — {escape(inv["invoice_number"])}</h2>'
            f'<p>Hi {escape(inv.get("customer_name") or "there")},</p>'
            f'<p>Our records show invoice <strong>{escape(inv["invoice_number"])}</strong> for '
            f'<strong>{inv["total"]:.2f} €</strong> was due on <strong>{escape(inv.get("due_date") or "")}</strong> '
            f'and is now <strong>{days} day{"s" if days != 1 else ""} overdue</strong>.</p>'
            f'<p>Please settle at your earliest convenience'
            f'{" — bank transfer to <strong>" + escape(iban) + "</strong>" if iban else ""}. '
            f'If you have already paid, kindly ignore this reminder.</p>'
            f'<p style="font-size:12px;color:#888;margin-top:24px">Sent by {escape(garage_name)}.</p>'
            f'</td></tr></table>')

async def _send_overdue_email(inv):
    if not inv.get("customer_id"):
        return False
    c = await db.customers.find_one({"id": inv["customer_id"]}, {"_id": 0})
    if not c or not c.get("email"):
        return False
    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    garage_name = s.get("name") or "PitStock Garage"
    iban = s.get("iban") or ""
    html = _overdue_email_html(inv, garage_name, iban)
    try:
        await send_email(to=c["email"],
                         subject=f"Payment overdue — invoice {inv['invoice_number']}",
                         html=html)
        await db.invoices.update_one({"id": inv["id"]}, {"$set": {"reminder_sent_at": datetime.now(timezone.utc).isoformat()}})
        return True
    except Exception as e:
        logger.error(f"overdue email failed for {inv['invoice_number']}: {e}")
        return False

@api_router.post("/invoices/overdue/send-reminders")
async def send_overdue_reminders(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = await db.invoices.find({
        "status": {"$ne": "paid"},
        "due_date": {"$ne": None, "$lt": today},
    }, {"_id": 0}).to_list(1000)
    sent = 0
    for r in rows:
        try:
            r["days_overdue"] = (datetime.now(timezone.utc).date() - datetime.strptime(r["due_date"], "%Y-%m-%d").date()).days
        except Exception:
            r["days_overdue"] = 0
        if await _send_overdue_email(r):
            sent += 1
    return {"checked": len(rows), "sent": sent, "skipped_no_email": len(rows) - sent}

@api_router.post("/cron/overdue-invoices")
async def cron_overdue_invoices(background: BackgroundTasks, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer")
    if not secrets.compare_digest(authorization[7:], WEBHOOK_CRON_SECRET or ""):
        raise HTTPException(status_code=401, detail="Bad token")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = await db.invoices.find({
        "status": {"$ne": "paid"},
        "due_date": {"$ne": None, "$lt": today},
        "$or": [{"reminder_sent_at": None},
                {"reminder_sent_at": {"$lt": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}}],
    }, {"_id": 0}).to_list(1000)

    async def _run():
        for r in rows:
            try:
                r["days_overdue"] = (datetime.now(timezone.utc).date() - datetime.strptime(r["due_date"], "%Y-%m-%d").date()).days
            except Exception:
                r["days_overdue"] = 0
            await _send_overdue_email(r)

    background.add_task(_run)
    return {"queued": len(rows)}

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
    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    terms = int(s.get("payment_terms_days") or 14)
    inv = Invoice(
        invoice_number=_next_number("INV"),
        customer_id=payload.customer_id,
        customer_name=customer_name,
        lines=lines, subtotal=subtotal, tax=tax, total=total,
        transaction_ids=payload.transaction_ids,
        note=payload.note or "",
        payment_terms_days=terms,
        due_date=(datetime.now(timezone.utc) + timedelta(days=terms)).strftime("%Y-%m-%d"),
        created_by=user.get("email", ""),
    )
    await db.invoices.insert_one(inv.model_dump())
    await db.transactions.update_many({"id": {"$in": payload.transaction_ids}}, {"$set": {"invoice_id": inv.id}})
    return inv

@api_router.post("/invoices/{inv_id}/mark-paid")
async def mark_paid(inv_id: str, payload: MarkPaidPayload = MarkPaidPayload(), user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")
    update = {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}
    method_name = ""
    if payload.payment_method_id:
        m = await db.payment_methods.find_one({"id": payload.payment_method_id}, {"_id": 0})
        if not m:
            raise HTTPException(status_code=404, detail="Payment method not found")
        method_name = m.get("name", "")
        update["payment_method_id"] = payload.payment_method_id
        update["payment_method_name"] = method_name
        await _log_payment(
            method_id=payload.payment_method_id, direction="in",
            amount=float(inv.get("total") or 0), reference_type="invoice",
            reference_id=inv_id, reference_no=inv.get("invoice_number", ""),
            counterpart=inv.get("customer_name", "") or "Walk-in",
            note=f"Invoice payment",
            created_by=user.get("email", ""),
        )
    await db.invoices.update_one({"id": inv_id}, {"$set": update})
    return {"ok": True, "payment_method": method_name}

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

@api_router.get("/customers/{cid}/history")
async def customer_history(cid: str, user: dict = Depends(get_current_user)):
    customer = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    vehicles = await db.vehicles.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    repairs = await db.repairs.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    invoices = await db.invoices.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    txns = await db.transactions.find({"customer_id": cid, "type": "OUT"}, {"_id": 0}).sort("created_at", -1).to_list(2000)

    total_parts = round(sum((r.get("parts_total") or 0) for r in repairs), 2)
    total_labor = round(sum((r.get("labor_charge") or 0) for r in repairs), 2)
    total_spent = round(sum((r.get("grand_total") or 0) for r in repairs), 2)
    unpaid = round(sum(i["total"] for i in invoices if i["status"] != "paid"), 2)
    paid = round(sum(i["total"] for i in invoices if i["status"] == "paid"), 2)
    first_visit = repairs[-1]["created_at"] if repairs else None
    last_visit = repairs[0]["created_at"] if repairs else None

    # --- Group repairs by vehicle ---
    # Build a lookup by normalized plate (case-insensitive, whitespace-trimmed)
    def _plate_key(s: str) -> str:
        return (s or "").strip().upper()

    vehicle_map = {}
    for v in vehicles:
        key = _plate_key(v.get("plate"))
        vehicle_map[v["id"]] = {"vehicle": v, "plate_key": key, "repairs": []}
    plate_index = {v["plate_key"]: v["vehicle"]["id"] for v in vehicle_map.values() if v["plate_key"]}

    orphan_groups = {}  # keyed by plate string when no explicit vehicle record
    for r in repairs:
        vid = r.get("vehicle_id")
        matched = None
        if vid and vid in vehicle_map:
            matched = vid
        else:
            pk = _plate_key(r.get("car_plate"))
            if pk and pk in plate_index:
                matched = plate_index[pk]
        if matched:
            vehicle_map[matched]["repairs"].append(r)
        else:
            key = _plate_key(r.get("car_plate")) or f"__no_plate_{r.get('car_make','')}_{r.get('car_model','')}"
            if key not in orphan_groups:
                orphan_groups[key] = {
                    "vehicle": {
                        "id": None,
                        "customer_id": cid,
                        "make": r.get("car_make", ""),
                        "model": r.get("car_model", ""),
                        "year": r.get("car_year", ""),
                        "plate": r.get("car_plate", ""),
                        "color": r.get("car_color", ""),
                        "km": r.get("car_km", ""),
                        "notes": "",
                        "created_at": r.get("created_at", ""),
                    },
                    "repairs": [],
                }
            orphan_groups[key]["repairs"].append(r)

    def _vehicle_stats(group):
        rs = group["repairs"]
        return {
            "vehicle": group["vehicle"],
            "repair_count": len(rs),
            "total_spent": round(sum((x.get("grand_total") or 0) for x in rs), 2),
            "total_parts": round(sum((x.get("parts_total") or 0) for x in rs), 2),
            "total_labor": round(sum((x.get("labor_charge") or 0) for x in rs), 2),
            "total_minutes": round(sum((x.get("labor_minutes") or 0) for x in rs), 2),
            "first_visit": rs[-1]["created_at"] if rs else None,
            "last_visit": rs[0]["created_at"] if rs else None,
            "repairs": rs,
        }

    by_vehicle = [_vehicle_stats(g) for g in list(vehicle_map.values()) + list(orphan_groups.values())]
    # Sort: registered vehicles first, then by last_visit desc
    by_vehicle.sort(key=lambda g: (g["vehicle"].get("id") is None, -(len(g["repairs"])), g["last_visit"] or ""), reverse=False)
    by_vehicle.sort(key=lambda g: g["last_visit"] or "", reverse=True)

    return {
        "customer": customer,
        "vehicles": vehicles,
        "repair_count": len(repairs),
        "invoice_count": len(invoices),
        "total_parts": total_parts,
        "total_labor": total_labor,
        "total_spent": total_spent,
        "paid": paid,
        "unpaid": unpaid,
        "first_visit": first_visit,
        "last_visit": last_visit,
        "repairs": repairs,
        "invoices": invoices,
        "transactions": txns,
        "by_vehicle": by_vehicle,
    }

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

class SpecialPart(BaseModel):
    """A part specifically ordered from a supplier for this repair — not stocked in inventory."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    quantity: float = 1
    unit_price: float = 0.0    # selling price to customer
    unit_cost: float = 0.0     # what we paid the supplier
    total: float = 0.0
    tax_exempt: bool = False   # true = no BTW (e.g. used / second-hand part)
    supplier_id: Optional[str] = None
    supplier_name: str = ""
    part_number: str = ""      # OEM / manufacturer part number
    catalog_id: Optional[str] = None  # link back to parts_catalog for future lookups
    status: Literal["ordered", "arrived", "installed"] = "ordered"
    expected_date: Optional[str] = None
    note: str = ""
    ordered_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    arrived_at: Optional[str] = None

class TimeLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    mechanic_id: Optional[str] = None
    mechanic_name: str = ""
    started_at: str
    stopped_at: Optional[str] = None
    minutes: float = 0.0
    note: Optional[str] = ""

class ClockInPayload(BaseModel):
    mechanic_id: Optional[str] = None
    note: Optional[str] = ""

class ClockOutPayload(BaseModel):
    log_id: Optional[str] = None  # if omitted, stop the newest running log
    note: Optional[str] = ""

class TimeLogManualCreate(BaseModel):
    mechanic_id: Optional[str] = None
    started_at: str  # ISO datetime
    stopped_at: str  # ISO datetime
    note: Optional[str] = ""

class RepairPhoto(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    storage_path: str
    filename: str
    content_type: str
    size: int
    caption: str = ""
    kind: str = "general"   # before | after | damage | general
    uploaded_by: str = ""
    uploaded_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

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
    vehicle_id: Optional[str] = None
    mechanic_id: Optional[str] = None
    mechanic_name: str = ""
    complaint: str = ""
    diagnosis: str = ""
    work_done: str = ""
    parts_used: List[PartUsed] = []
    special_parts: List[SpecialPart] = []
    time_logs: List[TimeLog] = []
    photos: List[RepairPhoto] = []
    labor_minutes: float = 0.0
    labor_charge: float = 0.0
    parts_total: float = 0.0
    grand_total: float = 0.0
    tax_rate: float = 21.0
    tax_amount: float = 0.0
    total_with_tax: float = 0.0
    status: Literal["open", "in_progress", "completed"] = "open"
    notes: str = ""
    invoice_id: Optional[str] = None
    # Workboard planning fields
    estimated_hours: float = 0.0            # planned effort (1 / 2 / 4 / 8 or custom)
    scheduled_date: Optional[str] = None    # YYYY-MM-DD (day the card sits on the workboard)
    priority: Literal["low", "normal", "high"] = "normal"
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
    vehicle_id: Optional[str] = None
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
    tax_rate: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[Literal["open", "in_progress", "completed"]] = None
    estimated_hours: Optional[float] = None
    scheduled_date: Optional[str] = None
    priority: Optional[Literal["low", "normal", "high"]] = None

class RepairAssign(BaseModel):
    """Workboard drag-and-drop payload. Any field is optional."""
    mechanic_id: Optional[str] = None       # empty string / None → unassign
    scheduled_date: Optional[str] = None    # YYYY-MM-DD; None → keep, "" → clear
    estimated_hours: Optional[float] = None
    priority: Optional[Literal["low", "normal", "high"]] = None

class AddPart(BaseModel):
    item_id: str
    quantity: int = Field(gt=0)
    unit_price: Optional[float] = None  # defaults to item selling_price

def _recalc_repair(card: dict) -> dict:
    parts_total = round(sum(p["total"] for p in card.get("parts_used", [])), 2)
    # Special parts split between taxable and tax-exempt (e.g. used/2nd-hand)
    special_taxable = round(sum(sp.get("total") or (sp.get("quantity", 0) * sp.get("unit_price", 0))
                                for sp in card.get("special_parts", []) if not sp.get("tax_exempt")), 2)
    special_exempt = round(sum(sp.get("total") or (sp.get("quantity", 0) * sp.get("unit_price", 0))
                               for sp in card.get("special_parts", []) if sp.get("tax_exempt")), 2)
    minutes = round(sum(l.get("minutes") or 0 for l in card.get("time_logs", []) if l.get("stopped_at")), 2)
    labor = float(card.get("labor_charge") or 0)
    grand = round(parts_total + special_taxable + special_exempt + labor, 2)
    tax_rate = float(card.get("tax_rate") or 0)
    # BTW applies only to inventory parts + taxable specials + labor
    tax_base = round(parts_total + special_taxable + labor, 2)
    tax_amount = round(tax_base * tax_rate / 100.0, 2)
    total_with_tax = round(grand + tax_amount, 2)
    card["parts_total"] = round(parts_total + special_taxable + special_exempt, 2)
    card["labor_minutes"] = minutes
    card["grand_total"] = grand
    card["tax_amount"] = tax_amount
    card["total_with_tax"] = total_with_tax
    return card

def _recalc_fields(card: dict) -> dict:
    """Return the subset of a recalculated card that must be persisted after any
    parts_used / time_logs / labor_charge / tax_rate change."""
    return {
        "parts_total": card["parts_total"],
        "labor_minutes": card["labor_minutes"],
        "grand_total": card["grand_total"],
        "tax_amount": card["tax_amount"],
        "total_with_tax": card["total_with_tax"],
    }

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

# ---------- Special-order parts (not stocked) ----------

class SpecialPartCreate(BaseModel):
    name: str
    quantity: float = 1
    unit_price: float = 0.0
    unit_cost: float = 0.0
    tax_exempt: bool = False
    supplier_id: Optional[str] = None
    part_number: str = ""
    catalog_id: Optional[str] = None
    status: Literal["ordered", "arrived", "installed"] = "ordered"
    expected_date: Optional[str] = None
    note: str = ""

class SpecialPartUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    unit_cost: Optional[float] = None
    tax_exempt: Optional[bool] = None
    supplier_id: Optional[str] = None
    part_number: Optional[str] = None
    status: Optional[Literal["ordered", "arrived", "installed"]] = None
    expected_date: Optional[str] = None
    note: Optional[str] = None

@api_router.post("/repairs/{rid}/special-parts", response_model=RepairCard)
async def add_special_part(rid: str, payload: SpecialPartCreate, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    supplier_name = ""
    if payload.supplier_id:
        s = await db.suppliers.find_one({"id": payload.supplier_id}, {"_id": 0})
        supplier_name = s["name"] if s else ""
    sp = SpecialPart(
        name=payload.name, quantity=payload.quantity, unit_price=payload.unit_price,
        unit_cost=payload.unit_cost, total=round(payload.quantity * payload.unit_price, 2),
        tax_exempt=payload.tax_exempt,
        supplier_id=payload.supplier_id, supplier_name=supplier_name,
        part_number=payload.part_number, catalog_id=payload.catalog_id,
        status=payload.status,
        expected_date=payload.expected_date, note=payload.note,
    )
    if payload.status == "arrived":
        sp.arrived_at = datetime.now(timezone.utc).isoformat()
    card["special_parts"] = (card.get("special_parts") or []) + [sp.model_dump()]
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "special_parts": card["special_parts"], **_recalc_fields(card), "updated_at": card["updated_at"],
    }})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

@api_router.patch("/repairs/{rid}/special-parts/{sp_id}", response_model=RepairCard)
async def update_special_part(rid: str, sp_id: str, payload: SpecialPartUpdate, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    parts = card.get("special_parts") or []
    idx = next((i for i, p in enumerate(parts) if p["id"] == sp_id), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="Special part not found")
    changes = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "supplier_id" in changes and changes["supplier_id"]:
        s = await db.suppliers.find_one({"id": changes["supplier_id"]}, {"_id": 0})
        changes["supplier_name"] = s["name"] if s else ""
    parts[idx].update(changes)
    parts[idx]["total"] = round(float(parts[idx].get("quantity") or 0) * float(parts[idx].get("unit_price") or 0), 2)
    if changes.get("status") == "arrived" and not parts[idx].get("arrived_at"):
        parts[idx]["arrived_at"] = datetime.now(timezone.utc).isoformat()
    card["special_parts"] = parts
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "special_parts": parts, **_recalc_fields(card), "updated_at": card["updated_at"],
    }})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

@api_router.delete("/repairs/{rid}/special-parts/{sp_id}", response_model=RepairCard)
async def delete_special_part(rid: str, sp_id: str, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    parts = [p for p in (card.get("special_parts") or []) if p["id"] != sp_id]
    card["special_parts"] = parts
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "special_parts": parts, **_recalc_fields(card), "updated_at": card["updated_at"],
    }})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

# ---------- Parts catalog (reusable part names / prices for special-order flow) ----------

class CatalogPart(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    part_number: str = ""
    unit_price: float = 0.0     # default selling price
    unit_cost: float = 0.0      # default cost
    tax_exempt: bool = False    # default BTW flag (e.g. always-used 2nd-hand item)
    supplier_id: Optional[str] = None
    supplier_name: str = ""
    note: str = ""
    times_used: int = 0
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class CatalogPartCreate(BaseModel):
    name: str
    part_number: str = ""
    unit_price: float = 0.0
    unit_cost: float = 0.0
    tax_exempt: bool = False
    supplier_id: Optional[str] = None
    note: str = ""

class CatalogPartUpdate(BaseModel):
    name: Optional[str] = None
    part_number: Optional[str] = None
    unit_price: Optional[float] = None
    unit_cost: Optional[float] = None
    tax_exempt: Optional[bool] = None
    supplier_id: Optional[str] = None
    note: Optional[str] = None

@api_router.get("/parts-catalog", response_model=List[CatalogPart])
async def list_catalog_parts(user: dict = Depends(get_current_user)):
    return await db.parts_catalog.find({}, {"_id": 0}).sort([("times_used", -1), ("name", 1)]).to_list(2000)

@api_router.post("/parts-catalog", response_model=CatalogPart)
async def create_catalog_part(payload: CatalogPartCreate, user: dict = Depends(get_current_user)):
    supplier_name = ""
    if payload.supplier_id:
        s = await db.suppliers.find_one({"id": payload.supplier_id}, {"_id": 0})
        supplier_name = s["name"] if s else ""
    part = CatalogPart(**payload.model_dump(), supplier_name=supplier_name)
    await db.parts_catalog.insert_one(part.model_dump())
    return part

@api_router.patch("/parts-catalog/{cid}", response_model=CatalogPart)
async def update_catalog_part(cid: str, payload: CatalogPartUpdate, user: dict = Depends(get_current_user)):
    part = await db.parts_catalog.find_one({"id": cid}, {"_id": 0})
    if not part:
        raise HTTPException(status_code=404, detail="Catalog part not found")
    changes = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "supplier_id" in changes and changes["supplier_id"]:
        s = await db.suppliers.find_one({"id": changes["supplier_id"]}, {"_id": 0})
        changes["supplier_name"] = s["name"] if s else ""
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.parts_catalog.update_one({"id": cid}, {"$set": changes})
    return await db.parts_catalog.find_one({"id": cid}, {"_id": 0})

@api_router.delete("/parts-catalog/{cid}")
async def delete_catalog_part(cid: str, user: dict = Depends(get_current_user)):
    r = await db.parts_catalog.delete_one({"id": cid})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Catalog part not found")
    return {"ok": True}

@api_router.post("/repairs", response_model=RepairCard)
async def create_repair(payload: RepairCreate, user: dict = Depends(get_current_user)):
    customer_name = payload.customer_name or ""
    customer_phone = payload.customer_phone or ""
    if payload.customer_id:
        c = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0})
        if c:
            customer_name = c.get("name") or customer_name
            customer_phone = c.get("phone") or customer_phone
    # Auto-fill vehicle fields if a vehicle_id is provided
    veh_data = {
        "car_make": payload.car_make, "car_model": payload.car_model, "car_year": payload.car_year,
        "car_plate": payload.car_plate, "car_color": payload.car_color, "car_km": payload.car_km,
    }
    if payload.vehicle_id:
        v = await db.vehicles.find_one({"id": payload.vehicle_id}, {"_id": 0})
        if v:
            for src, dst in [("make", "car_make"), ("model", "car_model"), ("year", "car_year"),
                             ("plate", "car_plate"), ("color", "car_color"), ("km", "car_km")]:
                if not veh_data[dst]:
                    veh_data[dst] = v.get(src, "") or ""
    mechanic_name = ""
    if payload.mechanic_id:
        m = await db.users.find_one({"id": payload.mechanic_id}, {"_id": 0})
        if m: mechanic_name = m.get("name") or m.get("email", "")
    card = RepairCard(
        card_number=_next_number("JOB"),
        customer_id=payload.customer_id,
        customer_name=customer_name,
        customer_phone=customer_phone,
        car_make=veh_data["car_make"], car_model=veh_data["car_model"], car_year=veh_data["car_year"],
        car_plate=veh_data["car_plate"], car_color=veh_data["car_color"], car_km=veh_data["car_km"],
        vehicle_id=payload.vehicle_id,
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
    # Merge and recompute totals so labor_charge / tax_rate changes persist
    merged = {**card, **updates}
    merged = _recalc_repair(merged)
    updates.update(_recalc_fields(merged))
    await db.repairs.update_one({"id": rid}, {"$set": updates})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

@api_router.post("/repairs/{rid}/assign", response_model=RepairCard)
async def assign_repair(rid: str, payload: RepairAssign, user: dict = Depends(get_current_user)):
    """Workboard drag-and-drop: move a job card between mechanics / days and set effort."""
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    updates: dict = {}
    body = payload.model_dump(exclude_unset=True)
    if "mechanic_id" in body:
        mid = body["mechanic_id"] or None
        updates["mechanic_id"] = mid
        if mid:
            m = await db.users.find_one({"id": mid}, {"_id": 0})
            updates["mechanic_name"] = (m or {}).get("name") or (m or {}).get("email", "") if m else ""
        else:
            updates["mechanic_name"] = ""
    if "scheduled_date" in body:
        updates["scheduled_date"] = body["scheduled_date"] or None
    if "estimated_hours" in body and body["estimated_hours"] is not None:
        try:
            updates["estimated_hours"] = max(0.0, float(body["estimated_hours"]))
        except (TypeError, ValueError):
            pass
    if "priority" in body and body["priority"]:
        updates["priority"] = body["priority"]
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
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
        **_recalc_fields(card),
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
        "parts_used": parts,
        **_recalc_fields(card),
        "updated_at": card["updated_at"],
    }})
    return card

async def _labor_rate() -> float:
    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    return float(s.get("labor_rate") or 45.0)

@api_router.post("/repairs/{rid}/clock-in", response_model=RepairCard)
async def clock_in(rid: str, payload: ClockInPayload, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    logs = card.get("time_logs") or []
    if any(l for l in logs if not l.get("stopped_at")):
        raise HTTPException(status_code=400, detail="A time log is already running on this card")
    mechanic_id = payload.mechanic_id or card.get("mechanic_id") or user.get("id")
    mechanic_name = ""
    if mechanic_id:
        m = await db.users.find_one({"id": mechanic_id}, {"_id": 0})
        if m: mechanic_name = m.get("name") or m.get("email", "")
    log = TimeLog(
        mechanic_id=mechanic_id, mechanic_name=mechanic_name,
        started_at=datetime.now(timezone.utc).isoformat(),
        note=payload.note or "",
    )
    logs.append(log.model_dump())
    updates = {"time_logs": logs, "updated_at": datetime.now(timezone.utc).isoformat()}
    if card.get("status") == "open":
        updates["status"] = "in_progress"
    await db.repairs.update_one({"id": rid}, {"$set": updates})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

@api_router.post("/repairs/{rid}/clock-out", response_model=RepairCard)
async def clock_out(rid: str, payload: ClockOutPayload, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    logs = card.get("time_logs") or []
    # Find the running log — either by id or the most recent open one
    target = None
    if payload.log_id:
        target = next((l for l in logs if l["id"] == payload.log_id and not l.get("stopped_at")), None)
    else:
        running = [l for l in logs if not l.get("stopped_at")]
        target = running[-1] if running else None
    if not target:
        raise HTTPException(status_code=400, detail="No running time log to stop")
    now = datetime.now(timezone.utc)
    started = datetime.fromisoformat(target["started_at"])
    minutes = round((now - started).total_seconds() / 60.0, 2)
    target["stopped_at"] = now.isoformat()
    target["minutes"] = max(minutes, 0.0)
    if payload.note:
        target["note"] = (target.get("note") or "") + (" · " if target.get("note") else "") + payload.note
    # Recompute labor_charge from all completed logs × rate
    rate = await _labor_rate()
    total_minutes = sum(l.get("minutes") or 0 for l in logs if l.get("stopped_at"))
    labor_charge = round((total_minutes / 60.0) * rate, 2)
    card["time_logs"] = logs
    card["labor_charge"] = labor_charge
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "time_logs": logs, "labor_charge": labor_charge,
        **_recalc_fields(card),
        "updated_at": card["updated_at"],
    }})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

@api_router.post("/repairs/{rid}/time-logs", response_model=RepairCard)
async def add_manual_time_log(rid: str, payload: TimeLogManualCreate, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    try:
        started = datetime.fromisoformat(payload.started_at)
        stopped = datetime.fromisoformat(payload.stopped_at)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime. Use ISO format.")
    if stopped <= started:
        raise HTTPException(status_code=400, detail="Stopped-at must be after started-at")
    mechanic_id = payload.mechanic_id or card.get("mechanic_id") or user.get("id")
    mechanic_name = ""
    if mechanic_id:
        m = await db.users.find_one({"id": mechanic_id}, {"_id": 0})
        if m: mechanic_name = m.get("name") or m.get("email", "")
    log = TimeLog(
        mechanic_id=mechanic_id, mechanic_name=mechanic_name,
        started_at=started.isoformat(), stopped_at=stopped.isoformat(),
        minutes=round((stopped - started).total_seconds() / 60.0, 2),
        note=payload.note or "",
    )
    logs = (card.get("time_logs") or []) + [log.model_dump()]
    rate = await _labor_rate()
    total_minutes = sum(l.get("minutes") or 0 for l in logs if l.get("stopped_at"))
    labor_charge = round((total_minutes / 60.0) * rate, 2)
    card["time_logs"] = logs
    card["labor_charge"] = labor_charge
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "time_logs": logs, "labor_charge": labor_charge,
        **_recalc_fields(card),
        "updated_at": card["updated_at"],
    }})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

@api_router.delete("/repairs/{rid}/time-logs/{log_id}", response_model=RepairCard)
async def delete_time_log(rid: str, log_id: str, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    logs = card.get("time_logs") or []
    if not any(l["id"] == log_id for l in logs):
        raise HTTPException(status_code=404, detail="Time log not found")
    logs = [l for l in logs if l["id"] != log_id]
    rate = await _labor_rate()
    total_minutes = sum(l.get("minutes") or 0 for l in logs if l.get("stopped_at"))
    labor_charge = round((total_minutes / 60.0) * rate, 2)
    card["time_logs"] = logs
    card["labor_charge"] = labor_charge
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "time_logs": logs, "labor_charge": labor_charge,
        **_recalc_fields(card),
        "updated_at": card["updated_at"],
    }})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})

@api_router.post("/repairs/{rid}/invoice", response_model=Invoice)
async def invoice_repair(rid: str, tax_rate: Optional[float] = None, user: dict = Depends(get_current_user)):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    # Default to the card's own tax rate, then to global settings default
    if tax_rate is None:
        tax_rate = card.get("tax_rate")
    if tax_rate is None:
        s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
        tax_rate = float(s.get("default_tax_rate") or 0)
    tax_rate = float(tax_rate or 0)
    lines = [InvoiceLine(item_id=p["item_id"], sku=p["sku"], name=p["name"],
                         quantity=p["quantity"], unit_price=p["unit_price"], total=p["total"]) for p in card.get("parts_used", [])]
    for sp in card.get("special_parts", []):
        lines.append(InvoiceLine(
            sku=sp.get("part_number") or "SPECIAL",
            name=f"{sp['name']}" + (f" · {sp['supplier_name']}" if sp.get("supplier_name") else ""),
            quantity=sp.get("quantity") or 1,
            unit_price=sp.get("unit_price") or 0,
            total=sp.get("total") or 0,
        ))
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
    # Manual till movements for the day (deposits/withdrawals/expenses)
    manual = await db.cash_movements.find({"date": d}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    manual_in = round(sum(m["amount"] for m in manual if m["direction"] == "IN"), 2)
    manual_out = round(sum(m["amount"] for m in manual if m["direction"] == "OUT"), 2)
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
        "manual_in": manual_in,
        "manual_out": manual_out,
        "manual_movements": manual,
        "net_flow": round(revenue + manual_in - in_total - manual_out, 2),
        "by_customer": sorted(by_customer.values(), key=lambda x: -x["total"]),
        "invoices": sorted(invs, key=lambda i: i.get("paid_at", "")),
    }

# =========================
# Payment Methods & Accounts
# =========================
DEFAULT_PAYMENT_METHODS = [
    {"name": "Cash", "type": "cash"},
    {"name": "Bank Transfer", "type": "bank"},
    {"name": "Card / ATM", "type": "card"},
]

class PaymentMethod(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: Literal["cash", "bank", "card", "other"] = "other"
    opening_balance: float = 0.0
    note: Optional[str] = ""
    active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class PaymentMethodCreate(BaseModel):
    name: str
    type: Literal["cash", "bank", "card", "other"] = "other"
    opening_balance: float = 0.0
    note: Optional[str] = ""
    active: bool = True

class PaymentMethodUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[Literal["cash", "bank", "card", "other"]] = None
    opening_balance: Optional[float] = None
    note: Optional[str] = None
    active: Optional[bool] = None

class PaymentEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    method_id: str
    method_name: str = ""
    direction: Literal["in", "out"]  # in = deposit / income, out = withdrawal / expense
    amount: float = Field(gt=0)
    reference_type: Literal["invoice", "po", "repair", "manual", "opening"] = "manual"
    reference_id: Optional[str] = None
    reference_no: Optional[str] = ""
    counterpart: Optional[str] = ""   # customer or supplier name
    note: Optional[str] = ""
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class PaymentEntryCreate(BaseModel):
    method_id: str
    direction: Literal["in", "out"]
    amount: float = Field(gt=0)
    note: Optional[str] = ""
    counterpart: Optional[str] = ""

async def _seed_payment_methods():
    if await db.payment_methods.count_documents({}) == 0:
        for pm in DEFAULT_PAYMENT_METHODS:
            obj = PaymentMethod(**pm)
            await db.payment_methods.insert_one(obj.model_dump())

async def _pm_balance(method: dict) -> float:
    entries = await db.payment_entries.find({"method_id": method["id"]}, {"_id": 0}).to_list(20000)
    net = sum((e["amount"] if e["direction"] == "in" else -e["amount"]) for e in entries)
    return round(float(method.get("opening_balance") or 0) + net, 2)

async def _log_payment(*, method_id: str, direction: str, amount: float,
                       reference_type: str, reference_id: Optional[str] = None,
                       reference_no: str = "", counterpart: str = "",
                       note: str = "", created_by: str = "") -> Optional[PaymentEntry]:
    if not method_id or amount <= 0:
        return None
    m = await db.payment_methods.find_one({"id": method_id}, {"_id": 0})
    if not m:
        return None
    entry = PaymentEntry(
        method_id=method_id, method_name=m.get("name", ""),
        direction=direction, amount=round(float(amount), 2),
        reference_type=reference_type, reference_id=reference_id,
        reference_no=reference_no, counterpart=counterpart,
        note=note, created_by=created_by,
    )
    await db.payment_entries.insert_one(entry.model_dump())
    return entry

@api_router.get("/payment-methods")
async def list_payment_methods(user: dict = Depends(get_current_user)):
    await _seed_payment_methods()
    methods = await db.payment_methods.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    result = []
    for m in methods:
        m["balance"] = await _pm_balance(m)
        result.append(m)
    return result

@api_router.post("/payment-methods", response_model=PaymentMethod)
async def create_payment_method(payload: PaymentMethodCreate, user: dict = Depends(require_owner)):
    obj = PaymentMethod(**payload.model_dump())
    await db.payment_methods.insert_one(obj.model_dump())
    return obj

@api_router.put("/payment-methods/{mid}", response_model=PaymentMethod)
async def update_payment_method(mid: str, payload: PaymentMethodUpdate, user: dict = Depends(require_owner)):
    existing = await db.payment_methods.find_one({"id": mid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Payment method not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    await db.payment_methods.update_one({"id": mid}, {"$set": updates})
    return await db.payment_methods.find_one({"id": mid}, {"_id": 0})

@api_router.delete("/payment-methods/{mid}")
async def delete_payment_method(mid: str, user: dict = Depends(require_owner)):
    count = await db.payment_entries.count_documents({"method_id": mid})
    if count > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete — {count} entries linked. Mark inactive instead.")
    await db.payment_methods.delete_one({"id": mid})
    return {"ok": True}

@api_router.get("/payment-entries")
async def list_payment_entries(method_id: Optional[str] = None,
                                start: Optional[str] = None,
                                end: Optional[str] = None,
                                limit: int = 500,
                                user: dict = Depends(get_current_user)):
    q = {}
    if method_id:
        q["method_id"] = method_id
    if start or end:
        rng = {}
        if start: rng["$gte"] = start + "T00:00:00+00:00"
        if end: rng["$lte"] = end + "T23:59:59+00:00"
        q["created_at"] = rng
    return await db.payment_entries.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)

@api_router.post("/payment-entries", response_model=PaymentEntry)
async def create_payment_entry(payload: PaymentEntryCreate, user: dict = Depends(get_current_user)):
    entry = await _log_payment(
        method_id=payload.method_id, direction=payload.direction,
        amount=payload.amount, reference_type="manual",
        counterpart=payload.counterpart or "",
        note=payload.note or "",
        created_by=user.get("email", ""),
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Payment method not found")
    return entry

@api_router.delete("/payment-entries/{eid}")
async def delete_payment_entry(eid: str, user: dict = Depends(require_owner)):
    entry = await db.payment_entries.find_one({"id": eid}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.get("reference_type") not in ("manual", "opening"):
        raise HTTPException(status_code=400, detail="Only manual entries can be deleted. Void the source document instead.")
    await db.payment_entries.delete_one({"id": eid})
    return {"ok": True}

@api_router.get("/payment-methods/{mid}/statement")
async def payment_method_statement(mid: str,
                                    start: Optional[str] = None,
                                    end: Optional[str] = None,
                                    user: dict = Depends(get_current_user)):
    m = await db.payment_methods.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Payment method not found")
    q = {"method_id": mid}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start + "T00:00:00+00:00"
        if end: rng["$lte"] = end + "T23:59:59+00:00"
        q["created_at"] = rng
    entries = await db.payment_entries.find(q, {"_id": 0}).sort("created_at", 1).to_list(10000)
    opening = float(m.get("opening_balance") or 0)
    total_in = round(sum(e["amount"] for e in entries if e["direction"] == "in"), 2)
    total_out = round(sum(e["amount"] for e in entries if e["direction"] == "out"), 2)
    # Running balance rows
    running = opening
    if start:
        # exclude entries in the queried range to compute opening for range
        all_before = await db.payment_entries.find({
            "method_id": mid, "created_at": {"$lt": start + "T00:00:00+00:00"}
        }, {"_id": 0}).to_list(10000)
        for e in all_before:
            running += (e["amount"] if e["direction"] == "in" else -e["amount"])
    period_opening = round(running, 2)
    rows = []
    for e in entries:
        running += (e["amount"] if e["direction"] == "in" else -e["amount"])
        rows.append({**e, "balance_after": round(running, 2)})
    closing_balance = round(running, 2)
    return {
        "method": m,
        "opening_balance": opening,
        "period_opening": period_opening,
        "total_in": total_in,
        "total_out": total_out,
        "closing_balance": closing_balance,
        "entries": rows,
    }

@api_router.get("/payments/summary")
async def payments_summary(user: dict = Depends(get_current_user)):
    """Aggregate: overall balance per method + grand total."""
    await _seed_payment_methods()
    methods = await db.payment_methods.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    total = 0.0
    result = []
    for m in methods:
        bal = await _pm_balance(m)
        total += bal
        result.append({**m, "balance": bal})
    return {"methods": result, "total_balance": round(total, 2)}

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


@api_router.post("/cron/backup")
async def cron_backup(background: BackgroundTasks, authorization: Optional[str] = Header(default=None)):
    """Nightly cloud backup — ack immediately, do the work in the background."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer")
    token = authorization[7:]
    if not secrets.compare_digest(token, WEBHOOK_CRON_SECRET or ""):
        raise HTTPException(status_code=401, detail="Bad token")
    from backup import run_daily_cloud_backup

    async def _run():
        try:
            result = await run_daily_cloud_backup(db)
            logger.info(f"Nightly backup ok: {result}")
        except Exception as e:
            logger.exception(f"Nightly backup failed: {e}")

    background.add_task(_run)
    return {"queued": True}


# --- Backup / restore (owner-only) ---
from backup import register_routes as _register_backup_routes  # noqa: E402
_backup_router = _register_backup_routes(db, require_owner)
api_router.include_router(_backup_router)

# --- Extras: repair photos, cash movements, Excel exports ---
from extras import register as _register_extras  # noqa: E402
api_router.include_router(_register_extras(db, get_current_user, require_owner))

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
    await db.backups.create_index("created_at")
    # Init cloud object storage (best-effort — backup UI still works locally without it)
    try:
        from backup import init_storage
        init_storage()
        logger.info("Emergent Object Storage initialised for backups")
    except Exception as e:
        logger.warning(f"Object storage init failed (cloud backup will be unavailable): {e}")
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
