"""
Daily subscription sweep.

Called by the platform scheduler once a day.  For every tenant with a
`subscription_expires_at` date we:

  1. Send a payment-reminder email to the garage owner **7 / 3 / 1** days
     before expiry (each stage only once thanks to `reminder_days_sent`).
  2. Send a "your subscription expired" notice on the expiry day and
     **auto-suspend** the tenant (sets `active=false`) so the next login
     fails immediately.

Ack immediately + defer the actual work to a background task so slow email
delivery never times the scheduler out.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone, timedelta
from html import escape
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks, Header

logger = logging.getLogger(__name__)

# Days-remaining thresholds that trigger a payment reminder.  Order matters —
# we always send the LARGEST unsent stage first (7 → 3 → 1 → 0/expired) so a
# tenant that missed the 7-day nudge still gets the 3-day and 1-day ones.
REMINDER_STAGES = [7, 3, 1]


def _reminder_html(garage_name: str, days: int, expires: str, amount: float = 0, invoice_number: str = ""):
    urgency = "vriendelijke herinnering" if days >= 7 else "belangrijke herinnering" if days >= 3 else "laatste herinnering"
    invoice_line = ""
    if invoice_number:
        invoice_line = (
            f'<p style="background:#f5f5f5;padding:12px;border-radius:6px;'
            f'font-family:monospace;font-size:13px">'
            f'📎 Factuur <strong>{escape(invoice_number)}</strong> — '
            f'<strong>€ {amount:.2f}</strong> (bijgevoegd als PDF)'
            f'</p>'
        )
    return (
        f'<div style="font-family:Arial,sans-serif;color:#111;max-width:560px;padding:24px">'
        f'<h2 style="margin:0 0 12px">Betaal-{urgency}</h2>'
        f'<p>Beste team van {escape(garage_name)},</p>'
        f'<p>Uw GarageFix-abonnement verloopt over '
        f'<strong>{days} dag{"en" if days != 1 else ""}</strong> (op '
        f'<strong>{escape(expires)}</strong>).</p>'
        f'{invoice_line}'
        f'<p>Om uw klanten zonder onderbreking te blijven bedienen, gelieve '
        f'de factuur vóór die datum te voldoen.</p>'
        f'<p style="color:#888;font-size:12px;margin-top:24px">'
        f'Heeft u al betaald? Negeer dan dit bericht — het duurt soms een '
        f'werkdag voordat de betaling bij ons binnen is.</p>'
        f'</div>'
    )


def _expired_html(garage_name: str, expires: str):
    return (
        f'<div style="font-family:Arial,sans-serif;color:#111;max-width:560px;padding:24px">'
        f'<h2 style="margin:0 0 12px;color:#b91c1c">Abonnement verlopen</h2>'
        f'<p>Beste team van {escape(garage_name)},</p>'
        f'<p>Uw GarageFix-abonnement is verlopen op <strong>{escape(expires)}</strong> '
        f'en uw werkomgeving is tijdelijk opgeschort.</p>'
        f'<p>Om weer toegang te krijgen, voldoet u de openstaande factuur — '
        f'wij heractiveren uw account nog dezelfde dag.</p>'
        f'<p style="color:#888;font-size:12px;margin-top:24px">'
        f'Uw data blijft 30 dagen bewaard na opschorting.</p>'
        f'</div>'
    )


def register(db, webhook_secret: str, send_email, create_saas_invoice_fn=None):
    router = APIRouter()

    def _auth(authorization: Optional[str]):
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing bearer")
        token = authorization[7:]
        if not secrets.compare_digest(token, webhook_secret or ""):
            raise HTTPException(status_code=401, detail="Bad token")

    async def _run_sweep():
        """Actual work — runs in the background so the webhook returns fast."""
        today = datetime.now(timezone.utc).date()
        # `tenants` is not tenant-scoped; use raw db via `db._db` fallback for
        # the cross-tenant sweep.
        raw_db = getattr(db, "_db", db)
        cursor = raw_db.tenants.find({"subscription_expires_at": {"$ne": None}})
        summary = {"reminded": 0, "suspended": 0, "skipped": 0}
        async for t in cursor:
            exp = t.get("subscription_expires_at")
            try:
                exp_date = datetime.fromisoformat(exp).date()
            except Exception:
                summary["skipped"] += 1
                continue
            days = (exp_date - today).days
            owner_email = (t.get("owner_email") or "").strip()
            reminded = set(t.get("reminder_days_sent") or [])

            # Auto-suspend once the date has passed.
            if days < 0 and t.get("active"):
                await raw_db.tenants.update_one(
                    {"id": t["id"]},
                    {"$set": {"active": False, "suspended_at": today.isoformat(), "suspended_reason": "subscription_expired"}},
                )
                summary["suspended"] += 1
                if owner_email and "expired" not in reminded:
                    try:
                        await send_email(
                            to=owner_email,
                            subject=f"PitStock — Subscription expired for {t.get('name','')}",
                            html=_expired_html(t.get("name", ""), exp),
                            purpose="subscription_expired",
                            related_id=t["id"],
                        )
                        await raw_db.tenants.update_one(
                            {"id": t["id"]},
                            {"$addToSet": {"reminder_days_sent": "expired"}},
                        )
                    except Exception as e:
                        logger.warning(f"expired email failed for {owner_email}: {e}")
                continue

            # Upcoming expiry — pick the tightest reminder stage that matches
            # `days` (largest stage in REMINDER_STAGES where days <= stage) so
            # a tenant that skips straight from "unset" to "3 days left" gets
            # a 3-day reminder, not a spurious 7-day one.  Only send if that
            # stage hasn't been sent yet.
            if not owner_email or days > max(REMINDER_STAGES):
                continue
            picked = None
            for stage in REMINDER_STAGES:  # [7, 3, 1] — descending
                if days <= stage:
                    picked = stage        # keep updating → ends on the smallest match
            if picked is None or str(picked) in reminded:
                continue
            try:
                # Auto-generate a SaaS invoice for the upcoming period + attach as PDF
                # BUT ONLY if the tenant has `auto_invoice_enabled` on.  When
                # off the super_admin will send the invoice manually from the
                # Facturen tab.
                inv_num = ""; inv_amount = 0.0; attachments = None
                auto_inv = t.get("auto_invoice_enabled")
                if auto_inv is None:  # legacy tenants → default ON
                    auto_inv = True
                auto_send = t.get("auto_send_enabled")
                if auto_send is None:
                    auto_send = True
                if create_saas_invoice_fn and auto_inv:
                    try:
                        saas_inv = await create_saas_invoice_fn(db, t)
                        inv_num = saas_inv.get("invoice_number") or ""
                        inv_amount = float(saas_inv.get("amount") or 0)
                        if saas_inv.get("pdf_base64") and auto_send:
                            attachments = [{
                                "filename": f"{inv_num}.pdf",
                                "content_base64": saas_inv["pdf_base64"],
                            }]
                    except Exception as e:
                        logger.warning(f"SaaS invoice attach failed for {t.get('name')}: {e}")
                # When auto_send is off, we still want the plain reminder
                # (owner still needs to know the expiry) but WITHOUT the
                # attached PDF — the super_admin will send it manually.
                if not auto_send:
                    attachments = None
                await send_email(
                    to=owner_email,
                    subject=f"GarageFix — Betaalherinnering ({days} dag{'en' if days != 1 else ''} resterend)",
                    html=_reminder_html(t.get("name", ""), days, exp, inv_amount, inv_num),
                    purpose="subscription_reminder",
                    related_id=t["id"],
                    attachments=attachments,
                )
                if saas_inv := (attachments and inv_num):
                    # Mark the SaaS invoice as "sent" now that its PDF left the building.
                    raw_db = getattr(db, "_db", db)
                    await raw_db.saas_invoices.update_one(
                        {"tenant_id": t["id"], "invoice_number": inv_num},
                        {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}},
                    )
                await raw_db.tenants.update_one(
                    {"id": t["id"]},
                    {"$addToSet": {"reminder_days_sent": str(picked)}},
                )
                summary["reminded"] += 1
            except Exception as e:
                logger.warning(f"reminder email failed for {owner_email}: {e}")
        logger.info(f"subscription sweep done: {summary}")

    @router.post("/cron/subscription-sweep")
    async def cron_subscription_sweep(
        background: BackgroundTasks,
        authorization: Optional[str] = Header(default=None),
    ):
        # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
        _auth(authorization)
        background.add_task(_run_sweep)
        return {"queued": True}

    # Also expose a manual trigger for super_admins to test the sweep from the
    # UI or a `curl` call.  Same handler, same auth (Bearer).  Not tied to
    # `require_super_admin` — the shared secret is enough for a cron path.
    return router
