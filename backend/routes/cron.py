"""
Cron trigger endpoints — invoked by the platform scheduler (Bearer-token auth).
Each handler acknowledges 2xx immediately and defers real work to the
background task pool so scheduler timeouts don't abort long-running jobs.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks, Header

logger = logging.getLogger(__name__)


def register(db, webhook_secret: str, send_reminder_task):
    router = APIRouter()

    def _auth(authorization: Optional[str]):
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing bearer")
        token = authorization[7:]
        if not secrets.compare_digest(token, webhook_secret or ""):
            raise HTTPException(status_code=401, detail="Bad token")

    @router.post("/cron/reminders")
    async def cron_reminders(background: BackgroundTasks, authorization: Optional[str] = Header(default=None)):
        _auth(authorization)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        due = await db.reminders.find(
            {"status": "pending", "due_date": {"$lte": today}}, {"_id": 0}
        ).to_list(500)
        for r in due:
            background.add_task(send_reminder_task, r["id"])
        return {"queued": len(due)}

    @router.post("/cron/backup")
    async def cron_backup(background: BackgroundTasks, authorization: Optional[str] = Header(default=None)):
        """Nightly cloud backup — ack immediately, do the work in the background."""
        _auth(authorization)
        from backup import run_daily_cloud_backup

        async def _run():
            try:
                result = await run_daily_cloud_backup(db)
                logger.info(f"Nightly backup ok: {result}")
            except Exception as e:
                logger.exception(f"Nightly backup failed: {e}")

        background.add_task(_run)
        return {"queued": True}

    return router
