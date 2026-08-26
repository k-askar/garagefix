from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import json
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, BackgroundTasks, Header, Body
from fastapi.security import HTTPBearer
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict
import asyncio, httpx, secrets, re, ipaddress
import stripe
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

# --- Stripe (pay-now for public invoice page) ---
# Flow: customer opens /pay/:token → clicks Pay with card / iDEAL → we mint a
# Stripe Checkout session for exactly the invoice total (EUR).  Webhook at
# /api/stripe/webhook flips the invoice to paid + logs a payment_entry.  The
# key falls back to the platform-provided sandbox key (sk_test_emergent) when
# STRIPE_SECRET_KEY isn't set — matches the playbook default.
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "sk_test_emergent"
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

# --- DB ---
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
_raw_db = client[os.environ['DB_NAME']]
# Phase 1b — wrap in a tenant-aware proxy so every read/write auto-scopes to
# `current_tenant_id`.  Endpoint code keeps saying `db.customers.find(...)`
# unchanged; the proxy injects tenant_id on every filter/doc.  Super_admin,
# background tasks and startup migrations run without a set ContextVar so they
# still see the full multi-tenant view.
from tenant_scope import TenantAwareDb, current_tenant_id  # noqa: E402
db = TenantAwareDb(_raw_db)

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

def create_access_token(user_id: str, email: str, role: str, tenant_id: Optional[str] = None, impersonate_tenant_id: Optional[str] = None) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role, "tenant_id": tenant_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        "type": "access"
    }
    if impersonate_tenant_id:
        payload["impersonate_tenant_id"] = impersonate_tenant_id
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

# ── Permission catalog ────────────────────────────────────────────────────
# Grouped scopes shown as checkboxes in the Staff editor. Owner bypasses ALL
# checks and always has full access. Staff members hold a subset.
PERMISSION_CATALOG = [
    {"section": "inventory", "label": "Inventory", "icon": "package", "perms": [
        {"key": "inventory.view",     "label": "View parts list & KPIs"},
        {"key": "inventory.edit",     "label": "Add / edit parts, prices, notes"},
        {"key": "inventory.delete",   "label": "Delete parts"},
        {"key": "inventory.withdraw", "label": "Withdraw stock (to card / garage)"},
        {"key": "inventory.import",   "label": "CSV import / template download"},
    ]},
    {"section": "repairs", "label": "Job cards", "icon": "wrench", "perms": [
        {"key": "repairs.view",     "label": "View repair cards"},
        {"key": "repairs.create",   "label": "Create new card"},
        {"key": "repairs.edit",     "label": "Edit card (parts, labor, notes)"},
        {"key": "repairs.complete", "label": "Mark complete / issue invoice"},
        {"key": "repairs.delete",   "label": "Delete card"},
    ]},
    {"section": "invoices", "label": "Invoices", "icon": "receipt", "perms": [
        {"key": "invoices.view",       "label": "View invoices"},
        {"key": "invoices.create",     "label": "Create invoice"},
        {"key": "invoices.mark_paid",  "label": "Mark as paid"},
        {"key": "invoices.delete",     "label": "Delete invoice"},
        {"key": "invoices.send",       "label": "Send by email / WhatsApp"},
    ]},
    {"section": "cash", "label": "Cash register", "icon": "wallet", "perms": [
        {"key": "cash.view",         "label": "View ledger"},
        {"key": "cash.add_movement", "label": "Add cash in/out"},
        {"key": "cash.export",       "label": "Export Excel"},
    ]},
    {"section": "customers", "label": "Customers & vehicles", "icon": "users", "perms": [
        {"key": "customers.view",   "label": "View customers"},
        {"key": "customers.edit",   "label": "Add / edit customer & vehicle"},
        {"key": "customers.delete", "label": "Delete customer"},
    ]},
    {"section": "suppliers", "label": "Suppliers", "icon": "truck", "perms": [
        {"key": "suppliers.view", "label": "View suppliers"},
        {"key": "suppliers.edit", "label": "Add / edit suppliers"},
    ]},
    {"section": "reports", "label": "Reports & dashboard", "icon": "bar-chart", "perms": [
        {"key": "reports.view", "label": "View dashboard & reports"},
    ]},
    {"section": "calendar", "label": "Calendar & workboard", "icon": "calendar", "perms": [
        {"key": "calendar.view", "label": "View calendar / workboard / bay-board"},
        {"key": "calendar.edit", "label": "Book / move appointments"},
    ]},
    {"section": "accounts", "label": "Accounts & payments", "icon": "banknote", "perms": [
        {"key": "accounts.view", "label": "View accounts, payment methods, ledger"},
        {"key": "accounts.edit", "label": "Add / edit payment entries"},
    ]},
    {"section": "reminders", "label": "Reminders", "icon": "bell", "perms": [
        {"key": "reminders.view", "label": "View overdue invoices & reminders"},
        {"key": "reminders.send", "label": "Send reminder emails / batch reminders"},
    ]},
    {"section": "delivery_scan", "label": "Delivery scan (OCR)", "icon": "package-open", "perms": [
        {"key": "delivery_scan.use", "label": "Scan / OCR delivery notes"},
    ]},
]

def all_permission_keys() -> List[str]:
    return [p["key"] for section in PERMISSION_CATALOG for p in section["perms"]]


def has_permission(user: dict, perm: str) -> bool:
    """Owner + super_admin bypass every scope check; staff need `perm`
    in their `permissions` list.  Kept in sync with require_owner so a
    platform admin impersonating a tenant doesn't get 403 on data endpoints."""
    if not user:
        return False
    if user.get("role") in ("owner", "super_admin"):
        return True
    return perm in (user.get("permissions") or [])


def require_permission(perm: str):
    """FastAPI dependency factory to guard an endpoint by a single scope."""
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if not has_permission(user, perm):
            raise HTTPException(status_code=403, detail=f"Missing permission: {perm}")
        return user
    return _dep

async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else (
        request.query_params.get("auth") or request.cookies.get("access_token")
    )
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        # Look up the user against the RAW db so this bootstrap fetch is not
        # itself scoped (users of tenant A must be able to log in even though
        # the ContextVar isn't set yet).
        user = await _raw_db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["permissions"] = user.get("permissions") or []
        # Phase 1b — activate tenant scoping for the rest of this request.
        # super_admin users have tenant_id == None → no scoping (they see the
        # whole platform).  Anyone else gets their tenant auto-injected on
        # every DB call via the TenantAwareDb wrapper.
        # Impersonation: when a super_admin has requested to drop into a
        # specific garage the JWT carries `impersonate_tenant_id`.  Scope
        # every DB call to that tenant AND surface the info back to the
        # frontend so it can render the "you are impersonating" banner.
        imp_tid = payload.get("impersonate_tenant_id")
        if imp_tid and user.get("role") == "super_admin":
            current_tenant_id.set(imp_tid)
            imp_doc = await _raw_db.tenants.find_one({"id": imp_tid}, {"_id": 0, "id": 1, "name": 1, "country": 1})
            user["impersonating"] = imp_doc or {"id": imp_tid, "name": "Unknown garage"}
        elif user.get("role") != "super_admin" and user.get("tenant_id"):
            current_tenant_id.set(user["tenant_id"])
        else:
            current_tenant_id.set(None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def require_owner(user: dict = Depends(get_current_user)) -> dict:
    # super_admin can do anything an owner can — needed so the platform-owner
    # can browse/manage tenant data without impersonation.
    if user.get("role") not in ("owner", "super_admin"):
        raise HTTPException(status_code=403, detail="Owner access required")
    return user


async def require_super_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Platform admin only")
    return user

# --- Models ---
class UserRegister(BaseModel):
    email: EmailStr
    password: Optional[str] = Field(default=None, min_length=6)
    name: str
    role: Literal["super_admin", "owner", "staff"] = "staff"
    permissions: List[str] = []


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["super_admin", "owner", "staff"]] = None
    permissions: Optional[List[str]] = None
    password: Optional[str] = Field(default=None, min_length=6)


class PasswordSetupSubmit(BaseModel):
    password: str = Field(min_length=6)

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
    # Structured address (NL-friendly)
    postcode: Optional[str] = ""
    house_number: Optional[str] = ""
    house_number_addition: Optional[str] = ""
    street: Optional[str] = ""
    city: Optional[str] = ""
    address_country: Optional[str] = "NL"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class SupplierCreate(BaseModel):
    name: str
    contact: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    address: Optional[str] = ""
    postcode: Optional[str] = ""
    house_number: Optional[str] = ""
    house_number_addition: Optional[str] = ""
    street: Optional[str] = ""
    city: Optional[str] = ""
    address_country: Optional[str] = "NL"


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None
    house_number: Optional[str] = None
    house_number_addition: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    address_country: Optional[str] = None

class Customer(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    vehicle: Optional[str] = ""
    address: Optional[str] = ""
    # Structured address (NL-friendly)
    postcode: Optional[str] = ""
    house_number: Optional[str] = ""
    house_number_addition: Optional[str] = ""
    street: Optional[str] = ""
    city: Optional[str] = ""
    address_country: Optional[str] = "NL"
    # Company vs private-person split (KvK / VAT + contact person)
    customer_type: Optional[str] = "individual"  # "individual" | "company"
    company_name: Optional[str] = ""
    kvk_number: Optional[str] = ""               # 8-digit Chamber of Commerce number
    vat_number: Optional[str] = ""               # BTW-nummer, e.g. NL812345678B01
    contact_person: Optional[str] = ""
    loyalty_redeemed: int = 0            # how many times this customer has consumed a loyalty reward
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class CustomerCreate(BaseModel):
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    vehicle: Optional[str] = ""
    address: Optional[str] = ""
    postcode: Optional[str] = ""
    house_number: Optional[str] = ""
    house_number_addition: Optional[str] = ""
    street: Optional[str] = ""
    city: Optional[str] = ""
    address_country: Optional[str] = "NL"
    customer_type: Optional[str] = "individual"
    company_name: Optional[str] = ""
    kvk_number: Optional[str] = ""
    vat_number: Optional[str] = ""
    contact_person: Optional[str] = ""


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    vehicle: Optional[str] = None
    address: Optional[str] = None
    postcode: Optional[str] = None
    house_number: Optional[str] = None
    house_number_addition: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    address_country: Optional[str] = None
    customer_type: Optional[str] = None
    company_name: Optional[str] = None
    kvk_number: Optional[str] = None
    vat_number: Optional[str] = None
    contact_person: Optional[str] = None

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
    country: str = "NL"                       # ISO country code (NL, DE, FR, TR, ...); NL gets the yellow plate look
    apk_expiry: Optional[str] = None          # YYYY-MM-DD — Dutch technical inspection expiry
    next_oil_change_km: Optional[int] = None  # odometer at which oil is due
    notes: Optional[str] = ""
    # Extra RDW-imported / manual details -------------------------------------
    meldcode: Optional[str] = ""              # RDW meldcode voertuig (private, entered manually from vehicle papers)
    fuel: Optional[str] = ""                  # Benzine / Diesel / Elektriciteit / …
    cc: Optional[str] = ""                    # cilinderinhoud
    doors: Optional[str] = ""                 # aantal_deuren
    seats: Optional[str] = ""                 # aantal_zitplaatsen
    weight: Optional[str] = ""                # massa_ledig_voertuig (kg)
    chassis_location: Optional[str] = ""      # plaats_chassisnummer — where VIN plate lives
    registration_date: Optional[str] = ""     # datum_tenaamstelling
    passport_token: str = Field(default_factory=lambda: secrets.token_urlsafe(12))  # shareable public link token
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class VehicleCreate(BaseModel):
    make: str = ""
    model: str = ""
    year: str = ""
    plate: str = ""
    color: str = ""
    vin: str = ""
    km: str = ""
    country: str = "NL"
    apk_expiry: Optional[str] = None
    next_oil_change_km: Optional[int] = None
    notes: Optional[str] = ""
    meldcode: Optional[str] = ""
    fuel: Optional[str] = ""
    cc: Optional[str] = ""
    doors: Optional[str] = ""
    seats: Optional[str] = ""
    weight: Optional[str] = ""
    chassis_location: Optional[str] = ""
    registration_date: Optional[str] = ""

class VehicleUpdate(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[str] = None
    plate: Optional[str] = None
    color: Optional[str] = None
    vin: Optional[str] = None
    km: Optional[str] = None
    country: Optional[str] = None
    apk_expiry: Optional[str] = None
    next_oil_change_km: Optional[int] = None
    notes: Optional[str] = None
    meldcode: Optional[str] = None
    fuel: Optional[str] = None
    cc: Optional[str] = None
    doors: Optional[str] = None
    seats: Optional[str] = None
    weight: Optional[str] = None
    chassis_location: Optional[str] = None
    registration_date: Optional[str] = None

class InventoryItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sku: str
    barcode: str
    name: str
    name_ar: str = ""          # Arabic label shown under the primary name
    category: str = "General"
    description: Optional[str] = ""
    notes: Optional[str] = ""  # Free-form operational notes (where to find it, alternative parts, …)
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
    name_ar: str = ""
    category: str = "General"
    description: Optional[str] = ""
    notes: Optional[str] = ""
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
    name_ar: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
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
    repair_number: Optional[str] = ""
    invoice_id: Optional[str] = None
    # Withdraw-for-garage flags (OUT only): true when the part was consumed
    # internally (e.g. workshop consumables) instead of being fitted to a car.
    internal_use: bool = False
    internal_reason: str = ""
    created_by: str = ""
    created_by_name: str = ""
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
    # NEW — OUT withdrawals now MUST specify a destination:
    # either a specific repair card, or set internal_use=True (garage use).
    repair_id: Optional[str] = None
    internal_use: bool = False
    internal_reason: str = ""

# --- Auth Routes ---
@api_router.post("/auth/register")
async def register(payload: UserRegister, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    valid_perms = set(all_permission_keys())
    perms = [p for p in (payload.permissions or []) if p in valid_perms]
    doc = {
        "id": user_id, "email": email, "name": payload.name, "role": payload.role,
        "permissions": perms,
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id, email, payload.role)
    return {"token": token, "user": {"id": user_id, "email": email, "name": payload.name, "role": payload.role, "permissions": perms}}

@api_router.post("/auth/login")
async def login(payload: UserLogin):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user["id"], user["email"], user["role"])
    return {"token": token, "user": {
        "id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"],
        "permissions": user.get("permissions") or [],
    }}


class ProfileUpdateBody(BaseModel):
    name:             Optional[str] = None
    email:            Optional[EmailStr] = None
    current_password: str = Field(min_length=1)


@api_router.put("/auth/me/profile")
async def update_my_profile(payload: ProfileUpdateBody, user: dict = Depends(get_current_user)):
    """Let a logged-in user rotate their own name / email.  Requires the
    current password (via re-auth) so a stolen session can't hijack the account
    by silently swapping the login email.  Email must remain globally unique."""
    doc = await _raw_db.users.find_one({"id": user["id"]})
    if not doc or not doc.get("password_hash"):
        raise HTTPException(status_code=400, detail="Account has no password set")
    if not verify_password(payload.current_password, doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    updates = {}
    if payload.name is not None and payload.name.strip() and payload.name.strip() != doc.get("name"):
        updates["name"] = payload.name.strip()
    if payload.email is not None:
        new_email = payload.email.lower().strip()
        if new_email != (doc.get("email") or "").lower():
            clash = await _raw_db.users.find_one({"email": new_email, "id": {"$ne": user["id"]}})
            if clash:
                raise HTTPException(status_code=409, detail="Another account already uses this email")
            updates["email"] = new_email
    if not updates:
        return {"ok": True, "no_change": True, "user": {
            "id": doc["id"], "email": doc["email"], "name": doc["name"], "role": doc["role"],
            "permissions": doc.get("permissions") or [],
        }}
    updates["profile_changed_at"] = datetime.now(timezone.utc).isoformat()
    await _raw_db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await _raw_db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    # Re-issue the JWT so the token payload matches the new email/role after
    # an email change — otherwise the client keeps sending the old email in
    # the JWT which is harmless but confusing in server logs.
    new_token = create_access_token(fresh["id"], fresh["email"], fresh["role"], fresh.get("tenant_id"))
    return {
        "ok": True,
        "token": new_token,
        "user": {
            "id": fresh["id"], "email": fresh["email"], "name": fresh["name"], "role": fresh["role"],
            "permissions": fresh.get("permissions") or [],
        },
    }


class ChangePasswordBody(BaseModel):
    current_password: str = Field(min_length=1)
    new_password:     str = Field(min_length=6)


@api_router.post("/auth/change-password")
async def change_my_password(payload: ChangePasswordBody, user: dict = Depends(get_current_user)):
    """Let any logged-in user rotate their own password.  Requires the current
    password to prevent hijacked-session tampering; the platform super_admin
    uses this to move off the default `platform123` seed without a redeploy."""
    doc = await _raw_db.users.find_one({"id": user["id"]})
    if not doc or not doc.get("password_hash"):
        raise HTTPException(status_code=400, detail="Account has no password set")
    if not verify_password(payload.current_password, doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="New password must differ from the current one")
    await _raw_db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password),
                  "password_changed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}

@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

# --- Suppliers ---
@api_router.get("/suppliers", response_model=List[Supplier])
async def list_suppliers(user: dict = Depends(require_permission("suppliers.view"))):
    rows = await db.suppliers.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return rows

def _compose_address(d: dict) -> str:
    """Build a single-line display address from structured parts. Falls back to
    whatever the user typed in the free-form `address` field if the parts are empty."""
    street = (d.get("street") or "").strip()
    hn = (d.get("house_number") or "").strip()
    hna = (d.get("house_number_addition") or "").strip()
    pc = (d.get("postcode") or "").strip().upper()
    city = (d.get("city") or "").strip()
    country = (d.get("address_country") or "").strip()
    line1 = " ".join(x for x in [street, (hn + (hna and (" " + hna) or "")).strip()] if x).strip()
    line2 = " ".join(x for x in [pc, city] if x).strip()
    parts = [p for p in [line1, line2, country if country and country != "NL" else ""] if p]
    return ", ".join(parts)


def _with_composed_address(payload_dict: dict) -> dict:
    """If the caller passed structured parts but left `address` blank, auto-fill it."""
    has_parts = any(payload_dict.get(k) for k in ("street", "house_number", "postcode", "city"))
    if has_parts and not (payload_dict.get("address") or "").strip():
        payload_dict["address"] = _compose_address(payload_dict)
    return payload_dict


@api_router.post("/suppliers", response_model=Supplier)
async def create_supplier(payload: SupplierCreate, user: dict = Depends(require_permission("suppliers.edit"))):
    obj = Supplier(**_with_composed_address(payload.model_dump()))
    await db.suppliers.insert_one(obj.model_dump())
    return obj

@api_router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, user: dict = Depends(require_permission("suppliers.edit"))):
    await db.suppliers.delete_one({"id": supplier_id})
    return {"ok": True}


@api_router.put("/suppliers/{supplier_id}", response_model=Supplier)
async def update_supplier(supplier_id: str, payload: SupplierUpdate, user: dict = Depends(require_permission("suppliers.edit"))):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    # If structured address parts changed but `address` was not explicitly set, refresh it.
    if any(k in updates for k in ("street", "house_number", "house_number_addition", "postcode", "city", "address_country")) and "address" not in updates:
        current = await db.suppliers.find_one({"id": supplier_id}, {"_id": 0}) or {}
        merged = {**current, **updates}
        updates["address"] = _compose_address(merged)
    r = await db.suppliers.update_one({"id": supplier_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return await db.suppliers.find_one({"id": supplier_id}, {"_id": 0})

# --- Customers ---
@api_router.get("/customers", response_model=List[Customer])
async def list_customers(user: dict = Depends(require_permission("customers.view"))):
    rows = await db.customers.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return rows

@api_router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, user: dict = Depends(require_permission("customers.edit"))):
    obj = Customer(**_with_composed_address(payload.model_dump()))
    await db.customers.insert_one(obj.model_dump())
    return obj

@api_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, user: dict = Depends(require_permission("customers.delete"))):
    await db.customers.delete_one({"id": customer_id})
    await db.vehicles.delete_many({"customer_id": customer_id})
    return {"ok": True}


@api_router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerUpdate, user: dict = Depends(require_permission("customers.edit"))):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if any(k in updates for k in ("street", "house_number", "house_number_addition", "postcode", "city", "address_country")) and "address" not in updates:
        current = await db.customers.find_one({"id": customer_id}, {"_id": 0}) or {}
        merged = {**current, **updates}
        updates["address"] = _compose_address(merged)
    r = await db.customers.update_one({"id": customer_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    updated = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    # Propagate the freshest name/phone to any open (not-yet-invoiced) repair cards
    # that reference this customer, so the workshop always sees the latest info.
    open_updates = {}
    if updates.get("name"):
        open_updates["customer_name"] = updated["name"]
    if "phone" in updates:
        open_updates["customer_phone"] = updated.get("phone") or ""
    if open_updates:
        await db.repairs.update_many(
            {"customer_id": customer_id, "invoice_id": None},
            {"$set": open_updates},
        )
    return updated

# --- Vehicles (linked to customers) ---
@api_router.get("/customers/{cid}/vehicles", response_model=List[Vehicle])
async def list_customer_vehicles(cid: str, user: dict = Depends(require_permission("customers.view"))):
    return await db.vehicles.find({"customer_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(200)

@api_router.post("/customers/{cid}/vehicles", response_model=Vehicle)
async def add_customer_vehicle(cid: str, payload: VehicleCreate, user: dict = Depends(require_permission("customers.edit"))):
    c = await db.customers.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    obj = Vehicle(customer_id=cid, **payload.model_dump())
    # Guarantee every vehicle has a unique passport token
    if not obj.passport_token:
        obj.passport_token = secrets.token_urlsafe(12)
    await db.vehicles.insert_one(obj.model_dump())
    return obj

@api_router.put("/vehicles/{vid}", response_model=Vehicle)
async def update_vehicle(vid: str, payload: VehicleUpdate, user: dict = Depends(require_permission("customers.edit"))):
    existing = await db.vehicles.find_one({"id": vid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if updates:
        await db.vehicles.update_one({"id": vid}, {"$set": updates})
    return await db.vehicles.find_one({"id": vid}, {"_id": 0})

@api_router.delete("/vehicles/{vid}")
async def delete_vehicle(vid: str, user: dict = Depends(require_permission("customers.edit"))):
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
                             user: dict = Depends(require_permission("calendar.view"))):
    q = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        q["scheduled_at"] = rng
    return await db.appointments.find(q, {"_id": 0}).sort("scheduled_at", 1).to_list(2000)


def _parse_dt(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


@api_router.get("/appointments/conflicts")
async def find_appointment_conflicts(
    mechanic_id: str,
    start: str,
    duration_min: int = 60,
    exclude: Optional[str] = None,
    user: dict = Depends(require_permission("calendar.view")),
):
    """Return every appointment that overlaps the given mechanic slot.
    Used by the calendar's new-appointment dialog to warn about double-booking."""
    if not mechanic_id:
        return {"conflicts": []}
    start_dt = _parse_dt(start)
    if not start_dt:
        raise HTTPException(status_code=400, detail="Invalid start datetime")
    end_dt = start_dt + timedelta(minutes=max(1, int(duration_min or 60)))
    # Pull that mechanic's appointments in a wide day window; refine in memory.
    day_lo = (start_dt - timedelta(days=1)).isoformat()
    day_hi = (end_dt + timedelta(days=1)).isoformat()
    q = {
        "mechanic_id": mechanic_id,
        "status": {"$nin": ["cancelled", "completed"]},
        "scheduled_at": {"$gte": day_lo, "$lte": day_hi},
    }
    rows = await db.appointments.find(q, {"_id": 0}).to_list(500)
    conflicts = []
    for r in rows:
        if exclude and r.get("id") == exclude:
            continue
        r_start = _parse_dt(r.get("scheduled_at", ""))
        if not r_start:
            continue
        r_end = r_start + timedelta(minutes=int(r.get("duration_min") or 60))
        if r_start < end_dt and r_end > start_dt:
            conflicts.append(r)
    return {"conflicts": conflicts, "count": len(conflicts)}


@api_router.post("/appointments", response_model=Appointment)
async def create_appointment(payload: AppointmentCreate, user: dict = Depends(require_permission("calendar.edit"))):
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
async def update_appointment(aid: str, payload: AppointmentUpdate, user: dict = Depends(require_permission("calendar.edit"))):
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
async def delete_appointment(aid: str, user: dict = Depends(require_permission("calendar.edit"))):
    await db.appointments.delete_one({"id": aid})
    return {"ok": True}

@api_router.post("/appointments/{aid}/convert")
async def convert_appointment_to_repair(aid: str, user: dict = Depends(require_permission("repairs.create"))):
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
async def list_inventory(vehicle: Optional[str] = None, user: dict = Depends(require_permission("inventory.view"))):
    query = {}
    if vehicle:
        query["compatible_vehicles"] = {"$regex": vehicle, "$options": "i"}
    rows = await db.inventory.find(query, {"_id": 0}).sort("name", 1).to_list(2000)
    return rows

@api_router.get("/inventory/lookup")
async def lookup_inventory(code: str, user: dict = Depends(require_permission("inventory.view"))):
    item = await db.inventory.find_one({"$or": [{"barcode": code}, {"sku": code}]}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item

@api_router.get("/inventory/{item_id}", response_model=InventoryItem)
async def get_inventory(item_id: str, user: dict = Depends(require_permission("inventory.view"))):
    item = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item

@api_router.post("/inventory", response_model=InventoryItem)
async def create_inventory(payload: InventoryItemCreate, user: dict = Depends(require_permission("inventory.edit"))):
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
async def update_inventory(item_id: str, payload: InventoryItemUpdate, user: dict = Depends(require_permission("inventory.edit"))):
    existing = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.inventory.update_one({"id": item_id}, {"$set": updates})
    return await db.inventory.find_one({"id": item_id}, {"_id": 0})

@api_router.delete("/inventory/{item_id}")
async def delete_inventory(item_id: str, user: dict = Depends(require_permission("inventory.delete"))):
    await db.inventory.delete_one({"id": item_id})
    return {"ok": True}

# --- Transactions ---
@api_router.get("/transactions", response_model=List[Transaction])
async def list_transactions(limit: int = 200, user: dict = Depends(require_permission("inventory.view"))):
    rows = await db.transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return rows

@api_router.post("/transactions", response_model=Transaction)
async def create_transaction(payload: TransactionCreate, user: dict = Depends(require_permission("inventory.withdraw"))):
    item = await db.inventory.find_one({"id": payload.item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if payload.type == "OUT" and payload.quantity > item["quantity"]:
        raise HTTPException(status_code=400, detail=f"Not enough stock. Available: {item['quantity']}")

    # ── OUT withdrawals must have a destination ──────────────────────────
    # Either a specific open repair card OR internal (garage) use with a reason.
    repair_number = ""
    if payload.type == "OUT":
        if not payload.repair_id and not payload.internal_use:
            raise HTTPException(status_code=400, detail="OUT requires either an open repair card or internal_use=true")
        if payload.internal_use and not (payload.internal_reason or "").strip():
            raise HTTPException(status_code=400, detail="internal_reason is required when withdrawing for the garage")
        if payload.repair_id:
            rc = await db.repairs.find_one({"id": payload.repair_id}, {"_id": 0})
            if not rc:
                raise HTTPException(status_code=404, detail="Repair card not found")
            if rc.get("status") not in ("open", "in_progress"):
                raise HTTPException(status_code=400, detail="Can only withdraw parts to an OPEN or IN_PROGRESS card")
            repair_number = rc.get("card_number", "")

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
        repair_id=payload.repair_id,
        repair_number=repair_number,
        internal_use=bool(payload.internal_use),
        internal_reason=(payload.internal_reason or "").strip(),
        # Employee identity taken from the JWT — cannot be spoofed by client.
        created_by=user.get("email", ""),
        created_by_name=(user.get("name") or user.get("email", "")),
    )
    await db.transactions.insert_one(txn.model_dump())

    delta = payload.quantity if payload.type == "IN" else -payload.quantity
    new_qty = item["quantity"] + delta
    update_fields = {"quantity": new_qty, "updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.type == "IN":
        update_fields["cost_price"] = payload.unit_price
    await db.inventory.update_one({"id": item["id"]}, {"$set": update_fields})

    # If the OUT is bound to a repair card, mirror the part on the card so it
    # shows up in the parts_used list and totals immediately.
    if payload.type == "OUT" and payload.repair_id:
        card = await db.repairs.find_one({"id": payload.repair_id}, {"_id": 0})
        if card:
            part = PartUsed(
                txn_id=txn.id, item_id=item["id"], sku=item["sku"], name=item["name"],
                quantity=payload.quantity, unit_price=payload.unit_price,
                total=round(payload.unit_price * payload.quantity, 2),
            )
            card["parts_used"] = (card.get("parts_used") or []) + [part.model_dump()]
            card = _recalc_repair(card)
            await db.repairs.update_one({"id": payload.repair_id}, {"$set": {
                "parts_used": card["parts_used"],
                **_recalc_fields(card),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }})

    return txn

# --- Dashboard ---
@api_router.get("/dashboard/summary")
async def dashboard_summary(user: dict = Depends(require_permission("reports.view"))):
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
    # Bulk-fetch linked vehicles so we can hydrate any missing car_* fields
    # (plate/country/apk) that were added/edited AFTER the card was created.
    open_vids = list({c.get("vehicle_id") for c in open_cards_raw if c.get("vehicle_id")})
    veh_by_id = {}
    if open_vids:
        vehs = await db.vehicles.find({"id": {"$in": open_vids}}, {"_id": 0}).to_list(len(open_vids))
        veh_by_id = {v["id"]: v for v in vehs}
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
        v = veh_by_id.get(c.get("vehicle_id")) or {}
        open_cars.append({
            "id": c["id"],
            "card_number": c["card_number"],
            "customer_name": c.get("customer_name") or "Walk-in",
            "car_make":    c.get("car_make")    or v.get("make", ""),
            "car_model":   c.get("car_model")   or v.get("model", ""),
            "car_plate":   c.get("car_plate")   or v.get("plate", ""),
            "car_country": c.get("car_country") or v.get("country") or "NL",
            "car_year":    c.get("car_year")    or v.get("year", ""),
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
async def report_movement(days: int = 14, user: dict = Depends(require_permission("reports.view"))):
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
@api_router.get("/permissions/catalog")
async def get_permissions_catalog(user: dict = Depends(require_owner)):
    """Return the master list of permission sections used by the Staff editor."""
    return {"sections": PERMISSION_CATALOG}


@api_router.get("/users")
async def list_users(user: dict = Depends(require_owner)):
    rows = await db.users.find({}, {"_id": 0, "password_hash": 0, "password_setup_token": 0}).sort("created_at", -1).to_list(500)
    # Expose a pending flag so the UI can show a "Resend setup link" button
    # for staff whose account has not been activated yet.
    for r in rows:
        r["password_pending"] = bool(r.get("password_setup_expires"))
    return rows
    for r in rows:
        r["permissions"] = r.get("permissions") or []
    return rows

@api_router.post("/users")
async def create_user(payload: UserRegister, user: dict = Depends(require_owner)):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = str(uuid.uuid4())
    valid_perms = set(all_permission_keys())
    perms = [p for p in (payload.permissions or []) if p in valid_perms]
    doc = {
        "id": uid, "email": email, "name": payload.name, "role": payload.role,
        "permissions": perms,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    setup_link = None
    if payload.password:
        # Owner typed a password → activate straight away.
        doc["password_hash"] = hash_password(payload.password)
    else:
        # No password → generate a one-time setup token and email the staff
        # member a link to choose their own password.
        token = secrets.token_urlsafe(32)
        doc["password_setup_token"]   = token
        doc["password_setup_expires"] = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        doc["password_hash"]          = ""  # explicit empty — cannot log in yet
        setup_link = _password_setup_link(token)
    await db.users.insert_one(doc)
    if setup_link:
        try:
            await _send_password_setup_email(doc, setup_link)
        except Exception as e:
            logger.warning(f"Password-setup email failed for {email}: {e}")
    return {"id": uid, "email": email, "name": payload.name, "role": payload.role,
            "permissions": perms, "created_at": doc["created_at"],
            "password_pending": bool(setup_link)}


# Forward declaration so `_send_password_setup_email` and `_send_overdue_email`
# — defined higher up in this file — can reference the per-tenant email
# personaliser without triggering ruff's F821 forward-reference warning.  The
# real implementation lives just above `send_email` further down.
_tenant_email_meta = None  # type: ignore[assignment]


def _password_setup_link(token: str) -> str:
    """Absolute URL the staff member clicks to choose their password."""
    base = (os.environ.get("APP_PUBLIC_URL") or "").rstrip("/")
    return f"{base}/setup-password/{token}" if base else f"/setup-password/{token}"


async def _send_password_setup_email(user_doc: dict, link: str):
    settings = await db.settings.find_one({}, {"_id": 0}) or {}
    garage = settings.get("name") or "PitStock Garage"
    meta = await _tenant_email_meta()
    html = f"""
    <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 8px 0">Welkom bij {esc_html(garage)}</h2>
      <p style="color:#555;line-height:1.6">Hoi {esc_html(user_doc.get('name') or '')},<br/>
      Er is een account voor jou aangemaakt in het garage-systeem.
      Klik op de knop hieronder om je eigen wachtwoord in te stellen —
      de link is 7 dagen geldig.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="{link}" style="display:inline-block;background:#0EA5E9;color:#fff;
                                text-decoration:none;padding:12px 24px;border-radius:999px;
                                font-weight:700;font-size:14px">
          Stel wachtwoord in
        </a>
      </p>
      <p style="color:#888;font-size:12px;line-height:1.5">
        Werkt de knop niet? Kopieer deze link in je browser:<br/>
        <span style="font-family:monospace;word-break:break-all">{esc_html(link)}</span>
      </p>
      {meta["footer_html"]}
    </div>"""
    email = (user_doc.get("email") or "").strip()
    if not email:
        return
    await send_email(to=email, subject=f"Stel je wachtwoord in — {garage}", html=html,
                     purpose="password_setup", related_id=user_doc.get("id"),
                     from_name=meta["from_name"], reply_to=meta["reply_to"])


def esc_html(s: str) -> str:
    return (str(s or "")
            .replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


@api_router.get("/users/{user_id}/setup-link")
async def get_password_setup_link(user_id: str, user: dict = Depends(require_owner)):
    """Return the current setup link for a staff member with a pending
    password.  If the existing token is missing or expired, a fresh one is
    minted (but NOT re-emailed — the caller can trigger `send-setup-link`
    separately).  Used by the "Show invite QR" dialog so the owner can hand
    the link to the staff via any channel."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("password_hash"):
        raise HTTPException(status_code=400, detail="This account is already activated — password is set")
    now_iso = datetime.now(timezone.utc).isoformat()
    token = target.get("password_setup_token")
    exp = target.get("password_setup_expires") or ""
    if not token or exp < now_iso:
        token = secrets.token_urlsafe(32)
        exp = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        await db.users.update_one({"id": user_id}, {"$set": {
            "password_setup_token": token,
            "password_setup_expires": exp,
        }})
    return {
        "link":       _password_setup_link(token),
        "email":      target.get("email"),
        "name":       target.get("name"),
        "expires_at": exp,
    }


@api_router.post("/users/{user_id}/send-setup-link")
async def resend_password_setup(user_id: str, user: dict = Depends(require_owner)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not (target.get("email") or "").strip():
        raise HTTPException(status_code=400, detail="User has no email")
    token = secrets.token_urlsafe(32)
    await db.users.update_one({"id": user_id}, {"$set": {
        "password_setup_token":   token,
        "password_setup_expires": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    }})
    link = _password_setup_link(token)
    target["password_setup_token"] = token
    await _send_password_setup_email(target, link)
    return {"ok": True, "link": link, "sent_to": target["email"]}


@api_router.get("/auth/password-setup/{token}")
async def verify_password_setup_token(token: str):
    doc = await db.users.find_one({"password_setup_token": token}, {"_id": 0, "password_hash": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Link ongeldig of al gebruikt")
    exp = doc.get("password_setup_expires")
    if exp and exp < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=410, detail="Link verlopen — vraag je manager om een nieuwe")
    return {"email": doc["email"], "name": doc.get("name") or ""}


@api_router.post("/auth/password-setup/{token}")
async def submit_password_setup(token: str, payload: PasswordSetupSubmit):
    doc = await db.users.find_one({"password_setup_token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Link ongeldig of al gebruikt")
    exp = doc.get("password_setup_expires")
    if exp and exp < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=410, detail="Link verlopen")
    await db.users.update_one({"id": doc["id"]}, {
        "$set":   {"password_hash": hash_password(payload.password)},
        "$unset": {"password_setup_token": "", "password_setup_expires": ""},
    })
    return {"ok": True, "email": doc["email"]}


class ForgotPasswordBody(BaseModel):
    email: EmailStr


@api_router.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPasswordBody):
    """Public endpoint — issues a fresh password-reset link to the registered
    email address if a matching user exists.  Response is INTENTIONALLY the
    same shape whether or not the email is found, to prevent account
    enumeration."""
    email = payload.email.lower().strip()
    generic_ok = {"ok": True, "sent": True}
    doc = await _raw_db.users.find_one({"email": email})
    if not doc:
        # Look but don't leak — return generic success.
        logger.info(f"forgot-password requested for unknown email {email}")
        return generic_ok
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()   # 24h window
    await _raw_db.users.update_one(
        {"id": doc["id"]},
        {"$set": {"password_setup_token": token, "password_setup_expires": expires}},
    )
    doc["password_setup_token"] = token
    try:
        await _send_password_setup_email(doc, _password_setup_link(token))
    except Exception as e:
        logger.error(f"forgot-password email failed for {email}: {e}")
        # Still return 200 so the UI shows the same message either way.
    return generic_ok


@api_router.put("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, user: dict = Depends(require_owner)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Owner cannot demote themselves — safety net against getting locked out.
    if user["id"] == user_id and payload.role and payload.role != "owner":
        raise HTTPException(status_code=400, detail="You cannot demote your own owner account")
    update_fields = {}
    if payload.name is not None: update_fields["name"] = payload.name
    if payload.role is not None: update_fields["role"] = payload.role
    if payload.permissions is not None:
        valid_perms = set(all_permission_keys())
        update_fields["permissions"] = [p for p in payload.permissions if p in valid_perms]
    if payload.password:
        update_fields["password_hash"] = hash_password(payload.password)
    if update_fields:
        await db.users.update_one({"id": user_id}, {"$set": update_fields})
    fresh = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    fresh["permissions"] = fresh.get("permissions") or []
    return fresh


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
    footer_note: str = "Bedankt voor uw vertrouwen!"
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
    # --- Payments block (new) ---
    bank_name: str = ""                         # human-readable bank name shown next to IBAN
    bic: str = ""                               # BIC / SWIFT code (used in SEPA QR too)
    invoice_show_qr: bool = True                # render SEPA payment QR on paper invoice
    invoice_header_align: Literal["left", "center", "right"] = "left"
    invoice_currency_symbol_pos: Literal["prefix", "suffix"] = "suffix"
    invoice_template: Literal["classic", "minimal", "bold"] = "classic"
    # --- Loyalty rewards ---
    loyalty_enabled: bool = True
    loyalty_threshold: int = 5           # number of paid invoices the customer must accumulate to earn a reward
    loyalty_discount_eur: float = 25.0   # € discount automatically applied on the next invoice after the milestone
    # Default UI language for the garage — every staff member's browser reads
    # this as its initial locale before falling back to their own preference.
    default_language: Literal["en", "nl", "ar"] = "nl"

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
async def download_settings_logo(path: str):
    """Public logo endpoint — no auth required so <img> tags in printable PDFs
    and shared invoice pages can load the logo without an Authorization header."""
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
async def list_pos(user: dict = Depends(require_owner)):
    return await db.purchase_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.get("/purchase-orders/suggest")
async def suggest_pos(user: dict = Depends(require_owner)):
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
    # Vehicle plate snapshot so the printed invoice can render the right country
    # badge (NL yellow, D white, F blue …) even after the repair is edited.
    car_plate: Optional[str] = ""
    car_country: Optional[str] = "NL"
    payment_method_id: Optional[str] = None
    payment_method_name: Optional[str] = ""
    payment_terms_days: int = 14
    due_date: Optional[str] = None              # YYYY-MM-DD — created_at + payment_terms_days
    reminder_sent_at: Optional[str] = None
    reminder_stage: int = 0                     # 0=none, 1=friendly (day1), 2=firm (day7), 3=final (day14)
    reminder_history: List[dict] = []           # [{stage, sent_at, days_overdue}]
    last_emailed_at: Optional[str] = None       # when the invoice was last emailed to the customer
    last_emailed_to: Optional[str] = None       # recipient of the last email
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    paid_at: Optional[str] = None
    # Persistent random token that unlocks the public "Pay this invoice" page
    # (no login).  Included in the overdue reminder email as a "Pay now" CTA.
    pay_token: Optional[str] = None

class InvoiceFromTxns(BaseModel):
    customer_id: Optional[str] = None
    transaction_ids: List[str]
    tax_rate: float = 0.0
    note: Optional[str] = ""

@api_router.get("/invoices", response_model=List[Invoice])
async def list_invoices(user: dict = Depends(require_permission("invoices.view"))):
    return await db.invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.get("/invoices/overdue")
async def list_overdue_invoices(user: dict = Depends(require_permission("reminders.view"))):
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

def _overdue_stage_for(days: int, current_stage: int) -> int:
    """Which reminder tone should we send next?  0 means "nothing yet"."""
    if days >= 14 and current_stage < 3:
        return 3
    if days >= 7 and current_stage < 2:
        return 2
    if days >= 1 and current_stage < 1:
        return 1
    return 0


_OVERDUE_TONE = {
    1: {
        "subject": "Friendly reminder — invoice {inv}",
        "heading": "Friendly reminder — {inv}",
        "greeting": "Hi {name},",
        "body": ("Just a gentle nudge — invoice <strong>{inv}</strong> for "
                 "<strong>{amount:.2f} €</strong> was due on <strong>{due}</strong> "
                 "and is now <strong>{days} day{s} overdue</strong>.  "
                 "If it slipped your mind, please settle when you get a moment."),
        "cta": "Thanks in advance for your quick action.",
        "accent": "#0ea5e9",
    },
    2: {
        "subject": "Second notice — invoice {inv} is now {days} days overdue",
        "heading": "Second notice — {inv}",
        "greeting": "Hi {name},",
        "body": ("We haven't received payment for invoice <strong>{inv}</strong> "
                 "(<strong>{amount:.2f} €</strong>), which was due on <strong>{due}</strong> "
                 "and is now <strong>{days} days overdue</strong>.  "
                 "Please arrange payment this week to keep the account in good standing."),
        "cta": "Kindly reply if you need a payment plan or a copy of the invoice.",
        "accent": "#f59e0b",
    },
    3: {
        "subject": "FINAL NOTICE — invoice {inv} is {days} days overdue",
        "heading": "Final notice — {inv}",
        "greeting": "Dear {name},",
        "body": ("This is our <strong>final reminder</strong> for invoice "
                 "<strong>{inv}</strong> in the amount of <strong>{amount:.2f} €</strong>, "
                 "which was due on <strong>{due}</strong> and is now "
                 "<strong>{days} days overdue</strong>.  "
                 "If payment is not received within the next 7 days, we will forward the "
                 "account to collections and further costs may apply."),
        "cta": "We very much prefer to resolve this amicably — please reply today.",
        "accent": "#e11d48",
    },
}


def _overdue_email_html(inv, garage_name, iban, stage: int = 1, pay_url: str = ""):
    tone = _OVERDUE_TONE.get(stage, _OVERDUE_TONE[1])
    days = int(inv.get("days_overdue") or 0)
    body = tone["body"].format(
        inv=escape(inv["invoice_number"]),
        amount=inv["total"],
        due=escape(inv.get("due_date") or ""),
        days=days,
        s="s" if days != 1 else "",
    )
    iban_line = (f'<p>Bank transfer to <strong>{escape(iban)}</strong>.</p>' if iban else '')
    # Big "Pay now" CTA — links to the public payment page with a real Stripe
    # Checkout (card + iDEAL + Bancontact) button, plus SEPA QR + click-to-copy
    # IBAN as a backup.  Only rendered when the caller supplied a public pay
    # URL (i.e. the invoice has a pay_token and APP_PUBLIC_URL is configured).
    pay_button = ""
    if pay_url:
        pay_button = (
            f'<p style="text-align:center;margin:24px 0">'
            f'<a href="{escape(pay_url)}" '
            f'style="display:inline-block;background:{tone["accent"]};color:#fff;'
            f'text-decoration:none;padding:14px 32px;border-radius:999px;'
            f'font-weight:700;font-size:15px">'
            f'Pay {inv["total"]:.2f} € now — card / iDEAL'
            f'</a>'
            f'</p>'
            f'<p style="text-align:center;font-size:11px;color:#888;margin:-8px 0 16px">'
            f'Secure Stripe checkout — pay by card, iDEAL, Bancontact, or scan a SEPA QR.'
            f'</p>'
        )
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;'
            f'font-family:Arial,sans-serif;color:#111;max-width:560px">'
            f'<div style="border-left:4px solid {tone["accent"]};padding-left:12px;margin-bottom:16px">'
            f'<h2 style="margin:0;color:{tone["accent"]}">{tone["heading"].format(inv=escape(inv["invoice_number"]))}</h2>'
            f'</div>'
            f'<p>{tone["greeting"].format(name=escape(inv.get("customer_name") or "there"))}</p>'
            f'<p>{body}</p>'
            f'{pay_button}'
            f'{iban_line}'
            f'<p>{tone["cta"]}</p>'
            f'<p style="font-size:12px;color:#888;margin-top:24px">Sent by {escape(garage_name)}.</p>'
            f'</td></tr></table>')


async def _send_overdue_email(inv, stage: Optional[int] = None):
    if not inv.get("customer_id"):
        return False
    c = await db.customers.find_one({"id": inv["customer_id"]}, {"_id": 0})
    if not c or not c.get("email"):
        return False
    days = int(inv.get("days_overdue") or 0)
    current_stage = int(inv.get("reminder_stage") or 0)
    picked_stage = stage if stage is not None else _overdue_stage_for(days, current_stage)
    if picked_stage == 0:
        return False
    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    garage_name = s.get("name") or "PitStock Garage"
    iban = s.get("iban") or ""
    tone = _OVERDUE_TONE.get(picked_stage, _OVERDUE_TONE[1])
    subject = tone["subject"].format(inv=inv["invoice_number"], days=days)
    # Ensure the invoice has a persistent pay_token so the CTA in every future
    # reminder links to the same public page.
    pay_token = inv.get("pay_token")
    if not pay_token:
        pay_token = secrets.token_urlsafe(24)
        await db.invoices.update_one({"id": inv["id"]}, {"$set": {"pay_token": pay_token}})
    base = (os.environ.get("APP_PUBLIC_URL") or "").rstrip("/")
    pay_url = f"{base}/pay/{pay_token}" if base and pay_token else ""
    html = _overdue_email_html(inv, garage_name, iban, picked_stage, pay_url=pay_url)
    meta = await _tenant_email_meta()
    # Append per-tenant footer so the customer sees the garage's own contact
    # info even though the email leaves from the platform sender.
    html = html.replace("</div>", meta["footer_html"] + "</div>", 1) if meta["footer_html"] else html
    try:
        await send_email(to=c["email"], subject=subject, html=html,
                         purpose="invoice_overdue", related_id=inv.get("id"),
                         from_name=meta["from_name"], reply_to=meta["reply_to"])
        now_iso = datetime.now(timezone.utc).isoformat()
        entry = {"stage": picked_stage, "sent_at": now_iso, "days_overdue": days}
        await db.invoices.update_one(
            {"id": inv["id"]},
            {"$set": {"reminder_sent_at": now_iso, "reminder_stage": picked_stage},
             "$push": {"reminder_history": entry}},
        )
        return True
    except Exception as e:
        logger.error(f"overdue email failed for {inv['invoice_number']}: {e}")
        return False

@api_router.post("/invoices/overdue/send-reminders")
async def send_overdue_reminders(user: dict = Depends(require_permission("reminders.send"))):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = await db.invoices.find({
        "status": {"$ne": "paid"},
        "due_date": {"$ne": None, "$lt": today},
    }, {"_id": 0}).to_list(1000)
    sent = 0
    stages_sent = {1: 0, 2: 0, 3: 0}
    for r in rows:
        try:
            r["days_overdue"] = (datetime.now(timezone.utc).date() - datetime.strptime(r["due_date"], "%Y-%m-%d").date()).days
        except Exception:
            r["days_overdue"] = 0
        next_stage = _overdue_stage_for(r["days_overdue"], int(r.get("reminder_stage") or 0))
        if next_stage == 0:
            continue
        if await _send_overdue_email(r, stage=next_stage):
            sent += 1
            stages_sent[next_stage] = stages_sent.get(next_stage, 0) + 1
    return {"checked": len(rows), "sent": sent, "skipped": len(rows) - sent, "by_stage": stages_sent}

@api_router.post("/cron/overdue-invoices")
async def cron_overdue_invoices(background: BackgroundTasks, authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer")
    if not secrets.compare_digest(authorization[7:], WEBHOOK_CRON_SECRET or ""):
        raise HTTPException(status_code=401, detail="Bad token")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Pull EVERY unpaid + past-due invoice; the stage helper decides who is due next.
    rows = await db.invoices.find({
        "status": {"$ne": "paid"},
        "due_date": {"$ne": None, "$lt": today},
    }, {"_id": 0}).to_list(2000)

    async def _run():
        queued = 0
        for r in rows:
            try:
                r["days_overdue"] = (datetime.now(timezone.utc).date() - datetime.strptime(r["due_date"], "%Y-%m-%d").date()).days
            except Exception:
                r["days_overdue"] = 0
            # Only actually send if we've hit a new escalation stage.
            next_stage = _overdue_stage_for(r["days_overdue"], int(r.get("reminder_stage") or 0))
            if next_stage == 0:
                continue
            await _send_overdue_email(r, stage=next_stage)
            queued += 1
        logger.info(f"cron/overdue-invoices: escalated {queued} invoices")

    background.add_task(_run)
    return {"queued": len(rows)}

@api_router.post("/invoices/from-transactions", response_model=Invoice)
async def invoice_from_txns(payload: InvoiceFromTxns, user: dict = Depends(require_permission("invoices.create"))):
    txns = await db.transactions.find({"id": {"$in": payload.transaction_ids}, "type": "OUT"}, {"_id": 0}).to_list(500)
    if not txns:
        raise HTTPException(status_code=400, detail="No OUT transactions found")
    lines = [InvoiceLine(item_id=t["item_id"], sku=t["item_sku"], name=t["item_name"],
                         quantity=t["quantity"], unit_price=t["unit_price"], total=t["total"]) for t in txns]
    subtotal = round(sum(l.total for l in lines), 2)
    lines, subtotal, loyalty_meta = await _maybe_apply_loyalty(payload.customer_id, lines, subtotal)
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
    if loyalty_meta.get("applied"):
        await db.customers.update_one({"id": payload.customer_id}, {"$inc": {"loyalty_redeemed": 1}})
    return inv

@api_router.post("/invoices/{inv_id}/mark-paid")
async def mark_paid(inv_id: str, payload: MarkPaidPayload = MarkPaidPayload(), user: dict = Depends(require_permission("invoices.mark_paid"))):
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


class InvoiceEmailBody(BaseModel):
    to: Optional[str] = None  # override customer email, e.g. resend to a different address
    subject: Optional[str] = None
    message: Optional[str] = None  # extra note prepended to the HTML body
    # When the frontend attaches the rendered PDF the base64 payload is sent
    # here and forwarded to Resend so customers get a real downloadable file.
    attachment_base64: Optional[str] = None
    attachment_filename: Optional[str] = None


def _invoice_email_html(inv: dict, settings: dict, note: str = "") -> str:
    accent = settings.get("invoice_accent_color") or "#0EA5E9"
    row_style = "padding:6px 8px;border-bottom:1px solid #eee"
    right_style = "padding:6px 8px;text-align:right;border-bottom:1px solid #eee"
    lines_html = "".join(
        f'<tr><td style="{row_style}">{escape(l.get("name",""))}'
        f'<div style="font-size:10px;color:#888">{escape(l.get("sku","") or "")}</div></td>'
        f'<td style="{right_style}">{l.get("quantity",0)}</td>'
        f'<td style="{right_style}">{l.get("unit_price",0):.2f} &euro;</td>'
        f'<td style="{right_style}">{l.get("total",0):.2f} &euro;</td></tr>'
        for l in (inv.get("lines") or [])
    )
    iban = settings.get("iban") or ""
    tax_line = ""
    if inv.get("tax"):
        tax_line = f'<div style="color:#666;font-size:12px">BTW: {inv.get("tax",0):.2f} &euro;</div>'
    iban_line = ""
    if iban:
        iban_line = (
            f'<p style="color:#666;font-size:12px">Payment to IBAN: '
            f'<span style="font-family:monospace">{escape(iban)}</span></p>'
        )
    note_line = f'<p>{escape(note)}</p>' if note else ""
    name = escape(settings.get("name") or "Garage")
    inv_no = escape(inv.get("invoice_number") or "")
    cust = escape(inv.get("customer_name") or "there")
    footer = escape(settings.get("footer_note") or "Thank you!")
    date_str = _new_date_str(inv.get("created_at"))
    return (
        f'<div style="font-family:Arial,sans-serif;color:#111;max-width:640px;padding:24px">'
        f'<div style="border-left:4px solid {accent};padding-left:12px;margin-bottom:16px">'
        f'<h2 style="margin:0">{name}</h2>'
        f'<div style="color:#666;font-size:12px">Invoice {inv_no} &middot; {date_str}</div>'
        f'</div>'
        f'{note_line}'
        f'<p>Hi {cust}, please find your invoice below.</p>'
        f'<table style="width:100%;border-collapse:collapse;margin-top:12px">'
        f'<thead><tr style="background:#f5f5f5">'
        f'<th style="text-align:left;padding:6px 8px">Item</th>'
        f'<th style="text-align:right;padding:6px 8px">Qty</th>'
        f'<th style="text-align:right;padding:6px 8px">Unit</th>'
        f'<th style="text-align:right;padding:6px 8px">Total</th></tr></thead>'
        f'<tbody>{lines_html}</tbody></table>'
        f'<div style="text-align:right;margin-top:8px">'
        f'<div style="color:#666;font-size:12px">Subtotal: {inv.get("subtotal",0):.2f} &euro;</div>'
        f'{tax_line}'
        f'<div style="font-weight:700;font-size:16px;margin-top:4px">'
        f'Total: {inv.get("total",0):.2f} &euro;</div>'
        f'</div>'
        f'{iban_line}'
        f'<p style="color:#888;font-size:11px;margin-top:24px">{footer}</p>'
        f'</div>'
    )


def _new_date_str(iso: Optional[str]) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%d/%m/%Y")
    except Exception:
        return iso[:10]


@api_router.post("/invoices/{inv_id}/email")
async def email_invoice(inv_id: str, payload: InvoiceEmailBody = InvoiceEmailBody(), user: dict = Depends(require_permission("invoices.send"))):
    """Email the invoice to the customer (or a custom recipient)."""
    inv = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    to = payload.to
    if not to and inv.get("customer_id"):
        c = await db.customers.find_one({"id": inv["customer_id"]}, {"_id": 0})
        to = (c or {}).get("email") or ""
    if not to:
        raise HTTPException(status_code=400, detail="No recipient email available for this customer")
    settings = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    garage_name = settings.get("name") or "PitStock Garage"
    subject = payload.subject or f"Invoice {inv['invoice_number']} from {garage_name}"
    html = _invoice_email_html(inv, settings, payload.message or "")
    meta = await _tenant_email_meta()
    # Append per-tenant footer (garage name, address, phone, KvK) so the
    # customer instantly sees who to reply to.
    if meta["footer_html"]:
        html = html.replace("</div>", meta["footer_html"] + "</div>", 1)
    attachments = None
    if payload.attachment_base64:
        attachments = [{
            "filename": payload.attachment_filename or f"{inv['invoice_number']}.pdf",
            "content_base64": payload.attachment_base64,
        }]
    try:
        await send_email(to=to, subject=subject, html=html, attachments=attachments,
                         purpose="invoice_send", related_id=inv.get("id"),
                         from_name=meta["from_name"], reply_to=meta["reply_to"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Email failed: {str(e)[:180]}")
    await db.invoices.update_one({"id": inv_id}, {"$set": {"last_emailed_at": datetime.now(timezone.utc).isoformat(), "last_emailed_to": to}})
    return {"ok": True, "to": to}


class InvoicePublicPdfBody(BaseModel):
    content_base64: str
    filename: Optional[str] = None


@api_router.post("/invoices/{inv_id}/public-pdf")
async def upload_invoice_public_pdf(inv_id: str, payload: InvoicePublicPdfBody, request: Request, user: dict = Depends(require_permission("invoices.send"))):
    """Store the rendered invoice PDF against a short-lived public token so the
    customer can be sent a plain URL (e.g. inside a WhatsApp message) that
    downloads the file without needing to log in. Token expires after 30 days."""
    inv = await db.invoices.find_one({"id": inv_id}, {"_id": 0, "id": 1, "invoice_number": 1})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    import base64 as _b64
    try:
        raw = _b64.b64decode((payload.content_base64 or "").split(",")[-1])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 PDF payload")
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF too large (max 8 MB)")
    token = secrets.token_urlsafe(24)
    filename = payload.filename or f"{inv.get('invoice_number', 'invoice')}.pdf"
    now = datetime.now(timezone.utc)
    await db.public_invoice_pdfs.insert_one({
        "token": token,
        "invoice_id": inv_id,
        "filename": filename,
        "content": raw,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
    })
    # Prefer the configured public URL; fall back to the request host so this
    # still works in preview environments where APP_PUBLIC_URL isn't set.
    base = (os.environ.get("APP_PUBLIC_URL") or "").rstrip("/")
    if not base:
        base = f"{request.url.scheme}://{request.url.netloc}"
    return {"url": f"{base}/api/public/invoice-pdf/{token}", "token": token, "filename": filename}


@api_router.get("/public/invoice-pdf/{token}")
async def download_invoice_public_pdf(token: str):
    """Serve a previously stored invoice PDF over a public link (no auth)."""
    rec = await db.public_invoice_pdfs.find_one({"token": token})
    if not rec:
        raise HTTPException(status_code=404, detail="Link not found or expired")
    exp = rec.get("expires_at")
    if exp and exp < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=410, detail="Link expired")
    return Response(
        content=rec["content"],
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{rec.get("filename", "invoice.pdf")}"',
            "Cache-Control": "private, max-age=300",
        },
    )


def _sepa_uri(*, iban: str, name: str, amount: float, reference: str, bic: str = "") -> str:
    """EPC-069 SEPA payment URI understood by every major NL / EU banking app
    (ABN, ING, Rabo, N26, Revolut…). Scanning the QR encoded from this string
    pre-fills the recipient, amount and reference in the app."""
    iban = (iban or "").replace(" ", "").upper()
    if not iban:
        return ""
    # `sepa://` is the widely-supported de-facto scheme; `sepapayment:` is the
    # official EPC one but only handled by a subset of apps.  Use the common
    # one and let banking apps fall back to normal manual entry when unknown.
    from urllib.parse import quote
    parts = [f"iban={quote(iban)}"]
    if name:      parts.append(f"name={quote(name)}")
    if bic:       parts.append(f"bic={quote(bic)}")
    if amount:    parts.append(f"amount={amount:.2f}")
    if reference: parts.append(f"reference={quote(reference)}")
    return "sepa://?" + "&".join(parts)


@api_router.get("/public/pay/{token}")
async def public_pay_info(token: str):
    """Return everything a customer needs to pay an unpaid invoice — no auth.
    Called by the /pay/:token frontend page linked from overdue emails."""
    inv = await _raw_db.invoices.find_one({"pay_token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Payment link not found")
    # Find the tenant-scoped garage settings so we can show the correct IBAN /
    # BIC / brand.  We stored `tenant_id` on every invoice.
    tid = inv.get("tenant_id")
    s = None
    if tid:
        s = await _raw_db.settings.find_one({"_id": f"garage:{tid}"}, {"_id": 0})
    if not s:
        s = await _raw_db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    reference = inv.get("invoice_number") or ""
    return {
        "invoice_number": inv.get("invoice_number"),
        "customer_name": inv.get("customer_name") or "",
        "amount": float(inv.get("total") or 0),
        "currency": "EUR",
        "due_date": inv.get("due_date"),
        "status": inv.get("status") or "draft",   # "paid" if already settled
        "paid_at": inv.get("paid_at"),
        # Presence of a Stripe key means the frontend can show a "Pay with card
        # / iDEAL" button that hits /public/pay/{token}/stripe-session.
        "stripe_enabled": bool(stripe.api_key),
        "garage": {
            "name": s.get("name") or "PitStock Garage",
            "email": s.get("email") or "",
            "phone": s.get("phone") or "",
            "address": s.get("address") or "",
            "iban": s.get("iban") or "",
            "bic": s.get("bic") or "",
            "kvk_number": s.get("kvk_number") or "",
        },
        "sepa_uri": _sepa_uri(
            iban=s.get("iban") or "",
            name=s.get("name") or "",
            amount=float(inv.get("total") or 0),
            reference=reference,
            bic=s.get("bic") or "",
        ),
        "reference": reference,
    }


# ─── Stripe Checkout — public "Pay Now" for one invoice ─────────────────────
class StripeSessionBody(BaseModel):
    origin_url: str  # window.location.origin from the /pay/:token page

@api_router.post("/public/pay/{token}/stripe-session")
async def create_stripe_session_for_invoice(token: str, payload: StripeSessionBody):
    """Mint a Stripe Checkout session for the exact invoice total.  Public
    endpoint (no auth) — the pay_token IS the auth."""
    inv = await _raw_db.invoices.find_one({"pay_token": token}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Payment link not found")
    if (inv.get("status") or "").lower() == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")
    amount_cents = int(round(float(inv.get("total") or 0) * 100))
    if amount_cents <= 0:
        raise HTTPException(status_code=400, detail="Invoice total is zero")

    origin = (payload.origin_url or "").rstrip("/")
    if not origin.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid origin_url")
    success_url = f"{origin}/pay/{token}?paid=1&sid={{CHECKOUT_SESSION_ID}}"
    cancel_url  = f"{origin}/pay/{token}?cancelled=1"
    inv_no = inv.get("invoice_number") or "invoice"
    try:
        session = stripe.checkout.Session.create(
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "product_data": {
                        "name": f"Invoice {inv_no}",
                        "description": (inv.get("note") or f"Payment for {inv_no}")[:200],
                    },
                    "unit_amount": amount_cents,
                },
                "quantity": 1,
            }],
            mode="payment",
            # iDEAL + card + Bancontact + SEPA direct-debit — the NL / EU
            # standard set. Cards accept every major brand automatically.
            payment_method_types=["card", "ideal", "bancontact"],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "invoice_id": inv["id"],
                "invoice_number": inv_no,
                "pay_token": token,
                "tenant_id": inv.get("tenant_id") or "",
            },
        )
    except stripe.error.StripeError as e:
        logger.error(f"stripe session create failed for inv {inv.get('invoice_number')}: {e}")
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)[:180]}")
    # Log a `payment_transactions` row BEFORE returning so the webhook can
    # match on session_id even if the browser closes mid-flow.
    await _raw_db.payment_transactions.insert_one({
        "session_id": session.id,
        "invoice_id": inv["id"],
        "invoice_number": inv_no,
        "pay_token": token,
        "tenant_id": inv.get("tenant_id"),
        "amount": float(inv.get("total") or 0),
        "currency": "eur",
        "status": "initiated",
        "payment_status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"checkout_url": session.url, "session_id": session.id}


@api_router.get("/public/pay/{token}/stripe-status/{session_id}")
async def stripe_status_for_invoice(token: str, session_id: str):
    """Frontend polls this while sitting on the /pay/:token?paid=1 return page.
    Falls back to querying Stripe directly if the webhook hasn't landed yet."""
    rec = await _raw_db.payment_transactions.find_one({"session_id": session_id, "pay_token": token}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if rec.get("payment_status") != "paid":
        try:
            s = stripe.checkout.Session.retrieve(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                await _mark_invoice_paid_from_stripe(rec["invoice_id"], s)
                rec = await _raw_db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        except stripe.error.StripeError:
            pass
    return {
        "session_id": rec["session_id"],
        "status": rec.get("status"),
        "payment_status": rec.get("payment_status"),
    }


async def _mark_invoice_paid_from_stripe(invoice_id: str, session_obj):
    """Idempotent flip of an invoice to paid + a matching payment_entry.
    Same guard is used by both the webhook and the status-poll fallback so
    whichever path lands first wins."""
    inv = await _raw_db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv or (inv.get("status") or "").lower() == "paid":
        return
    # Reflect payment_transactions status
    await _raw_db.payment_transactions.update_one(
        {"session_id": session_obj["id"] if isinstance(session_obj, dict) else session_obj.id,
         "payment_status": {"$ne": "paid"}},
        {"$set": {
            "status": "completed", "payment_status": "paid",
            "stripe_payment_intent_id": (session_obj.get("payment_intent") if isinstance(session_obj, dict) else session_obj.payment_intent),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    await _raw_db.invoices.update_one(
        {"id": invoice_id, "status": {"$ne": "paid"}},
        {"$set": {
            "status": "paid",
            "paid_at": datetime.now(timezone.utc).isoformat(),
            "payment_method_name": "Stripe (card / iDEAL)",
        }},
    )
    # Best-effort payment_entry so the till/ledger reflects the incoming cash.
    try:
        m = await _raw_db.payment_methods.find_one({"type": "card", "tenant_id": inv.get("tenant_id")}, {"_id": 0}) \
            or await _raw_db.payment_methods.find_one({"type": "card"}, {"_id": 0})
        if m:
            entry = {
                "id": str(uuid.uuid4()),
                "method_id": m["id"], "method_name": m.get("name", "Card"),
                "direction": "in",
                "amount": float(inv.get("total") or 0),
                "reference_type": "invoice",
                "reference_id": invoice_id,
                "reference_no": inv.get("invoice_number") or "",
                "counterpart": inv.get("customer_name") or "Walk-in",
                "note": "Stripe Checkout",
                "created_by": "stripe@webhook",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "tenant_id": inv.get("tenant_id"),
            }
            await _raw_db.payment_entries.insert_one(entry)
    except Exception as e:
        logger.warning(f"payment_entry log skipped for {invoice_id}: {e}")


@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Stripe → us callback.  Verifies signature when STRIPE_WEBHOOK_SECRET is
    set; otherwise trusts the payload (dev sandbox mode)."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    event = None
    if STRIPE_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
        except (ValueError, stripe.error.SignatureVerificationError):
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        try:
            event = json.loads(payload.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=400, detail="Malformed webhook body")
    obj = event["data"]["object"]
    etype = event.get("type") or ""
    if etype in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        rec = await _raw_db.payment_transactions.find_one({"session_id": obj["id"]}, {"_id": 0})
        if rec:
            await _mark_invoice_paid_from_stripe(rec["invoice_id"], obj)
    elif etype == "checkout.session.async_payment_failed":
        await _raw_db.payment_transactions.update_one(
            {"session_id": obj["id"]},
            {"$set": {"status": "failed", "payment_status": "failed",
                      "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
    return {"ok": True}


@api_router.get("/customers/{cid}/balance")
async def customer_balance(cid: str, user: dict = Depends(require_permission("customers.view"))):
    invs = await db.invoices.find({"customer_id": cid}, {"_id": 0}).to_list(500)
    unpaid = round(sum(i["total"] for i in invs if i["status"] != "paid"), 2)
    paid = round(sum(i["total"] for i in invs if i["status"] == "paid"), 2)
    return {"customer_id": cid, "unpaid": unpaid, "paid": paid, "invoice_count": len(invs)}


async def _loyalty_status(cid: str) -> dict:
    """Return a customer's loyalty progress based on Settings.loyalty_threshold
    and how many rewards they've already consumed. Safe to call for any customer."""
    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    enabled = bool(s.get("loyalty_enabled", True))
    threshold = int(s.get("loyalty_threshold") or 5)
    discount = float(s.get("loyalty_discount_eur") or 25.0)
    c = await db.customers.find_one({"id": cid}, {"_id": 0}) or {}
    paid_count = await db.invoices.count_documents({"customer_id": cid, "status": "paid"})
    redeemed = int(c.get("loyalty_redeemed") or 0)
    earned_cycles = paid_count // threshold if threshold > 0 else 0
    pending_rewards = max(earned_cycles - redeemed, 0)
    in_cycle = paid_count - (redeemed * threshold)  # progress inside current cycle
    if in_cycle < 0: in_cycle = paid_count % threshold if threshold else 0
    return {
        "enabled": enabled,
        "threshold": threshold,
        "discount_eur": discount,
        "paid_invoices": paid_count,
        "redeemed_rewards": redeemed,
        "pending_rewards": pending_rewards,
        "progress_in_cycle": min(in_cycle, threshold),
        "next_reward_in": max(threshold - in_cycle, 0) if pending_rewards == 0 else 0,
    }


@api_router.get("/customers/{cid}/loyalty")
async def get_customer_loyalty(cid: str, user: dict = Depends(require_permission("customers.view"))):
    return await _loyalty_status(cid)


async def _maybe_apply_loyalty(customer_id: Optional[str], lines: list, subtotal: float) -> tuple[list, float, dict]:
    """If the customer has a pending loyalty reward, prepend a discount line to `lines`
    and lower `subtotal`. Returns (updated_lines, updated_subtotal, meta)."""
    meta = {"applied": False, "amount": 0.0}
    if not customer_id:
        return lines, subtotal, meta
    st = await _loyalty_status(customer_id)
    if not st["enabled"] or st["pending_rewards"] <= 0:
        return lines, subtotal, meta
    discount = min(float(st["discount_eur"]), subtotal)
    if discount <= 0:
        return lines, subtotal, meta
    lines = list(lines) + [InvoiceLine(
        sku="LOYALTY",
        name=f"Loyalty reward · after {st['threshold']} paid invoices",
        quantity=1,
        unit_price=-discount,
        total=-discount,
    )]
    subtotal = round(subtotal - discount, 2)
    meta = {"applied": True, "amount": discount}
    return lines, subtotal, meta

@api_router.get("/customers/{cid}/history")
async def customer_history(cid: str, user: dict = Depends(require_permission("customers.view"))):
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
    # Return tracking — when a part is defective/wrong, it can be returned to the
    # supplier and marked here. Returned parts stay on the card (shown in red on
    # the UI + PDF) but are excluded from the grand-total.
    returned: bool = False
    returned_at: Optional[str] = None
    return_reason: str = ""

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
    # Return tracking — see PartUsed for equivalent behaviour on stocked parts.
    returned: bool = False
    returned_at: Optional[str] = None
    return_reason: str = ""

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
    car_country: str = "NL"
    car_apk_expiry: Optional[str] = None
    car_next_oil_change_km: Optional[int] = None
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
    # Optional per-card discount granted to the customer. Applied AFTER
    # parts + labor and BEFORE tax so BTW is on the discounted amount.
    discount_type: Literal["percent", "amount"] = "amount"
    discount_value: float = 0.0
    discount_amount: float = 0.0     # computed (persisted for reports)
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
    car_country: str = "NL"
    car_apk_expiry: Optional[str] = None
    car_next_oil_change_km: Optional[int] = None
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
    car_country: Optional[str] = None
    car_apk_expiry: Optional[str] = None
    car_next_oil_change_km: Optional[int] = None
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
    discount_type: Optional[Literal["percent", "amount"]] = None
    discount_value: Optional[float] = None

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
    # Excluded returned parts from totals — they stay on the card for reference
    # but don't contribute to the invoice.
    parts_total = round(sum(p["total"] for p in card.get("parts_used", []) if not p.get("returned")), 2)
    # Special parts split between taxable and tax-exempt (e.g. used/2nd-hand)
    special_taxable = round(sum(sp.get("total") or (sp.get("quantity", 0) * sp.get("unit_price", 0))
                                for sp in card.get("special_parts", []) if not sp.get("tax_exempt") and not sp.get("returned")), 2)
    special_exempt = round(sum(sp.get("total") or (sp.get("quantity", 0) * sp.get("unit_price", 0))
                               for sp in card.get("special_parts", []) if sp.get("tax_exempt") and not sp.get("returned")), 2)
    minutes = round(sum(l.get("minutes") or 0 for l in card.get("time_logs", []) if l.get("stopped_at")), 2)
    labor = float(card.get("labor_charge") or 0)
    subtotal = round(parts_total + special_taxable + special_exempt + labor, 2)
    # Compute discount (percent or fixed amount) on the pre-tax subtotal.
    dtype = card.get("discount_type") or "amount"
    dvalue = float(card.get("discount_value") or 0)
    if dtype == "percent":
        discount = round(subtotal * max(0.0, min(dvalue, 100.0)) / 100.0, 2)
    else:
        discount = round(max(0.0, min(dvalue, subtotal)), 2)
    grand = round(subtotal - discount, 2)
    tax_rate = float(card.get("tax_rate") or 0)
    # BTW applies to (inventory parts + taxable specials + labor) less the
    # proportion of discount that hits those lines. We keep it simple: apply
    # the discount pro-rata across the taxable base.
    taxable_before = round(parts_total + special_taxable + labor, 2)
    if subtotal > 0 and taxable_before > 0:
        taxable_share = round(discount * taxable_before / subtotal, 2)
    else:
        taxable_share = 0.0
    tax_base = round(taxable_before - taxable_share, 2)
    tax_amount = round(tax_base * tax_rate / 100.0, 2)
    total_with_tax = round(grand + tax_amount, 2)
    card["parts_total"] = round(parts_total + special_taxable + special_exempt, 2)
    card["labor_minutes"] = minutes
    card["discount_amount"] = discount
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
        "discount_amount": card.get("discount_amount", 0.0),
        "grand_total": card["grand_total"],
        "tax_amount": card["tax_amount"],
        "total_with_tax": card["total_with_tax"],
    }

async def _hydrate_repair_from_vehicle(card: dict) -> dict:
    """Fill blank car_* fields on a repair card from the linked vehicle so
    updates to the vehicle (plate added later, APK renewed, colour set…)
    show up on old cards without needing to edit each one."""
    vid = card.get("vehicle_id")
    if not vid:
        return card
    veh = await db.vehicles.find_one({"id": vid}, {"_id": 0})
    if not veh:
        return card
    mapping = {
        "car_plate":     veh.get("plate"),
        "car_country":   veh.get("country"),
        "car_make":      veh.get("make"),
        "car_model":     veh.get("model"),
        "car_year":      veh.get("year"),
        "car_color":     veh.get("color"),
        "car_apk_expiry": veh.get("apk_expiry"),
    }
    for k, v in mapping.items():
        if v and not card.get(k):
            card[k] = v
    return card


@api_router.get("/repairs", response_model=List[RepairCard])
async def list_repairs(status: Optional[str] = None, user: dict = Depends(require_permission("repairs.view"))):
    query = {"status": status} if status else {}
    rows = await db.repairs.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Hydrate every card in one bulk vehicle lookup for efficiency
    vids = list({r["vehicle_id"] for r in rows if r.get("vehicle_id")})
    if vids:
        vehs = await db.vehicles.find({"id": {"$in": vids}}, {"_id": 0}).to_list(len(vids))
        by_id = {v["id"]: v for v in vehs}
        for r in rows:
            v = by_id.get(r.get("vehicle_id"))
            if not v:
                continue
            for card_key, veh_key in (
                ("car_plate", "plate"), ("car_country", "country"),
                ("car_make", "make"), ("car_model", "model"),
                ("car_year", "year"), ("car_color", "color"),
                ("car_apk_expiry", "apk_expiry"),
            ):
                if v.get(veh_key) and not r.get(card_key):
                    r[card_key] = v[veh_key]
    return rows

@api_router.get("/repairs/{rid}", response_model=RepairCard)
async def get_repair(rid: str, user: dict = Depends(require_permission("repairs.view"))):
    c = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Card not found")
    return await _hydrate_repair_from_vehicle(c)

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


class SpecialPartReturnPayload(BaseModel):
    reason: str = ""

@api_router.post("/repairs/{rid}/special-parts", response_model=RepairCard)
async def add_special_part(rid: str, payload: SpecialPartCreate, user: dict = Depends(require_permission("repairs.edit"))):
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
async def update_special_part(rid: str, sp_id: str, payload: SpecialPartUpdate, user: dict = Depends(require_permission("repairs.edit"))):
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
async def delete_special_part(rid: str, sp_id: str, user: dict = Depends(require_permission("repairs.edit"))):
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


@api_router.post("/repairs/{rid}/special-parts/{sp_id}/return", response_model=RepairCard)
async def return_special_part(rid: str, sp_id: str, payload: SpecialPartReturnPayload, user: dict = Depends(require_permission("repairs.edit"))):
    """Mark a special-order part as returned to the supplier. Excluded from
    totals but kept on the card in RED for auditability."""
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    parts = card.get("special_parts") or []
    idx = next((i for i, p in enumerate(parts) if p["id"] == sp_id), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="Special part not found")
    if parts[idx].get("returned"):
        raise HTTPException(status_code=400, detail="Special part already returned")
    parts[idx]["returned"] = True
    parts[idx]["returned_at"] = datetime.now(timezone.utc).isoformat()
    parts[idx]["return_reason"] = payload.reason or ""
    card["special_parts"] = parts
    card = _recalc_repair(card)
    card["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.repairs.update_one({"id": rid}, {"$set": {
        "special_parts": parts, **_recalc_fields(card), "updated_at": card["updated_at"],
    }})
    return await db.repairs.find_one({"id": rid}, {"_id": 0})


@api_router.post("/repairs/{rid}/special-parts/{sp_id}/unreturn", response_model=RepairCard)
async def unreturn_special_part(rid: str, sp_id: str, user: dict = Depends(require_permission("repairs.edit"))):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    parts = card.get("special_parts") or []
    idx = next((i for i, p in enumerate(parts) if p["id"] == sp_id), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="Special part not found")
    if not parts[idx].get("returned"):
        raise HTTPException(status_code=400, detail="Special part is not returned")
    parts[idx]["returned"] = False
    parts[idx]["returned_at"] = None
    parts[idx]["return_reason"] = ""
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
async def list_catalog_parts(user: dict = Depends(require_permission("repairs.view"))):
    return await db.parts_catalog.find({}, {"_id": 0}).sort([("times_used", -1), ("name", 1)]).to_list(2000)

@api_router.post("/parts-catalog", response_model=CatalogPart)
async def create_catalog_part(payload: CatalogPartCreate, user: dict = Depends(require_permission("repairs.edit"))):
    supplier_name = ""
    if payload.supplier_id:
        s = await db.suppliers.find_one({"id": payload.supplier_id}, {"_id": 0})
        supplier_name = s["name"] if s else ""
    part = CatalogPart(**payload.model_dump(), supplier_name=supplier_name)
    await db.parts_catalog.insert_one(part.model_dump())
    return part

@api_router.patch("/parts-catalog/{cid}", response_model=CatalogPart)
async def update_catalog_part(cid: str, payload: CatalogPartUpdate, user: dict = Depends(require_permission("repairs.edit"))):
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
async def delete_catalog_part(cid: str, user: dict = Depends(require_permission("repairs.edit"))):
    r = await db.parts_catalog.delete_one({"id": cid})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Catalog part not found")
    return {"ok": True}

@api_router.post("/repairs", response_model=RepairCard)
async def create_repair(payload: RepairCreate, user: dict = Depends(require_permission("repairs.create"))):
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
        "car_country": payload.car_country or "NL",
        "car_apk_expiry": payload.car_apk_expiry,
        "car_next_oil_change_km": payload.car_next_oil_change_km,
    }
    if payload.vehicle_id:
        v = await db.vehicles.find_one({"id": payload.vehicle_id}, {"_id": 0})
        if v:
            for src, dst in [("make", "car_make"), ("model", "car_model"), ("year", "car_year"),
                             ("plate", "car_plate"), ("color", "car_color"), ("km", "car_km"),
                             ("country", "car_country"), ("apk_expiry", "car_apk_expiry"),
                             ("next_oil_change_km", "car_next_oil_change_km")]:
                if not veh_data[dst]:
                    veh_data[dst] = v.get(src, "") or veh_data[dst]
    mechanic_name = ""
    if payload.mechanic_id:
        m = await db.users.find_one({"id": payload.mechanic_id}, {"_id": 0})
        if m: mechanic_name = m.get("name") or m.get("email", "")
    # When a mechanic is picked at creation time, park the card on today's
    # column of the workboard so employees immediately see which technician
    # it belongs to.  If none is picked, it stays in the "unassigned" queue.
    scheduled_date = ""
    if payload.mechanic_id:
        scheduled_date = datetime.now(timezone.utc).date().isoformat()
    card = RepairCard(
        card_number=_next_number("JOB"),
        customer_id=payload.customer_id,
        customer_name=customer_name,
        customer_phone=customer_phone,
        car_make=veh_data["car_make"], car_model=veh_data["car_model"], car_year=veh_data["car_year"],
        car_plate=veh_data["car_plate"], car_color=veh_data["car_color"], car_km=veh_data["car_km"],
        car_country=veh_data["car_country"], car_apk_expiry=veh_data["car_apk_expiry"],
        car_next_oil_change_km=veh_data["car_next_oil_change_km"],
        vehicle_id=payload.vehicle_id,
        mechanic_id=payload.mechanic_id, mechanic_name=mechanic_name,
        scheduled_date=scheduled_date,
        complaint=payload.complaint, notes=payload.notes,
        created_by=user.get("email", ""),
    )
    await db.repairs.insert_one(card.model_dump())
    return card

@api_router.put("/repairs/{rid}", response_model=RepairCard)
async def update_repair(rid: str, payload: RepairUpdate, user: dict = Depends(require_permission("repairs.edit"))):
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
    # Auto-sync back to the linked vehicle record so the customer's saved car
    # reflects the freshest odometer, APK expiry, and next-oil-change target.
    veh_id = card.get("vehicle_id") or merged.get("vehicle_id")
    now_iso = datetime.now(timezone.utc).isoformat()
    if veh_id:
        veh = await db.vehicles.find_one({"id": veh_id}, {"_id": 0})
        veh_updates = {}
        events: List[dict] = []
        if "car_km" in updates and updates["car_km"]:
            veh_updates["km"] = str(updates["car_km"])
        if "car_apk_expiry" in updates:
            prev = (veh or {}).get("apk_expiry")
            if updates["car_apk_expiry"] and updates["car_apk_expiry"] != prev:
                events.append({
                    "id": str(uuid.uuid4()), "vehicle_id": veh_id, "customer_id": merged.get("customer_id"),
                    "card_id": rid, "card_number": merged.get("card_number"),
                    "kind": "apk_renewal", "at": now_iso,
                    "km": str(updates.get("car_km") or merged.get("car_km") or ""),
                    "new_value": updates["car_apk_expiry"], "previous_value": prev or "",
                })
            veh_updates["apk_expiry"] = updates["car_apk_expiry"]
        if "car_next_oil_change_km" in updates:
            prev = (veh or {}).get("next_oil_change_km")
            new_val = updates["car_next_oil_change_km"]
            try:
                new_int = int(new_val) if new_val not in (None, "") else None
            except (TypeError, ValueError):
                new_int = None
            if new_int and new_int != prev:
                events.append({
                    "id": str(uuid.uuid4()), "vehicle_id": veh_id, "customer_id": merged.get("customer_id"),
                    "card_id": rid, "card_number": merged.get("card_number"),
                    "kind": "oil_change", "at": now_iso,
                    "km": str(updates.get("car_km") or merged.get("car_km") or ""),
                    "new_value": str(new_int), "previous_value": str(prev or ""),
                })
            veh_updates["next_oil_change_km"] = new_int
        if "car_country" in updates and updates["car_country"]:
            veh_updates["country"] = updates["car_country"]
        if veh_updates:
            await db.vehicles.update_one({"id": veh_id}, {"$set": veh_updates})
        if events:
            await db.service_events.insert_many(events)
    return await db.repairs.find_one({"id": rid}, {"_id": 0})


@api_router.get("/vehicles")
async def list_all_vehicles(q: Optional[str] = None,
                             user: dict = Depends(require_permission("customers.view"))):
    """Every vehicle in this tenant + owner snapshot + last-service badge.
    Used by the /vehicles page (a car-centric mirror of /customers).  When
    `q` is provided it filters on plate/vin/make/model + owner name/email."""
    vehicles = await db.vehicles.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    if not vehicles:
        return []
    # Bulk-lookup owners + last repair per vehicle to avoid N+1 round-trips.
    cust_ids = list({v.get("customer_id") for v in vehicles if v.get("customer_id")})
    customers = {c["id"]: c for c in await db.customers.find(
        {"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1}
    ).to_list(len(cust_ids) or 1)}

    vids = [v["id"] for v in vehicles]
    repairs = await db.repairs.find(
        {"vehicle_id": {"$in": vids}}, {"_id": 0},
    ).sort("created_at", -1).to_list(5000)
    last_repair = {}
    repair_count = {}
    for r in repairs:
        vid = r.get("vehicle_id")
        if not vid:
            continue
        repair_count[vid] = repair_count.get(vid, 0) + 1
        if vid not in last_repair:
            last_repair[vid] = r

    rows = []
    today = datetime.now(timezone.utc).date()
    for v in vehicles:
        owner = customers.get(v.get("customer_id") or "", {})
        last = last_repair.get(v["id"])
        # Compute days until APK (Dutch MOT) expires so the UI can flag cars
        # that need booking soon.  None when we have no expiry on file.
        apk_days = None
        apk_str = v.get("apk_expiry") or ""
        if apk_str:
            try:
                apk_days = (datetime.strptime(apk_str, "%Y-%m-%d").date() - today).days
            except (ValueError, TypeError):
                apk_days = None
        rows.append({
            **v,
            "owner_name":  owner.get("name") or "",
            "owner_email": owner.get("email") or "",
            "owner_phone": owner.get("phone") or "",
            "repair_count": repair_count.get(v["id"], 0),
            "apk_days":    apk_days,        # negative = expired, 0-30 = due soon
            "last_repair": (
                {
                    "id": last["id"],
                    "card_number": last.get("card_number"),
                    "status": last.get("status"),
                    "complaint": last.get("complaint") or "",
                    "created_at": last.get("created_at"),
                    "grand_total": last.get("grand_total") or last.get("total") or 0,
                } if last else None
            ),
        })

    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if any(
            needle in str(r.get(k) or "").lower()
            for k in ("plate", "vin", "make", "model", "owner_name", "owner_email", "owner_phone")
        )]
    return rows


@api_router.get("/vehicles/{vid}/history")
async def vehicle_service_history(vid: str, user: dict = Depends(require_permission("customers.view"))):
    """Timeline of every APK renewal + oil change ever logged for a vehicle."""
    v = await db.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    events = await db.service_events.find({"vehicle_id": vid}, {"_id": 0}).sort("at", -1).to_list(500)
    repairs = await db.repairs.find({"vehicle_id": vid}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"vehicle": v, "events": events, "repair_count": len(repairs)}


@api_router.post("/vehicles/{vid}/apk-reminder")
async def send_apk_reminder(vid: str, user: dict = Depends(require_permission("reminders.send"))):
    """One-click Dutch APK-reminder email to the vehicle owner.
    Refuses cleanly (400) when there's no APK date, no owner, or no email."""
    v = await db.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Voertuig niet gevonden")
    apk_str = v.get("apk_expiry") or ""
    if not apk_str:
        raise HTTPException(status_code=400, detail="Geen APK-datum bekend voor dit voertuig")
    try:
        apk_date = datetime.strptime(apk_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="APK-datum is ongeldig")
    days = (apk_date - datetime.now(timezone.utc).date()).days

    if not v.get("customer_id"):
        raise HTTPException(status_code=400, detail="Voertuig heeft geen eigenaar")
    c = await db.customers.find_one({"id": v["customer_id"]}, {"_id": 0})
    if not c or not c.get("email"):
        raise HTTPException(status_code=400, detail="Eigenaar heeft geen e-mailadres")

    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    garage_name = s.get("name") or "GarageFix"
    car_label = " ".join(x for x in [v.get("make"), v.get("model"), str(v.get("year") or "")] if x).strip() or "uw voertuig"
    plate = v.get("plate") or ""

    if days < 0:
        subject = f"BELANGRIJK — APK verlopen voor {plate or car_label}"
        headline = f"APK is {abs(days)} dag{'en' if abs(days) != 1 else ''} geleden verlopen"
        accent = "#dc2626"
        body_html = (
            f"<p>Beste {escape(c.get('name') or 'klant')},</p>"
            f"<p>De APK-keuring van uw <strong>{escape(car_label)}</strong>"
            f"{f' met kenteken <strong>{escape(plate)}</strong>' if plate else ''} is "
            f"<strong style='color:{accent}'>op {escape(apk_str)}</strong> verlopen. "
            f"Rijden zonder geldige APK is niet toegestaan en kan een boete opleveren.</p>"
            f"<p>Plan snel een nieuwe keuring in bij {escape(garage_name)}.</p>"
        )
    elif days <= 30:
        subject = f"APK verloopt binnenkort — {plate or car_label}"
        headline = f"Nog {days} dag{'en' if days != 1 else ''} geldig"
        accent = "#ea580c"
        body_html = (
            f"<p>Beste {escape(c.get('name') or 'klant')},</p>"
            f"<p>De APK van uw <strong>{escape(car_label)}</strong>"
            f"{f' met kenteken <strong>{escape(plate)}</strong>' if plate else ''} verloopt "
            f"<strong>op {escape(apk_str)}</strong> — <strong style='color:{accent}'>nog {days} dag{'en' if days != 1 else ''}</strong>.</p>"
            f"<p>Wij helpen u graag met een tijdige keuring. Neem contact op met {escape(garage_name)} om een afspraak in te plannen.</p>"
        )
    else:
        subject = f"APK-herinnering — {plate or car_label}"
        headline = f"Nog {days} dagen geldig"
        accent = "#0EA5E9"
        body_html = (
            f"<p>Beste {escape(c.get('name') or 'klant')},</p>"
            f"<p>Een vriendelijke herinnering: de APK van uw <strong>{escape(car_label)}</strong>"
            f"{f' met kenteken <strong>{escape(plate)}</strong>' if plate else ''} verloopt op "
            f"<strong>{escape(apk_str)}</strong>.</p>"
            f"<p>Boek gerust alvast een afspraak bij {escape(garage_name)}.</p>"
        )

    html = (
        f'<table role="presentation" width="100%"><tr><td style="padding:24px;'
        f'font-family:Arial,sans-serif;color:#111;max-width:560px">'
        f'<div style="border-left:4px solid {accent};padding-left:12px;margin-bottom:16px">'
        f'<h2 style="margin:0;color:{accent}">🛡️ APK-herinnering</h2>'
        f'<p style="margin:4px 0 0;color:{accent};font-weight:700">{headline}</p>'
        f'</div>'
        f'{body_html}'
        f'<p style="font-size:12px;color:#888;margin-top:24px">Verzonden door {escape(garage_name)}.</p>'
        f'</td></tr></table>'
    )
    meta = await _tenant_email_meta()
    html = html.replace("</div>", meta["footer_html"] + "</div>", 1) if meta["footer_html"] else html
    try:
        await send_email(
            to=c["email"], subject=subject, html=html,
            purpose="apk_reminder", related_id=v["id"],
            from_name=meta["from_name"], reply_to=meta["reply_to"],
        )
    except Exception as e:
        logger.error(f"APK reminder send failed for vehicle {vid}: {e}")
        raise HTTPException(status_code=502, detail=f"E-mail versturen mislukt: {str(e)[:120]}")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.vehicles.update_one({"id": vid}, {"$set": {
        "apk_reminder_sent_at": now_iso,
        "apk_reminder_stage": ("expired" if days < 0 else "soon" if days <= 30 else "info"),
    }})
    return {"ok": True, "to": c["email"], "sent_at": now_iso, "days": days}


@api_router.post("/repairs/{rid}/assign", response_model=RepairCard)
async def assign_repair(rid: str, payload: RepairAssign, user: dict = Depends(require_permission("repairs.edit"))):
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
async def delete_repair(rid: str, user: dict = Depends(require_permission("repairs.delete"))):
    # restock any parts used
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if card:
        for p in card.get("parts_used", []):
            await db.inventory.update_one({"id": p["item_id"]}, {"$inc": {"quantity": p["quantity"]}})
        await db.transactions.delete_many({"repair_id": rid})
    await db.repairs.delete_one({"id": rid})
    return {"ok": True}

@api_router.post("/repairs/{rid}/parts", response_model=RepairCard)
async def add_part_to_repair(rid: str, payload: AddPart, user: dict = Depends(require_permission("repairs.edit"))):
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
async def remove_part_from_repair(rid: str, txn_id: str, user: dict = Depends(require_permission("repairs.edit"))):
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    parts = card.get("parts_used", [])
    target = next((p for p in parts if p.get("txn_id") == txn_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Part not on card")
    # Only restock if the part hasn't ALREADY been returned (returning a part
    # already put the stock back — restocking again would double-count).
    if not target.get("returned"):
        await db.inventory.update_one({"id": target["item_id"]}, {"$inc": {"quantity": target["quantity"]}})
    # Delete the original OUT transaction + any compensating RETURN IN txn that
    # was logged when the part was returned (avoids orphaned ledger rows).
    await db.transactions.delete_one({"id": txn_id})
    await db.transactions.delete_many({"repair_id": rid, "item_id": target["item_id"], "note": {"$regex": "^RETURN "}})
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


class PartReturnPayload(BaseModel):
    reason: str = ""


@api_router.post("/repairs/{rid}/parts/{txn_id}/return", response_model=RepairCard)
async def return_part_on_repair(rid: str, txn_id: str, payload: PartReturnPayload, user: dict = Depends(require_permission("repairs.edit"))):
    """Mark a fitted part as returned to the supplier (defective / wrong / etc.).

    The part stays visible on the card (in red on the UI + PDF) but is excluded
    from the totals. Inventory is restocked and the original OUT transaction is
    flipped by inserting a compensating IN transaction (so cost of goods sold
    stays accurate).
    """
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    parts = card.get("parts_used", [])
    target = next((p for p in parts if p.get("txn_id") == txn_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Part not on card")
    if target.get("returned"):
        raise HTTPException(status_code=400, detail="Part already returned")
    # Restock the inventory
    item = await db.inventory.find_one({"id": target["item_id"]}, {"_id": 0}) or {}
    await db.inventory.update_one({"id": target["item_id"]}, {"$inc": {"quantity": target["quantity"]}})
    now_iso = datetime.now(timezone.utc).isoformat()
    # Log a compensating IN transaction so the ledger reflects the return
    comp = Transaction(
        type="IN",
        item_id=target["item_id"], item_name=target["name"], item_sku=target["sku"],
        quantity=target["quantity"],
        unit_price=float(target.get("unit_price") or 0),
        total=round(float(target.get("total") or 0), 2),
        item_cost=float(item.get("cost_price") or 0),
        customer_id=card.get("customer_id"),
        customer_name=card.get("customer_name", ""),
        note=f"RETURN · Repair {card['card_number']}" + (f" · {payload.reason}" if payload.reason else ""),
        repair_id=rid,
        created_by=user.get("email", ""),
    )
    await db.transactions.insert_one(comp.model_dump())
    # Flag the part
    for p in parts:
        if p.get("txn_id") == txn_id:
            p["returned"] = True
            p["returned_at"] = now_iso
            p["return_reason"] = payload.reason or ""
    card["parts_used"] = parts
    card = _recalc_repair(card)
    card["updated_at"] = now_iso
    await db.repairs.update_one({"id": rid}, {"$set": {
        "parts_used": parts,
        **_recalc_fields(card),
        "updated_at": card["updated_at"],
    }})
    return card


@api_router.post("/repairs/{rid}/parts/{txn_id}/unreturn", response_model=RepairCard)
async def unreturn_part_on_repair(rid: str, txn_id: str, user: dict = Depends(require_permission("repairs.edit"))):
    """Undo a return — the part goes back to being billed on the card. Stock is
    decreased again and a compensating OUT transaction is logged."""
    card = await db.repairs.find_one({"id": rid}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    parts = card.get("parts_used", [])
    target = next((p for p in parts if p.get("txn_id") == txn_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Part not on card")
    if not target.get("returned"):
        raise HTTPException(status_code=400, detail="Part is not returned")
    item = await db.inventory.find_one({"id": target["item_id"]}, {"_id": 0}) or {}
    available = int(item.get("quantity", 0))
    if available < target["quantity"]:
        raise HTTPException(status_code=400, detail=f"Not enough stock to reinstall. Available: {available}")
    await db.inventory.update_one({"id": target["item_id"]}, {"$inc": {"quantity": -target["quantity"]}})
    now_iso = datetime.now(timezone.utc).isoformat()
    comp = Transaction(
        type="OUT",
        item_id=target["item_id"], item_name=target["name"], item_sku=target["sku"],
        quantity=target["quantity"],
        unit_price=float(target.get("unit_price") or 0),
        total=round(float(target.get("total") or 0), 2),
        item_cost=float(item.get("cost_price") or 0),
        customer_id=card.get("customer_id"),
        customer_name=card.get("customer_name", ""),
        note=f"UN-RETURN · Repair {card['card_number']}",
        repair_id=rid,
        created_by=user.get("email", ""),
    )
    await db.transactions.insert_one(comp.model_dump())
    for p in parts:
        if p.get("txn_id") == txn_id:
            p["returned"] = False
            p["returned_at"] = None
            p["return_reason"] = ""
    card["parts_used"] = parts
    card = _recalc_repair(card)
    card["updated_at"] = now_iso
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
async def clock_in(rid: str, payload: ClockInPayload, user: dict = Depends(require_permission("repairs.edit"))):
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
async def clock_out(rid: str, payload: ClockOutPayload, user: dict = Depends(require_permission("repairs.edit"))):
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
async def add_manual_time_log(rid: str, payload: TimeLogManualCreate, user: dict = Depends(require_permission("repairs.edit"))):
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
async def delete_time_log(rid: str, log_id: str, user: dict = Depends(require_permission("repairs.edit"))):
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
async def invoice_repair(rid: str, tax_rate: Optional[float] = None, user: dict = Depends(require_permission("repairs.complete"))):
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
    lines, subtotal, loyalty_meta = await _maybe_apply_loyalty(card.get("customer_id"), lines, subtotal)
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
        car_plate=card.get("car_plate", ""),
        car_country=card.get("car_country") or "NL",
        created_by=user.get("email", ""),
    )
    await db.invoices.insert_one(inv.model_dump())
    await db.repairs.update_one({"id": rid}, {"$set": {"invoice_id": inv.id, "status": "completed",
                                                       "completed_at": datetime.now(timezone.utc).isoformat()}})
    if loyalty_meta.get("applied") and card.get("customer_id"):
        await db.customers.update_one({"id": card["customer_id"]}, {"$inc": {"loyalty_redeemed": 1}})
    return inv

# =========================
# Profit Report
# =========================
@api_router.get("/reports/profit")
async def report_profit(start: Optional[str] = None, end: Optional[str] = None, user: dict = Depends(require_permission("reports.view"))):
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

# =========================
# Public lookups (address, vehicle catalog) — used by the front-end forms
# =========================
_POSTCODE_CACHE: dict[str, dict] = {}
_MAKES_CACHE: dict[str, list] = {}
_MODELS_CACHE: dict[str, list] = {}

@api_router.get("/lookup/postcode")
async def lookup_postcode(postcode: str, number: Optional[str] = None):
    """Look up a Dutch postcode (+ optional house number) using the official
    PDOK Locatieserver (free, no API key)."""
    pc = (postcode or "").strip().replace(" ", "").upper()
    if not pc:
        raise HTTPException(status_code=400, detail="postcode is required")
    cache_key = f"{pc}|{(number or '').strip()}"
    if cache_key in _POSTCODE_CACHE:
        return _POSTCODE_CACHE[cache_key]
    q = f"postcode:{pc}"
    if number and number.strip():
        q += f" and huisnummer:{number.strip()}"
    url = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free"
    params = {"q": q, "fq": "type:adres", "rows": 1, "fl": "weergavenaam,straatnaam,woonplaatsnaam,postcode,huisnummer,huisnummertoevoeging,provincienaam,centroide_ll"}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Postcode service unavailable: {e}")
    docs = ((data.get("response") or {}).get("docs") or [])
    if not docs:
        raise HTTPException(status_code=404, detail="Postcode not found")
    d = docs[0]
    result = {
        "postcode": d.get("postcode") or pc,
        "street": d.get("straatnaam") or "",
        "city": d.get("woonplaatsnaam") or "",
        "province": d.get("provincienaam") or "",
        "house_number": str(d.get("huisnummer") or number or ""),
        "house_number_addition": d.get("huisnummertoevoeging") or "",
        "display": d.get("weergavenaam") or "",
    }
    _POSTCODE_CACHE[cache_key] = result
    return result


@api_router.get("/lookup/vehicle-makes")
async def lookup_vehicle_makes():
    """Return a searchable list of car makes from NHTSA vPIC (free, no key)."""
    if "all" in _MAKES_CACHE:
        return {"makes": _MAKES_CACHE["all"]}
    url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Vehicle catalog unavailable: {e}")
    seen: set = set()
    makes: list = []
    for row in (data.get("Results") or []):
        name = (row.get("MakeName") or "").strip()
        if not name: continue
        key = name.lower()
        if key in seen: continue
        seen.add(key)
        makes.append({"name": name.title() if name.isupper() else name})
    makes.sort(key=lambda x: x["name"].lower())
    _MAKES_CACHE["all"] = makes
    return {"makes": makes}


@api_router.get("/lookup/vehicle-models")
async def lookup_vehicle_models(make: str):
    m = (make or "").strip()
    if not m:
        raise HTTPException(status_code=400, detail="make is required")
    key = m.lower()
    if key in _MODELS_CACHE:
        return {"models": _MODELS_CACHE[key]}
    url = f"https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/{httpx.URL(m).path}?format=json"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Vehicle catalog unavailable: {e}")
    seen: set = set()
    models: list = []
    for row in (data.get("Results") or []):
        name = (row.get("Model_Name") or "").strip()
        if not name: continue
        k2 = name.lower()
        if k2 in seen: continue
        seen.add(k2)
        models.append({"name": name})
    models.sort(key=lambda x: x["name"].lower())
    _MODELS_CACHE[key] = models
    return {"models": models}


# =========================
# Car Passport — public QR-linked page
# =========================
async def _ensure_passport_token(vehicle: dict) -> str:
    tok = vehicle.get("passport_token")
    if tok:
        return tok
    tok = secrets.token_urlsafe(12)
    await db.vehicles.update_one({"id": vehicle["id"]}, {"$set": {"passport_token": tok}})
    return tok


@api_router.post("/vehicles/{vid}/passport/rotate")
async def rotate_passport(vid: str, user: dict = Depends(require_permission("customers.edit"))):
    v = await db.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    tok = secrets.token_urlsafe(12)
    await db.vehicles.update_one({"id": vid}, {"$set": {"passport_token": tok}})
    return {"passport_token": tok}


@api_router.get("/vehicles/{vid}/passport/token")
async def get_passport_token(vid: str, user: dict = Depends(require_permission("customers.view"))):
    v = await db.vehicles.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    tok = await _ensure_passport_token(v)
    return {"passport_token": tok}


@api_router.get("/passport/{token}")
async def public_passport(token: str):
    """Public, unauthenticated view of a vehicle's service passport."""
    v = await db.vehicles.find_one({"passport_token": token}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Passport not found")
    events = await db.service_events.find({"vehicle_id": v["id"]}, {"_id": 0}).sort("at", -1).to_list(200)
    repairs = await db.repairs.find(
        {"vehicle_id": v["id"], "invoice_id": {"$ne": None}},
        {"_id": 0, "card_number": 1, "created_at": 1, "work_done": 1, "car_km": 1, "mechanic_name": 1, "grand_total": 1}
    ).sort("created_at", -1).to_list(50)
    s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    customer = await db.customers.find_one({"id": v.get("customer_id")}, {"_id": 0, "name": 1}) or {}
    return {
        "vehicle": {
            "make": v.get("make") or "", "model": v.get("model") or "",
            "year": v.get("year") or "", "plate": v.get("plate") or "",
            "country": v.get("country") or "NL", "color": v.get("color") or "",
            "vin": v.get("vin") or "", "km": v.get("km") or "",
            "apk_expiry": v.get("apk_expiry"),
            "next_oil_change_km": v.get("next_oil_change_km"),
        },
        "owner_name": customer.get("name") or "",
        "garage": {
            "name": s.get("name") or "PitStock Garage",
            "phone": s.get("phone") or "",
            "email": s.get("email") or "",
            "logo_url": s.get("logo_url") or "",
            "accent": s.get("invoice_accent_color") or "#0EA5E9",
        },
        "events": events,
        "recent_repairs": repairs,
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

async def _log_email(*, to, subject, html, purpose, related_id, status, provider_id, error, attachments):
    """Persist every email attempt so owners can audit delivery status and
    trigger a manual resend from the UI."""
    try:
        tid = None
        try:
            tid = current_tenant_id.get()
        except Exception:
            tid = None
        doc = {
            "id": str(uuid.uuid4()),
            "tenant_id": tid,
            "to": to,
            "subject": subject,
            "html": html,
            "purpose": purpose or "other",
            "related_id": related_id,
            "status": status,           # "accepted" | "failed"
            "provider_id": provider_id,
            "error": (error or "")[:400] if error else None,
            "has_attachments": bool(attachments),
            "attachment_filenames": [a.get("filename") for a in (attachments or []) if a.get("filename")],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await _raw_db.email_logs.insert_one(doc)
    except Exception as le:
        logger.warning(f"email log persist failed: {le}")


async def _tenant_email_meta():
    """Return per-tenant email personalisation:
        {from_name, reply_to, footer_html}

    Falls back to platform defaults if the tenant hasn't filled in their
    profile.  Called by every send-path so each garage's inbox shows the
    garage brand + their own reply address instead of the platform ones."""
    try:
        s = await db.settings.find_one({"_id": "garage"}, {"_id": 0}) or {}
    except Exception:
        s = {}
    name = (s.get("name") or "").strip() or EMAIL_FROM_NAME
    reply = (s.get("email") or "").strip() or None
    parts = []
    if s.get("address"):
        parts.append(esc_html(s["address"]))
    contact_bits = []
    if s.get("phone"):
        contact_bits.append(f'Phone: <a href="tel:{esc_html(s["phone"])}" style="color:#666;text-decoration:none">{esc_html(s["phone"])}</a>')
    if s.get("email"):
        contact_bits.append(f'Email: <a href="mailto:{esc_html(s["email"])}" style="color:#666;text-decoration:none">{esc_html(s["email"])}</a>')
    if contact_bits:
        parts.append(" &middot; ".join(contact_bits))
    if s.get("kvk_number"):
        parts.append(f"KvK: {esc_html(s['kvk_number'])}")
    body = "<br/>".join(parts) if parts else ""
    footer_html = (
        f'<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;'
        f'font-family:Arial,sans-serif;color:#888;font-size:11px;line-height:1.5">'
        f'<div style="color:#333;font-weight:600;margin-bottom:2px">{esc_html(name)}</div>'
        f'{body}'
        f'</div>'
    )
    return {"from_name": name, "reply_to": reply, "footer_html": footer_html}


async def send_email(*, to, subject, html, attachments=None, purpose="other", related_id=None,
                     from_name=None, reply_to=None):
    _assert_safe_email(subject, html)
    payload = {
        "to": [to], "subject": subject, "html": html,
        "from_name": from_name or EMAIL_FROM_NAME,
    }
    if reply_to:
        payload["contact_email"] = reply_to
    # attachments: [{"filename": "invoice.pdf", "content_base64": "…"}]  — passed
    # through to the Resend proxy which forwards to Resend's /emails endpoint.
    if attachments:
        payload["attachments"] = [
            {"filename": a["filename"], "content": a["content_base64"]}
            for a in attachments if a.get("content_base64") and a.get("filename")
        ]
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                             headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        r.raise_for_status()
        provider_id = r.json().get("id")
        await _log_email(to=to, subject=subject, html=html, purpose=purpose,
                         related_id=related_id, status="accepted",
                         provider_id=provider_id, error=None, attachments=attachments)
        return provider_id
    except Exception as e:
        # Capture the provider's response body when available so we can show
        # the real "why" (bad address, over quota, blocked, etc.) in the UI.
        err_detail = str(e)
        try:
            if hasattr(e, "response") and e.response is not None:
                err_detail = f"{e.response.status_code}: {e.response.text[:300]}"
        except Exception:
            pass
        logger.error(f"Email send failed: {err_detail}")
        await _log_email(to=to, subject=subject, html=html, purpose=purpose,
                         related_id=related_id, status="failed",
                         provider_id=None, error=err_detail, attachments=attachments)
        raise HTTPException(status_code=502, detail="Failed to send email")

# --- Reminders, Cron, RDW, KvK — extracted to routes/ ---
# See routes/reminders.py, routes/cron.py, routes/rdw.py, routes/kvk.py.
# Registration happens once send_email + WEBHOOK_CRON_SECRET are both in scope.
from routes.reminders import register as _register_reminders  # noqa: E402
from routes.cron      import register as _register_cron       # noqa: E402
from routes.rdw       import register as _register_rdw        # noqa: E402
from routes.kvk       import register as _register_kvk        # noqa: E402
from routes.tenants   import register as _register_tenants    # noqa: E402
from routes.email_logs import register as _register_email_logs  # noqa: E402
from routes.subscription_cron import register as _register_subscription_cron  # noqa: E402
from routes.saas_billing import register as _register_saas_billing, _create_saas_invoice as _create_saas_invoice_fn  # noqa: E402

# Helper passed into routes/tenants.py so the super-admin "Create garage"
# endpoint can auto-provision a pending-password owner user and email the
# setup link — reuses the existing password-setup pipeline.
async def _provision_tenant_owner(tenant_id: str, email: str, name: str):
    email = (email or "").lower().strip()
    if not email:
        return None
    if await _raw_db.users.find_one({"email": email}):
        return {"email": email, "link": None, "already_exists": True}
    token = secrets.token_urlsafe(32)
    uid = str(uuid.uuid4())
    doc = {
        "id": uid,
        "email": email,
        "name": name or email.split("@")[0],
        "role": "owner",
        "tenant_id": tenant_id,
        "password_hash": "",
        "password_setup_token": token,
        "password_setup_expires": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "permissions": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await _raw_db.users.insert_one(doc)
    link = _password_setup_link(token)
    try:
        await _send_password_setup_email(doc, link)
        emailed = True
    except Exception as e:
        logger.warning(f"Onboarding email failed for {email}: {e}")
        emailed = False
    return {"email": email, "link": link, "emailed": emailed, "already_exists": False}

_reminders_router, _send_reminder = _register_reminders(db, get_current_user, send_email, require_permission)
api_router.include_router(_reminders_router)
api_router.include_router(_register_cron(db, WEBHOOK_CRON_SECRET, _send_reminder))
api_router.include_router(_register_rdw(get_current_user))
api_router.include_router(_register_kvk(get_current_user))
api_router.include_router(_register_tenants(db, get_current_user, require_super_admin, _provision_tenant_owner))
api_router.include_router(_register_email_logs(db, get_current_user, send_email, require_super_admin, require_owner))
api_router.include_router(_register_subscription_cron(db, WEBHOOK_CRON_SECRET, send_email, _create_saas_invoice_fn))
api_router.include_router(_register_saas_billing(db, require_super_admin))


class ResetOwnerPayload(BaseModel):
    owner_email: Optional[str] = None       # new login email for the owner user
    owner_name: Optional[str] = None
    new_password: Optional[str] = None      # if provided, replaces the current password


@api_router.post("/tenants/{tenant_id}/reset-owner")
async def reset_tenant_owner(
    tenant_id: str,
    payload: ResetOwnerPayload,
    user: dict = Depends(require_super_admin),
):
    """Super-admin support tool: rewrite the OWNER user's email, name and/or
    password for a garage.  Used for emergencies (lost email inbox access,
    forgotten password, ownership handover).  Also updates `tenant.owner_email`
    so future onboarding + billing emails go to the new address."""
    raw_db = getattr(db, "_db", db)
    tenant = await raw_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    owner = await raw_db.users.find_one(
        {"tenant_id": tenant_id, "role": "owner"},
        {"_id": 0},
    )
    if not owner:
        raise HTTPException(status_code=404, detail="No owner user found for this tenant")

    update: dict = {}
    new_email = (payload.owner_email or "").strip().lower()
    if new_email and new_email != (owner.get("email") or "").lower():
        # Guard against colliding with a user in ANY tenant.
        collision = await raw_db.users.find_one({"email": new_email, "id": {"$ne": owner["id"]}}, {"_id": 0, "id": 1})
        if collision:
            raise HTTPException(status_code=409, detail=f"Email {new_email} already in use")
        update["email"] = new_email
    if payload.owner_name and payload.owner_name.strip():
        update["name"] = payload.owner_name.strip()
    if payload.new_password:
        pw = payload.new_password.strip()
        if len(pw) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        update["password_hash"] = hash_password(pw)
        # Clear any pending "set your password" flow so the new password wins.
        update["password_pending"] = False
        update["password_setup_token"] = None

    if not update:
        raise HTTPException(status_code=400, detail="Nothing to change — send at least one field")

    await raw_db.users.update_one({"id": owner["id"]}, {"$set": update})
    if "email" in update:
        await raw_db.tenants.update_one({"id": tenant_id}, {"$set": {"owner_email": update["email"]}})
    return {
        "ok": True,
        "changed": list(update.keys()),
        "owner_email": update.get("email") or owner.get("email"),
    }


# --- Cash Register / Daily Till ---
@api_router.get("/ledger")
async def ledger(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    method_type: Optional[str] = None,
    direction: Optional[str] = None,
    ref_type: Optional[str] = None,
    q: Optional[str] = None,
    user: dict = Depends(require_permission("cash.view")),
):
    """Unified ledger: every payment_entry row (invoice, PO, manual) with filters."""
    await _seed_payment_methods()
    query: dict = {}
    if date_from or date_to:
        cond: dict = {}
        if date_from: cond["$gte"] = date_from + "T00:00:00+00:00"
        if date_to:   cond["$lte"] = date_to   + "T23:59:59+00:00"
        query["created_at"] = cond
    if direction in ("in", "out"): query["direction"] = direction
    if ref_type: query["reference_type"] = ref_type

    entries = await db.payment_entries.find(query, {"_id": 0}).sort("created_at", 1).to_list(20000)
    methods = {m["id"]: m for m in await db.payment_methods.find({}, {"_id": 0}).to_list(200)}
    if method_type:
        allowed = {mid for mid, m in methods.items() if m.get("type") == method_type}
        entries = [e for e in entries if e.get("method_id") in allowed]
    ql = (q or "").strip().lower()
    if ql:
        entries = [e for e in entries if any(ql in str(e.get(k, "")).lower()
                                              for k in ("counterpart", "note", "reference_no", "method_name"))]
    for e in entries:
        m = methods.get(e.get("method_id")) or {}
        e["method_type"] = m.get("type") or "other"

    all_entries = await db.payment_entries.find({}, {"_id": 0}).to_list(50000)
    summary = []
    for mid, m in methods.items():
        ein  = round(sum(x["amount"] for x in all_entries if x["method_id"] == mid and x["direction"] == "in"), 2)
        eout = round(sum(x["amount"] for x in all_entries if x["method_id"] == mid and x["direction"] == "out"), 2)
        summary.append({
            "id": mid, "name": m.get("name") or "",
            "type": m.get("type") or "other",
            "active": bool(m.get("active", True)),
            "opening_balance": round(float(m.get("opening_balance") or 0), 2),
            "in_total": ein, "out_total": eout,
            "balance": round(float(m.get("opening_balance") or 0) + ein - eout, 2),
            "note": m.get("note") or "",
        })
    order = ["cash", "bank", "card", "other"]
    summary.sort(key=lambda s: (order.index(s["type"]) if s["type"] in order else 9, s["name"]))
    in_total  = round(sum(e["amount"] for e in entries if e["direction"] == "in"), 2)
    out_total = round(sum(e["amount"] for e in entries if e["direction"] == "out"), 2)
    return {
        "entries": entries,
        "in_total": in_total, "out_total": out_total,
        "net": round(in_total - out_total, 2),
        "count": len(entries),
        "methods": summary,
    }


@api_router.get("/cash-register")
async def cash_register(date: Optional[str] = None, user: dict = Depends(require_permission("cash.view"))):
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
async def list_payment_methods(user: dict = Depends(require_permission("accounts.view"))):
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
                                user: dict = Depends(require_permission("accounts.view"))):
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
async def create_payment_entry(payload: PaymentEntryCreate, user: dict = Depends(require_permission("accounts.edit"))):
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
                                    user: dict = Depends(require_permission("accounts.view"))):
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
async def payments_summary(user: dict = Depends(require_permission("accounts.view"))):
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


# --- Backup / restore (owner-only) ---
from backup import register_routes as _register_backup_routes  # noqa: E402
_backup_router = _register_backup_routes(db, require_owner)
api_router.include_router(_backup_router)

# --- Extras: repair photos, cash movements, Excel exports ---
from extras import register as _register_extras  # noqa: E402
api_router.include_router(_register_extras(db, get_current_user, require_owner))

# =========================
# Fleet CSV Import  +  Live Bay Board  +  Delivery-note scan
# =========================
import csv as _csv, io as _io

@api_router.post("/import/vehicles-csv")
async def import_vehicles_csv(payload: dict, user: dict = Depends(require_permission("customers.edit"))):
    """Bulk-import vehicles from a raw CSV string."""
    raw = (payload.get("csv") or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty CSV")
    reader = _csv.DictReader(_io.StringIO(raw))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")
    norm = {h: (h or "").strip().lower().replace(" ", "_") for h in reader.fieldnames}
    created_customers = 0; reused_customers = 0; created_vehicles = 0; errors = []
    seen_customers: dict = {}
    for idx, raw_row in enumerate(reader, start=2):
        row = {norm[k]: (v or "").strip() for k, v in raw_row.items()}
        cname = row.get("customer_name") or ""
        cphone = row.get("customer_phone") or ""
        plate = row.get("plate") or ""
        if not (cname or plate):
            errors.append(f"Row {idx}: skipped (no customer_name or plate)"); continue
        cid = None
        cust_key = (cname.lower(), cphone)
        if cust_key in seen_customers:
            cid = seen_customers[cust_key]
        elif cname:
            existing = None
            if cphone:
                existing = await db.customers.find_one({"name": cname, "phone": cphone}, {"_id": 0, "id": 1})
            if not existing:
                existing = await db.customers.find_one({"name": cname}, {"_id": 0, "id": 1})
            if existing:
                cid = existing["id"]; reused_customers += 1
            else:
                new = Customer(name=cname, phone=cphone, email=row.get("customer_email") or "")
                await db.customers.insert_one(new.model_dump())
                cid = new.id; created_customers += 1
            seen_customers[cust_key] = cid
        if not cid:
            errors.append(f"Row {idx}: could not link to a customer"); continue
        # Dedupe: skip if this customer already has a vehicle with the same normalised plate.
        nplate = plate.upper().replace("-", "").replace(" ", "").strip()
        if nplate:
            dup = await db.vehicles.find_one(
                {"customer_id": cid, "$expr": {"$eq": [
                    {"$replaceAll": {"input": {"$replaceAll": {"input": {"$toUpper": "$plate"}, "find": "-", "replacement": ""}}, "find": " ", "replacement": ""}},
                    nplate,
                ]}},
                {"_id": 0, "id": 1}
            )
            if dup:
                errors.append(f"Row {idx}: skipped duplicate plate {plate}")
                continue
        oil = row.get("next_oil_change_km")
        try: oil_int = int(oil) if oil else None
        except (TypeError, ValueError): oil_int = None
        veh = Vehicle(
            customer_id=cid, make=row.get("make", ""), model=row.get("model", ""),
            year=row.get("year", ""), plate=plate, color=row.get("color", ""),
            km=row.get("km", ""), country=(row.get("country") or "NL").upper()[:3],
            apk_expiry=(row.get("apk_expiry") or None),
            next_oil_change_km=oil_int, vin=row.get("vin", ""), notes=row.get("notes", ""),
        )
        await db.vehicles.insert_one(veh.model_dump())
        created_vehicles += 1
    return {
        "created_customers": created_customers,
        "reused_customers": reused_customers,
        "created_vehicles": created_vehicles,
        "errors": errors[:20],
    }


@api_router.get("/bay-board")
async def bay_board(user: dict = Depends(require_permission("calendar.view"))):
    """Live-status snapshot of every open/in-progress job card for the workshop TV."""
    cards = await db.repairs.find(
        {"status": {"$in": ["open", "in_progress"]}},
        {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    now = datetime.now(timezone.utc)
    out = []
    for c in cards:
        started_at = c.get("created_at")
        try:
            started_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00")) if started_at else now
        except Exception:
            started_dt = now
        hours_in_shop = round((now - started_dt).total_seconds() / 3600.0, 1)
        running_log = next((tl for tl in (c.get("time_logs") or []) if not tl.get("stopped_at")), None)
        live_since = running_log.get("started_at") if running_log else None
        total_min = sum(float(tl.get("minutes") or 0) for tl in (c.get("time_logs") or []) if tl.get("stopped_at"))
        out.append({
            "id": c["id"], "card_number": c.get("card_number"),
            "customer_name": c.get("customer_name") or "",
            "car_make": c.get("car_make") or "", "car_model": c.get("car_model") or "",
            "car_year": c.get("car_year") or "", "car_plate": c.get("car_plate") or "",
            "car_country": c.get("car_country") or "NL",
            "status": c.get("status"), "mechanic_name": c.get("mechanic_name") or "",
            "created_at": started_at,
            "hours_in_shop": hours_in_shop,
            "clocked_minutes": round(total_min, 1),
            "live_since": live_since,
            "special_parts_pending": sum(1 for sp in (c.get("special_parts") or []) if sp.get("status") == "ordered"),
            "complaint": (c.get("complaint") or "")[:80],
            "estimated_hours": c.get("estimated_hours") or 0,
            "priority": c.get("priority") or "normal",
        })
    return {"cards": out, "generated_at": now.isoformat()}


def _norm_plate(s: str) -> str:
    return (s or "").upper().replace("-", "").replace(" ", "").strip()

# Strict — require at least one hyphen or space between blocks so we don't
# accidentally lift "23 plat" out of a supplier's description text.
_PLATE_RE = re.compile(r"\b([A-Z]{1,3}[- ][A-Z0-9]{1,4}[- ][A-Z0-9]{1,4})\b")

@api_router.post("/special-parts/scan-delivery")
async def scan_delivery(payload: dict, user: dict = Depends(require_permission("delivery_scan.use"))):
    """Scan a delivery-note barcode / typed text."""
    text = (payload.get("code") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty code")
    # Uppercase before regex so lowercase barcode/OCR text still matches.
    text_upper = text.upper()
    plate = ""
    m = _PLATE_RE.search(text_upper)
    if m:
        plate = m.group(1)
    else:
        cleaned = _norm_plate(text)
        if 3 <= len(cleaned) <= 10 and any(ch.isalpha() for ch in cleaned) and any(ch.isdigit() for ch in cleaned):
            plate = text.upper()
    matches = []
    if plate:
        nplate = _norm_plate(plate)
        cards = await db.repairs.find(
            {"status": {"$in": ["open", "in_progress"]}},
            {"_id": 0, "id": 1, "card_number": 1, "car_plate": 1, "car_make": 1, "car_model": 1, "customer_name": 1, "special_parts": 1}
        ).to_list(300)
        for c in cards:
            if _norm_plate(c.get("car_plate", "")) == nplate:
                matches.append({
                    "id": c["id"], "card_number": c.get("card_number"),
                    "car_plate": c.get("car_plate"),
                    "car_make": c.get("car_make"), "car_model": c.get("car_model"),
                    "customer_name": c.get("customer_name"),
                    "pending_special_parts": sum(1 for sp in (c.get("special_parts") or []) if sp.get("status") == "ordered"),
                })
    if not matches:
        cards = await db.repairs.find(
            {"status": {"$in": ["open", "in_progress"]}},
            {"_id": 0, "id": 1, "card_number": 1, "car_plate": 1, "car_make": 1, "car_model": 1, "customer_name": 1}
        ).sort("created_at", -1).limit(50).to_list(50)
        return {"matched": False, "detected_plate": plate, "candidates": cards}
    return {"matched": True, "detected_plate": plate, "matches": matches}


# =========================
# OCR — full A4 delivery note (Claude Sonnet vision)
# =========================
_OCR_SYSTEM = (
    "You extract structured data from a photograph of an automotive supplier's delivery note "
    "(packing slip / pakbon / bon de livraison). The paper is A4 and may list ONE OR MORE ordered "
    "parts for a specific vehicle. You must return STRICT JSON — no prose, no code fences.\n\n"
    "Schema — always return every key, use empty string / 0 when unknown, never invent values:\n"
    "{\n"
    "  \"plate\": string,           // vehicle licence plate e.g. 'B-DE-9022' or 'NL-42-ABC'\n"
    "  \"supplier_name\": string,   // supplier / leverancier name from the letterhead\n"
    "  \"confidence\": number,      // 0..1 — how sure you are the extraction is correct\n"
    "  \"notes\": string,           // one short line if something looks off, otherwise empty\n"
    "  \"parts\": [                 // EVERY ordered line on the pakbon — do not merge or drop rows\n"
    "    {\n"
    "      \"part_name\": string,   // human-readable name e.g. 'Front brake pads'\n"
    "      \"part_number\": string, // OEM / manufacturer part number e.g. '34116794300'\n"
    "      \"quantity\": number,    // qty ordered (integer). Default 1 if not shown.\n"
    "      \"unit_cost\": number,   // purchase price (inkoop) per unit in EUR\n"
    "      \"unit_price\": number   // sell price (verkoop) per unit in EUR — same as unit_cost if only one price appears\n"
    "    }\n"
    "  ]\n"
    "}\n\n"
    "Rules:\n"
    "- ALWAYS include every ordered line in the parts array — a single pakbon can contain 2, 5, 10 or more items.\n"
    "- Do NOT collapse similar items into one row — if the pakbon lists them separately, return them separately.\n"
    "- Prices are in EUR — strip currency symbols, use dot as decimal separator, no thousands separators.\n"
    "- The plate letters are always uppercase.\n"
    "- If two prices appear (cost + sell), unit_cost = the lower/inkoop, unit_price = the higher/verkoop.\n"
    "- If only one price appears, put it in BOTH unit_cost and unit_price.\n"
    "- Return ONLY the JSON object, nothing else."
)


class OcrDeliveryPayload(BaseModel):
    image_base64: str
    mime: Optional[str] = "image/jpeg"


@api_router.post("/special-parts/ocr-delivery-note")
async def ocr_delivery_note(payload: OcrDeliveryPayload, user: dict = Depends(require_permission("delivery_scan.use"))):
    """Full-page OCR of an A4 delivery note using Claude Sonnet 4.6 vision. Returns
    structured JSON: plate, part_name, part_number, unit_cost, unit_price, quantity, supplier_name."""
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        raise HTTPException(status_code=503, detail="Vision OCR unavailable — EMERGENT_LLM_KEY not configured")
    b64 = (payload.image_base64 or "").strip()
    if not b64:
        raise HTTPException(status_code=400, detail="image_base64 is required")
    # Strip a data URL prefix if the client sent one
    if b64.startswith("data:"):
        try: b64 = b64.split(",", 1)[1]
        except IndexError: pass

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"OCR library not installed: {e}")

    chat = LlmChat(
        api_key=key,
        session_id=f"ocr-{uuid.uuid4()}",
        system_message=_OCR_SYSTEM,
    ).with_model("anthropic", "claude-sonnet-4-6")

    prompt = (
        "This is a photograph of an automotive supplier's A4 delivery note. Extract the fields per the schema "
        "in your system message. Return ONLY the JSON object, no code fences, no explanations."
    )
    try:
        reply = await chat.send_message(UserMessage(
            text=prompt,
            file_contents=[ImageContent(image_base64=b64)],
        ))
    except Exception as e:
        logger.error(f"OCR chat error: {e}")
        raise HTTPException(status_code=502, detail=f"Vision OCR failed: {e}")

    raw = (reply or "").strip()
    # Some models still wrap JSON in a code fence — strip it defensively.
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        import json as _json
        parsed = _json.loads(raw)
    except Exception:
        # Sometimes the model adds a short intro — try to locate the first {...} block.
        m2 = re.search(r"\{[\s\S]*\}", raw)
        if not m2:
            raise HTTPException(status_code=502, detail=f"OCR returned non-JSON: {raw[:200]}")
        try:
            import json as _json
            parsed = _json.loads(m2.group(0))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OCR JSON parse failed: {e}")

    # Normalise + coerce
    def _num(v):
        if v is None: return 0.0
        if isinstance(v, (int, float)): return float(v)
        s = str(v).replace("€", "").replace("EUR", "").replace(",", ".").strip()
        try: return float(re.sub(r"[^0-9.\-]", "", s) or 0)
        except ValueError: return 0.0

    def _one_part(raw_p: dict) -> dict:
        p = {
            "part_name": str(raw_p.get("part_name", "")).strip(),
            "part_number": str(raw_p.get("part_number", "")).strip(),
            "quantity": max(1, int(_num(raw_p.get("quantity")) or 1)),
            "unit_cost": round(_num(raw_p.get("unit_cost")), 2),
            "unit_price": round(_num(raw_p.get("unit_price")), 2),
        }
        # Mirror a single price to both columns so downstream never has to.
        if p["unit_price"] and not p["unit_cost"]: p["unit_cost"] = p["unit_price"]
        if p["unit_cost"] and not p["unit_price"]: p["unit_price"] = p["unit_cost"]
        return p

    # New multi-line schema: model returns `parts: [...]`.  Older captures may
    # still return the flat single-part shape, so we handle both.
    parts_raw = parsed.get("parts")
    if isinstance(parts_raw, list) and parts_raw:
        parts = [_one_part(p) for p in parts_raw if isinstance(p, dict)]
        # Drop empty rows the model sometimes emits (blank name AND no part number).
        parts = [p for p in parts if p["part_name"] or p["part_number"]]
    else:
        parts = [_one_part(parsed)]  # legacy flat shape

    if not parts:
        parts = [_one_part({})]   # keep the caller happy even on a bad read

    first = parts[0]
    out = {
        "plate": str(parsed.get("plate", "")).strip().upper(),
        "supplier_name": str(parsed.get("supplier_name", "")).strip(),
        "confidence": max(0.0, min(1.0, _num(parsed.get("confidence")))),
        "notes": str(parsed.get("notes", "")).strip(),
        "parts": parts,
        # Legacy top-level fields — mirror the first line so existing callers
        # (Delivery scan single-part flow, older mobile builds) keep working.
        "part_name": first["part_name"],
        "part_number": first["part_number"],
        "quantity": first["quantity"],
        "unit_cost": first["unit_cost"],
        "unit_price": first["unit_price"],
    }
    return out


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
    await db.tenants.create_index("id", unique=True)
    # Init cloud object storage (best-effort — backup UI still works locally without it)
    try:
        from backup import init_storage
        init_storage()
        logger.info("Emergent Object Storage initialised for backups")
    except Exception as e:
        logger.warning(f"Object storage init failed (cloud backup will be unavailable): {e}")
    # Seed admin — DISABLED (2026-02-26p).  We no longer auto-recreate a
    # default owner / default tenant on every boot: the user was seeing a
    # deleted garage "come back on its own" because this block re-inserted it.
    # First-run onboarding now happens via the public landing signup or the
    # Super Admin → "New garage" button.  Only the platform super_admin is
    # still seeded (further down) so the operator can always log in.
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@garage.com").lower()
    # ------------------------------------------------------------------
    # Phase 1 (multi-tenant): ensure the platform super_admin exists and
    # self-heal its tenant_id.  Default-tenant / default-owner seeding
    # is intentionally removed so a fresh install starts empty.
    # ------------------------------------------------------------------
    try:
        default_tenant = await _raw_db.tenants.find_one({"is_default": True}, {"_id": 0})
        default_tid = default_tenant["id"] if default_tenant else None

        # Backfill tenant_id everywhere it is missing so historic data belongs
        # to the default garage.  Skipped when there is no default tenant yet
        # (fresh install) — new garages fill their own tenant_id on insert.
        if default_tid:
            tenant_scoped = [
                "users", "settings", "suppliers", "customers", "vehicles",
                "inventory", "parts_catalog", "transactions", "purchase_orders",
                "repairs", "invoices", "appointments", "reminders",
                "payment_methods", "payment_entries", "cash_movements",
                "public_invoice_pdfs", "vehicle_events",
            ]
            patched_total = 0
            for coll in tenant_scoped:
                res = await _raw_db[coll].update_many(
                    {"$or": [{"tenant_id": {"$exists": False}}, {"tenant_id": None}, {"tenant_id": ""}]},
                    {"$set": {"tenant_id": default_tid}},
                )
                patched_total += res.modified_count
            if patched_total:
                logger.info(f"Multi-tenant backfill: assigned tenant_id on {patched_total} historic docs")

            # Migrate the legacy singleton settings doc (_id: "garage") to the
            # per-tenant convention (_id: "garage:<default_tid>").
            legacy = await _raw_db.settings.find_one({"_id": "garage"})
            if legacy:
                new_id = f"garage:{default_tid}"
                if not await _raw_db.settings.find_one({"_id": new_id}):
                    new_doc = {**legacy, "_id": new_id, "tenant_id": default_tid}
                    await _raw_db.settings.insert_one(new_doc)
                await _raw_db.settings.delete_one({"_id": "garage"})
                logger.info(f"Migrated legacy settings doc to {new_id}")

        # Seed platform super_admin from env (never overrides an existing one).
        sa_email = os.environ.get("SUPER_ADMIN_EMAIL", "platform@pitstock.app").lower()
        sa_password = os.environ.get("SUPER_ADMIN_PASSWORD", "platform123")
        if not await _raw_db.users.find_one({"email": sa_email}):
            await _raw_db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": sa_email,
                "name": "Platform Admin",
                "role": "super_admin",
                "tenant_id": None,  # super_admin transcends tenants
                "password_hash": hash_password(sa_password),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            logger.info(f"Seeded super_admin user: {sa_email}")

        # Self-heal: every super_admin MUST have tenant_id=None so a tenant
        # purge can never sweep them away.  A past impersonation / profile
        # update bug could have stamped a tenant_id on the platform admin —
        # clear it here on every boot so the bug can't lock out the platform.
        heal = await _raw_db.users.update_many(
            {"role": "super_admin", "tenant_id": {"$ne": None}},
            {"$set": {"tenant_id": None}},
        )
        if heal.modified_count:
            logger.warning(f"Cleared tenant_id from {heal.modified_count} super_admin user(s) — recovered from purge-lockout risk")
    except Exception as e:
        logger.exception(f"Multi-tenant startup migration failed: {e}")
    # ------------------------------------------------------------------
    # One-off backfill: copy `car_country` / `car_plate` from each linked
    # repair card onto historical invoices so the printed plate badge on
    # OLD invoices renders with the correct country colour (DE white, F
    # blue, TR red …) once the setting is toggled on.
    # ------------------------------------------------------------------
    try:
        stale = await db.invoices.find(
            {"repair_id": {"$exists": True, "$ne": None},
             "$or": [{"car_country": {"$in": [None, ""]}}, {"car_country": {"$exists": False}}]},
            {"_id": 0, "id": 1, "repair_id": 1},
        ).to_list(5000)
        patched = 0
        for row in stale:
            rep = await db.repairs.find_one({"id": row["repair_id"]}, {"_id": 0, "car_country": 1, "car_plate": 1})
            if not rep:
                continue
            await db.invoices.update_one(
                {"id": row["id"]},
                {"$set": {
                    "car_country": rep.get("car_country") or "NL",
                    "car_plate":   rep.get("car_plate")   or "",
                }},
            )
            patched += 1
        if patched:
            logger.info(f"Backfilled car_country/car_plate on {patched} historical invoices")
    except Exception as e:
        logger.warning(f"Invoice country backfill skipped: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
