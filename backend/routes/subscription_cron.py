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


def _reminder_html(garage_name: str, days: int, expires: str):
    urgency = "friendly reminder" if days >= 7 else "important reminder" if days >= 3 else "final reminder"
    return (
        f'<div style="font-family:Arial,sans-serif;color:#111;max-width:560px;padding:24px">'
        f'<h2 style="margin:0 0 12px">Payment {urgency}</h2>'
        f'<p>Hi {escape(garage_name)} team,</p>'
        f'<p>Your PitStock subscription expires in '
        f'<strong>{days} day{"s" if days != 1 else ""}</strong> (on '
        f'<strong>{escape(expires)}</strong>).</p>'
        f'<p>To keep serving your customers without interruption, please '
        f'settle your invoice before that date.</p>'
        f'<p style="color:#888;font-size:12px;margin-top:24px">'
        f'If you have already paid, please ignore this message — it can take '
        f'a working day for the payment to reach us.</p>'
        f'</div>'
    )


def _expired_html(garage_name: str, expires: str):
    return (
        f'<div style="font-family:Arial,sans-serif;color:#111;max-width:560px;padding:24px">'
        f'<h2 style="margin:0 0 12px;color:#b91c1c">Subscription expired</h2>'
        f'<p>Hi {escape(garage_name)} team,</p>'
        f'<p>Your PitStock subscription expired on <strong>{escape(expires)}</strong> '
        f'and your workspace has been temporarily suspended.</p>'
        f'<p>To restore access, settle your outstanding invoice and we will '
        f'reactivate your account the same day.</p>'
        f'<p style="color:#888;font-size:12px;margin-top:24px">'
        f'Data is preserved for 30 days after suspension.</p>'
        f'</div>'
    )


def register(db, webhook_secret: str, send_email):
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
                await send_email(
                    to=owner_email,
                    subject=f"PitStock — Payment reminder ({days} day{'s' if days != 1 else ''} left)",
                    html=_reminder_html(t.get("name", ""), days, exp),
                    purpose="subscription_reminder",
                    related_id=t["id"],
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
