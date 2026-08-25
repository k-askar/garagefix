"""
Tenant management — Phase 1 + 1b of the multi-tenant SaaS refactor.

* Every business collection auto-scopes to `tenant_id` via tenant_scope.py.
* Creating a tenant here (a) seeds a per-tenant settings doc with
  country-appropriate defaults and (b) provisions the owner account with a
  password-setup email (delegated to server.py so the real send_email + link
  builder stay in one place).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field


# Sensible per-country defaults so a garage in DE / FR / GB doesn't inherit NL
# quirks like the 21 % BTW rate or RDW/KvK-only features.  Fill in more as the
# platform expands.
COUNTRY_DEFAULTS = {
    "NL": {"tax_rate": 21.0, "currency_symbol": "€", "currency_code": "EUR", "plate_country": "NL",
           "features": {"rdw": True,  "kvk": True,  "ideal_qr": True}},
    "BE": {"tax_rate": 21.0, "currency_symbol": "€", "currency_code": "EUR", "plate_country": "BE",
           "features": {"rdw": False, "kvk": False, "ideal_qr": True}},
    "DE": {"tax_rate": 19.0, "currency_symbol": "€", "currency_code": "EUR", "plate_country": "DE",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "FR": {"tax_rate": 20.0, "currency_symbol": "€", "currency_code": "EUR", "plate_country": "FR",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "ES": {"tax_rate": 21.0, "currency_symbol": "€", "currency_code": "EUR", "plate_country": "ES",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "IT": {"tax_rate": 22.0, "currency_symbol": "€", "currency_code": "EUR", "plate_country": "IT",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "GB": {"tax_rate": 20.0, "currency_symbol": "£", "currency_code": "GBP", "plate_country": "GB",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "TR": {"tax_rate": 20.0, "currency_symbol": "₺", "currency_code": "TRY", "plate_country": "TR",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "MA": {"tax_rate": 20.0, "currency_symbol": "MAD", "currency_code": "MAD", "plate_country": "MA",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "SA": {"tax_rate": 15.0, "currency_symbol": "﷼", "currency_code": "SAR", "plate_country": "SA",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "AE": {"tax_rate": 5.0,  "currency_symbol": "AED", "currency_code": "AED", "plate_country": "AE",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
    "EG": {"tax_rate": 14.0, "currency_symbol": "£", "currency_code": "EGP", "plate_country": "EG",
           "features": {"rdw": False, "kvk": False, "ideal_qr": False}},
}


class Tenant(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    country: str = "NL"
    plan: str = "trial"
    active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    owner_email: str = ""


class TenantCreate(BaseModel):
    name: str
    country: str = "NL"
    plan: Optional[Literal["trial", "starter", "pro"]] = "trial"
    owner_email: Optional[str] = None
    owner_name: Optional[str] = None


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    country: Optional[str] = None
    plan: Optional[Literal["trial", "starter", "pro"]] = None
    active: Optional[bool] = None


def register(db, get_current_user, require_super_admin, provision_owner=None):
    """provision_owner: async (tenant_id, email, name) -> {email, link, emailed, already_exists}"""
    router = APIRouter()

    @router.get("/tenants/me")
    async def get_my_tenant(user: dict = Depends(get_current_user)):
        tid = user.get("tenant_id")
        if not tid:
            raise HTTPException(status_code=404, detail="User has no tenant assigned yet")
        # Access via `_db` — tenants collection is not tenant-scoped.
        t = await db._db.tenants.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return t

    @router.get("/tenants", response_model=List[Tenant])
    async def list_tenants(user: dict = Depends(require_super_admin)):
        return await db._db.tenants.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

    @router.post("/tenants")
    async def create_tenant(payload: TenantCreate, user: dict = Depends(require_super_admin)):
        country = (payload.country or "NL").upper()
        t = Tenant(
            name=payload.name.strip(),
            country=country,
            plan=payload.plan or "trial",
            owner_email=(payload.owner_email or "").lower().strip(),
        )
        await db._db.tenants.insert_one(t.model_dump())

        # Country-driven defaults so a DE / FR / GB garage doesn't inherit NL
        # tax and feature flags.
        defaults = COUNTRY_DEFAULTS.get(country) or COUNTRY_DEFAULTS["NL"]
        settings_doc = {
            "_id": f"garage:{t.id}",
            "tenant_id": t.id,
            "name": t.name,
            "country": country,
            "tax_rate": defaults["tax_rate"],
            "currency_symbol": defaults["currency_symbol"],
            "currency_code": defaults["currency_code"],
            "plate_country": defaults["plate_country"],
            "features": defaults["features"],
            "created_at": t.created_at,
        }
        await db._db.settings.update_one(
            {"_id": settings_doc["_id"]},
            {"$setOnInsert": settings_doc},
            upsert=True,
        )

        # Provision the owner account (async, best-effort — tenant already
        # exists so 500s on the email delivery must not undo the create).
        onboarding = None
        if provision_owner and t.owner_email:
            try:
                onboarding = await provision_owner(t.id, t.owner_email, payload.owner_name or t.name)
            except Exception as e:
                onboarding = {"error": str(e)[:180]}

        return {**t.model_dump(), "onboarding": onboarding, "defaults_applied": country}

    @router.put("/tenants/{tenant_id}", response_model=Tenant)
    async def update_tenant(tenant_id: str, payload: TenantUpdate, user: dict = Depends(require_super_admin)):
        updates = {k: v for k, v in payload.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        res = await db._db.tenants.find_one_and_update(
            {"id": tenant_id},
            {"$set": updates},
            return_document=True,
            projection={"_id": 0},
        )
        if not res:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return res

    @router.delete("/tenants/{tenant_id}")
    async def delete_tenant(tenant_id: str, user: dict = Depends(require_super_admin)):
        res = await db._db.tenants.update_one({"id": tenant_id}, {"$set": {"active": False}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return {"ok": True}

    @router.get("/tenants/{tenant_id}/stats")
    async def tenant_stats(tenant_id: str, user: dict = Depends(require_super_admin)):
        f = {"tenant_id": tenant_id}
        return {
            "users":     await db._db.users.count_documents(f),
            "customers": await db._db.customers.count_documents(f),
            "vehicles":  await db._db.vehicles.count_documents(f),
            "invoices":  await db._db.invoices.count_documents(f),
            "repairs":   await db._db.repairs.count_documents(f),
            "inventory": await db._db.inventory.count_documents(f),
        }

    return router
