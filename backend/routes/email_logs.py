"""
Email delivery audit log + manual resend endpoints.

Every call to `send_email()` in the app writes a row to `db.email_logs`
(accepted or failed).  Owners can then review delivery status in the UI and
retry a failed message without recomputing invoices/reminders.

Exposes:
    register(db, get_current_user, send_email, require_super_admin)
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional


def register(db, get_current_user, send_email, require_super_admin, require_owner=None):
    router = APIRouter()
    # `email-logs` are owner-scoped (they contain every outbound email — customer
    # addresses, invoice content).  If `require_owner` is not wired for some
    # reason we still fall back to authenticated so nothing 500s in dev.
    _guard = require_owner if require_owner else get_current_user

    @router.get("/email-logs")
    async def list_email_logs(
        limit: int = Query(100, ge=1, le=500),
        status: Optional[str] = None,
        purpose: Optional[str] = None,
        q: Optional[str] = None,
        user: dict = Depends(_guard),
    ):
        """List email attempts for the current tenant (or all tenants for
        super_admin without an impersonation scope).  Newest first."""
        query: dict = {}
        if status in ("accepted", "failed"):
            query["status"] = status
        if purpose:
            query["purpose"] = purpose
        if q:
            query["$or"] = [
                {"to": {"$regex": q, "$options": "i"}},
                {"subject": {"$regex": q, "$options": "i"}},
            ]
        # tenant_scope proxy will inject tenant_id automatically for
        # non-super-admin callers; super_admin sees all rows.
        cur = db.email_logs.find(query, {"_id": 0, "html": 0}).sort("created_at", -1).limit(limit)
        return await cur.to_list(length=limit)

    @router.post("/email-logs/{log_id}/resend")
    async def resend_email(log_id: str, user: dict = Depends(_guard)):
        """Retry sending a previously-logged email using its stored HTML +
        subject.  Attachments are NOT re-sent (we don't persist the base64
        body); UI should trigger a fresh invoice/PO send if a PDF is needed."""
        # We need the raw html back — bypass the list projection above.
        row = await db.email_logs.find_one({"id": log_id})
        if not row:
            raise HTTPException(status_code=404, detail="Email log not found")
        if not row.get("to") or not row.get("subject") or not row.get("html"):
            raise HTTPException(status_code=400, detail="Log is missing recipient / subject / body")
        try:
            provider_id = await send_email(
                to=row["to"],
                subject=row["subject"],
                html=row["html"],
                purpose=row.get("purpose") or "resend",
                related_id=row.get("related_id"),
            )
        except HTTPException as he:
            raise he
        return {"ok": True, "provider_id": provider_id}

    return router
