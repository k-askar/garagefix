"""
Service reminders (APK expiry, oil change due, and manual reminders).

Exposes:
    register(db, get_current_user, send_email) -> (APIRouter, send_reminder_task)

`send_reminder_task(rem_id)` is exported for the daily cron sweep in
routes/cron.py so we don't duplicate the delivery logic.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from html import escape
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Body
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# --- Reminder models -------------------------------------------------------
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
    kind: Literal["service", "apk", "oil"] = "service"
    vehicle_id: Optional[str] = None
    status: Literal["pending", "sent", "cancelled"] = "pending"
    channel: Literal["email", "whatsapp", "manual"] = "email"
    created_by: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    sent_at: Optional[str] = None


class ReminderCreate(BaseModel):
    customer_id: str
    reason: str = "Scheduled service"
    due_date: str
    due_km: Optional[int] = None
    last_service_km: Optional[int] = None
    kind: Literal["service", "apk", "oil"] = "service"
    vehicle_id: Optional[str] = None
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


def register(db, get_current_user, send_email):
    router = APIRouter()

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
            await db.reminders.update_one(
                {"id": rem_id},
                {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as e:
            logger.error(f"reminder send failed: {e}")

    @router.post("/reminders/scan-vehicles")
    async def scan_vehicle_reminders(user: dict = Depends(get_current_user)):
        """Scan every registered vehicle and auto-create pending reminders for:
           - APK expiring within 30 days (kind='apk')
           - Odometer within 500 km of next_oil_change_km (kind='oil')
           Existing pending/sent reminders for the same (vehicle, kind) are NOT duplicated."""
        today = datetime.now(timezone.utc).date()
        window_days = 30
        horizon = (today + timedelta(days=window_days)).isoformat()
        created = {"apk": 0, "oil": 0}
        vehicles = await db.vehicles.find({}, {"_id": 0}).to_list(5000)
        for v in vehicles:
            vid = v.get("id")
            cid = v.get("customer_id")
            if not cid:
                continue
            c = await db.customers.find_one({"id": cid}, {"_id": 0})
            if not c:
                continue

            # ---- APK expiry ----
            apk = (v.get("apk_expiry") or "").strip()
            if apk and apk <= horizon:
                existing = await db.reminders.find_one({
                    "vehicle_id": vid, "kind": "apk",
                    "status": {"$in": ["pending"]},
                }, {"_id": 0})
                if not existing:
                    days_left = (datetime.strptime(apk, "%Y-%m-%d").date() - today).days
                    reason = ("APK expired" if days_left < 0
                              else f"APK inspection due in {days_left} day(s)"
                              if days_left > 0 else "APK due today")
                    rem = Reminder(
                        customer_id=cid,
                        customer_name=c.get("name", ""), customer_email=c.get("email", ""),
                        reason=reason, due_date=apk, kind="apk", vehicle_id=vid,
                        car_plate=v.get("plate", ""), car_make=v.get("make", ""), car_model=v.get("model", ""),
                        created_by=user.get("email", ""),
                    )
                    await db.reminders.insert_one(rem.model_dump())
                    created["apk"] += 1

            # ---- Oil change ----
            try:
                next_km = int(v.get("next_oil_change_km") or 0)
                cur_km = int(str(v.get("km") or "0").replace(",", "").strip() or 0)
            except (ValueError, TypeError):
                next_km, cur_km = 0, 0
            if next_km > 0 and cur_km > 0 and (next_km - cur_km) <= 500:
                existing = await db.reminders.find_one({
                    "vehicle_id": vid, "kind": "oil",
                    "status": "pending",
                }, {"_id": 0})
                if not existing:
                    rem = Reminder(
                        customer_id=cid,
                        customer_name=c.get("name", ""), customer_email=c.get("email", ""),
                        reason=f"Oil change due at {next_km} km (current {cur_km})",
                        due_date=today.isoformat(), due_km=next_km, last_service_km=cur_km,
                        kind="oil", vehicle_id=vid,
                        car_plate=v.get("plate", ""), car_make=v.get("make", ""), car_model=v.get("model", ""),
                        created_by=user.get("email", ""),
                    )
                    await db.reminders.insert_one(rem.model_dump())
                    created["oil"] += 1
        return {"created": created, "total": created["apk"] + created["oil"], "scanned": len(vehicles)}

    @router.get("/reminders", response_model=List[Reminder])
    async def list_reminders(user: dict = Depends(get_current_user)):
        return await db.reminders.find({}, {"_id": 0}).sort("due_date", 1).to_list(500)

    @router.post("/reminders", response_model=Reminder)
    async def create_reminder(payload: ReminderCreate, user: dict = Depends(get_current_user)):
        c = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Customer not found")
        rem = Reminder(**payload.model_dump(),
                       customer_name=c.get("name", ""), customer_email=c.get("email", ""),
                       created_by=user.get("email", ""))
        await db.reminders.insert_one(rem.model_dump())
        return rem

    @router.post("/reminders/{rid}/send")
    async def send_reminder_now(rid: str, background: BackgroundTasks, user: dict = Depends(get_current_user)):
        rem = await db.reminders.find_one({"id": rid}, {"_id": 0})
        if not rem:
            raise HTTPException(status_code=404, detail="Not found")
        if not rem.get("customer_email"):
            raise HTTPException(status_code=400, detail="Customer has no email on file")
        background.add_task(_send_reminder, rid)
        return {"ok": True}

    @router.post("/reminders/{rid}/mark-sent")
    async def mark_reminder_sent(rid: str, payload: dict = Body(default={}), user: dict = Depends(get_current_user)):
        """Mark a reminder as manually sent (e.g. via WhatsApp) so the row flips
           from Pending to Sent in the UI. `channel` is stored for reporting."""
        rem = await db.reminders.find_one({"id": rid}, {"_id": 0})
        if not rem:
            raise HTTPException(status_code=404, detail="Not found")
        channel = (payload or {}).get("channel") or "manual"
        await db.reminders.update_one({"id": rid}, {"$set": {
            "status": "sent",
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "channel": channel,
        }})
        return {"ok": True}

    @router.delete("/reminders/{rid}")
    async def delete_reminder(rid: str, user: dict = Depends(get_current_user)):
        await db.reminders.delete_one({"id": rid})
        return {"ok": True}

    return router, _send_reminder
