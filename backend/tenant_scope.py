"""
Multi-tenant query isolation — Phase 1b.

Wraps every "business" MongoDB collection in a proxy that automatically:
  1. Injects the current request's `tenant_id` into every filter/pipeline.
  2. Stamps `tenant_id` on every inserted document (and `$setOnInsert` payloads
     during upserts).
  3. Rewrites the legacy `_id: "garage"` used by the settings collection to
     `_id: "garage:<tenant_id>"` so each tenant gets its own settings doc
     without touching the 150 existing endpoints.

The current tenant is tracked in a ContextVar that `get_current_user` sets on
each authenticated request.  When the ContextVar is unset (super_admin token,
background tasks, cron webhooks, startup migrations) NO scoping is applied —
the caller sees the raw multi-tenant view.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Optional


current_tenant_id: ContextVar[Optional[str]] = ContextVar("current_tenant_id", default=None)


# Business collections whose docs belong to exactly one tenant.
_SCOPED = {
    "users", "settings", "suppliers", "customers", "vehicles",
    "inventory", "parts_catalog", "transactions", "purchase_orders",
    "repairs", "invoices", "appointments", "reminders",
    "payment_methods", "payment_entries", "cash_movements",
    "public_invoice_pdfs", "vehicle_events",
}

# Collections that use a hard-coded `_id` string historically ("garage" for the
# global settings doc).  We keep call-sites unchanged and rewrite the id here.
_ID_REWRITE = {
    "settings": ("_id", "garage", lambda tid: f"garage:{tid}"),
}


class TenantCollection:
    """Proxy around a Motor collection that scopes reads / writes to the
    tenant carried in `current_tenant_id`.  Preserves 1:1 method compatibility
    with AsyncIOMotorCollection for the operations we actually use."""

    def __init__(self, coll, name: str):
        self._coll = coll
        self._name = name

    # -- private helpers -------------------------------------------------
    def _tid(self):
        return current_tenant_id.get()

    def _rewrite_id(self, obj):
        if not isinstance(obj, dict) or self._name not in _ID_REWRITE:
            return obj
        field, legacy, fn = _ID_REWRITE[self._name]
        tid = self._tid()
        if tid and obj.get(field) == legacy:
            obj = dict(obj)
            obj[field] = fn(tid)
        return obj

    def _scope_filter(self, filt):
        filt = self._rewrite_id(filt or {})
        tid = self._tid()
        if tid is None or "tenant_id" in filt:
            return filt
        return {**filt, "tenant_id": tid}

    def _stamp_doc(self, doc):
        doc = self._rewrite_id(dict(doc or {}))
        tid = self._tid()
        if tid and "tenant_id" not in doc:
            doc["tenant_id"] = tid
        return doc

    def _stamp_update(self, update):
        """For upserts, ensure the on-insert doc gets tenant_id and any _id
        rewrite is applied to $set / $setOnInsert."""
        if not isinstance(update, dict):
            return update
        tid = self._tid()
        upd = {k: (dict(v) if isinstance(v, dict) else v) for k, v in update.items()}
        if tid:
            soi = dict(upd.get("$setOnInsert") or {})
            if "tenant_id" not in soi:
                soi["tenant_id"] = tid
            upd["$setOnInsert"] = soi
        # _id rewrite on $set / $setOnInsert
        if self._name in _ID_REWRITE:
            field, legacy, fn = _ID_REWRITE[self._name]
            if tid:
                for op in ("$set", "$setOnInsert"):
                    inner = upd.get(op)
                    if isinstance(inner, dict) and inner.get(field) == legacy:
                        inner[field] = fn(tid)
                        upd[op] = inner
        return upd

    # -- public passthrough / scoped surface -----------------------------
    def find(self, filt=None, *args, **kwargs):
        return self._coll.find(self._scope_filter(filt), *args, **kwargs)

    async def find_one(self, filt=None, *args, **kwargs):
        return await self._coll.find_one(self._scope_filter(filt), *args, **kwargs)

    async def count_documents(self, filt=None, *args, **kwargs):
        return await self._coll.count_documents(self._scope_filter(filt), *args, **kwargs)

    async def distinct(self, key, filt=None, *args, **kwargs):
        return await self._coll.distinct(key, self._scope_filter(filt), *args, **kwargs)

    async def insert_one(self, doc, *args, **kwargs):
        return await self._coll.insert_one(self._stamp_doc(doc), *args, **kwargs)

    async def insert_many(self, docs, *args, **kwargs):
        return await self._coll.insert_many([self._stamp_doc(d) for d in docs], *args, **kwargs)

    async def update_one(self, filt, update, *args, **kwargs):
        return await self._coll.update_one(self._scope_filter(filt), self._stamp_update(update), *args, **kwargs)

    async def update_many(self, filt, update, *args, **kwargs):
        return await self._coll.update_many(self._scope_filter(filt), self._stamp_update(update), *args, **kwargs)

    async def delete_one(self, filt, *args, **kwargs):
        return await self._coll.delete_one(self._scope_filter(filt), *args, **kwargs)

    async def delete_many(self, filt, *args, **kwargs):
        return await self._coll.delete_many(self._scope_filter(filt), *args, **kwargs)

    async def find_one_and_update(self, filt, update, *args, **kwargs):
        return await self._coll.find_one_and_update(
            self._scope_filter(filt), self._stamp_update(update), *args, **kwargs
        )

    async def find_one_and_delete(self, filt, *args, **kwargs):
        return await self._coll.find_one_and_delete(self._scope_filter(filt), *args, **kwargs)

    def aggregate(self, pipeline, *args, **kwargs):
        tid = self._tid()
        if tid is not None and pipeline:
            first = pipeline[0]
            if isinstance(first, dict) and "$match" in first:
                new_match = {**first["$match"]}
                new_match.setdefault("tenant_id", tid)
                pipeline = [{"$match": new_match}, *pipeline[1:]]
            else:
                pipeline = [{"$match": {"tenant_id": tid}}, *pipeline]
        return self._coll.aggregate(pipeline, *args, **kwargs)

    def create_index(self, *args, **kwargs):
        return self._coll.create_index(*args, **kwargs)

    def __getattr__(self, name):
        # Anything we haven't wrapped — return the underlying collection's attr.
        # NOTE: only reached for attrs not defined on this class.
        return getattr(self._coll, name)


class TenantAwareDb:
    """Drop-in replacement for a Motor `AsyncIOMotorDatabase` that wraps every
    scoped collection in a `TenantCollection` while passing everything else
    through unchanged."""

    def __init__(self, real_db):
        self._db = real_db

    def __getattr__(self, name):
        coll = getattr(self._db, name)
        if name in _SCOPED:
            return TenantCollection(coll, name)
        return coll

    def __getitem__(self, name):
        return self.__getattr__(name)
