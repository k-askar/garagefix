"""
Tenant management — Phase 1 of the multi-tenant SaaS refactor.

Data model:
  tenants collection: { id, name, country, active, created_at, plan }
  users.tenant_id           — which garage a staff/owner belongs to
  users.role                — "super_admin" | "owner" | "staff"
  (Business collections will get tenant_id in Phase 1b via the startup
   backfill in server.py, but query filtering is NOT yet enforced here.)

Only `super_admin` users can create/list tenants. `owner` and `staff` see and
edit their own tenant via /tenants/me.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field


class Tenant(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    country: str = "NL"          # ISO country code — drives default VAT, RDW toggle etc.
    plan: str = "trial"          # "trial" | "starter" | "pro"
    active: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    owner_email: str = ""        # convenience — populated when we create the seed owner


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


def register(db, get_current_user, require_super_admin):
    router = APIRouter()

    @router.get("/tenants/me")
    async def get_my_tenant(user: dict = Depends(get_current_user)):
        tid = user.get("tenant_id")
        if not tid:
            raise HTTPException(status_code=404, detail="User has no tenant assigned yet")
        t = await db.tenants.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return t

    @router.get("/tenants", response_model=List[Tenant])
    async def list_tenants(user: dict = Depends(require_super_admin)):
        return await db.tenants.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

    @router.post("/tenants", response_model=Tenant)
    async def create_tenant(payload: TenantCreate, user: dict = Depends(require_super_admin)):
        t = Tenant(
            name=payload.name.strip(),
            country=(payload.country or "NL").upper(),
            plan=payload.plan or "trial",
            owner_email=(payload.owner_email or "").lower().strip(),
        )
        await db.tenants.insert_one(t.model_dump())
        # Auto-provision a per-tenant settings doc so the garage page loads
        # cleanly even before the owner opens /settings for the first time.
        default_settings = {
            "_id": f"garage:{t.id}",
            "tenant_id": t.id,
            "name": t.name,
            "country": t.country,
            "tax_rate": 21.0 if t.country == "NL" else 0.0,
            "invoice_currency_symbol_pos": "suffix",
            "created_at": t.created_at,
        }
        await db.settings.update_one(
            {"_id": default_settings["_id"]},
            {"$setOnInsert": default_settings},
            upsert=True,
        )
        return t

    @router.put("/tenants/{tenant_id}", response_model=Tenant)
    async def update_tenant(tenant_id: str, payload: TenantUpdate, user: dict = Depends(require_super_admin)):
        updates = {k: v for k, v in payload.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update")
        res = await db.tenants.find_one_and_update(
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
        # Soft-delete: mark inactive.  Real deletion in Phase 3 once we know
        # cascading semantics.
        res = await db.tenants.update_one({"id": tenant_id}, {"$set": {"active": False}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return {"ok": True}

    @router.get("/tenants/{tenant_id}/stats")
    async def tenant_stats(tenant_id: str, user: dict = Depends(require_super_admin)):
        """Quick counts so the Super Admin table shows life across each garage."""
        f = {"tenant_id": tenant_id}
        return {
            "users":     await db.users.count_documents(f),
            "customers": await db.customers.count_documents(f),
            "vehicles":  await db.vehicles.count_documents(f),
            "invoices":  await db.invoices.count_documents(f),
            "repairs":   await db.repairs.count_documents(f),
            "inventory": await db.inventory.count_documents(f),
        }

    return router
