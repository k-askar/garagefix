"""
Database backup & restore — local download/upload + Emergent Object Storage.

Public surface (mounted from server.py):
    router                         APIRouter with /backup/* endpoints
    run_daily_cloud_backup(db)     Cron entry point (returns dict summary)
"""
from __future__ import annotations

import os
import gzip
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

import requests
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Header
from fastapi.responses import Response

logger = logging.getLogger(__name__)

# Collections that make up an app-level snapshot. Order matters for restore only
# in that we blow the collection away before inserting; there are no FK deps
# because the app uses UUID string ids.
MANAGED_COLLECTIONS = [
    "users", "settings",
    "suppliers", "customers", "vehicles",
    "inventory",
    "transactions", "purchase_orders",
    "repairs", "invoices",
    "appointments", "reminders",
    "payment_methods", "payment_entries",
]

APP_PREFIX = "pitstock/backups"
BACKUP_VERSION = 1

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")

_storage_key: Optional[str] = None


def init_storage(force: bool = False) -> str:
    """Mint (once) and return the session-scoped storage_key.  force=True re-mints."""
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    if not EMERGENT_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY is not configured")
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=180,
    )
    if resp.status_code == 404:
        # dead key, re-mint once
        key = init_storage(force=True)
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=180,
        )
    resp.raise_for_status()
    return resp.json()


def _get_object(path: str) -> bytes:
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=120)
    resp.raise_for_status()
    return resp.content


# ---------- Snapshot building / restoring ----------

def _default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    if isinstance(o, (bytes, bytearray)):
        return o.decode("utf-8", errors="replace")
    return str(o)


async def build_snapshot(db) -> bytes:
    """Dump managed collections into a gzipped JSON blob."""
    payload: dict = {
        "version": BACKUP_VERSION,
        "app": "pitstock",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "collections": {},
    }
    for name in MANAGED_COLLECTIONS:
        docs = await db[name].find({}, {"_id": 0}).to_list(length=None)
        payload["collections"][name] = docs
    raw = json.dumps(payload, default=_default, ensure_ascii=False).encode("utf-8")
    return gzip.compress(raw, compresslevel=6)


async def restore_snapshot(db, blob: bytes) -> dict:
    """Decompress + validate + wipe + insert. Returns per-collection counts."""
    try:
        raw = gzip.decompress(blob)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Not a valid .gz archive: {e}")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=400, detail=f"Corrupt JSON inside archive: {e}")
    if not isinstance(payload, dict) or payload.get("app") != "pitstock":
        raise HTTPException(status_code=400, detail="Archive is not a PitStock backup")
    cols = payload.get("collections") or {}
    if not isinstance(cols, dict):
        raise HTTPException(status_code=400, detail="Malformed 'collections' section")

    counts: dict = {}
    for name in MANAGED_COLLECTIONS:
        docs = cols.get(name) or []
        await db[name].delete_many({})
        if docs:
            # strip any accidental _id leftovers
            for d in docs:
                d.pop("_id", None)
            await db[name].insert_many(docs)
        counts[name] = len(docs)
    return {
        "restored_from": payload.get("created_at"),
        "counts": counts,
        "total_docs": sum(counts.values()),
    }


# ---------- Router ----------

router = APIRouter(prefix="/backup", tags=["backup"])


def _require_owner_factory(require_owner):
    """Bind the outer server.py `require_owner` dep to this router."""
    global _require_owner
    _require_owner = require_owner


_require_owner = None  # patched from server.py


def _now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _make_filename() -> str:
    return f"pitstock-backup-{_now_stamp()}-{uuid.uuid4().hex[:6]}.json.gz"


def register_routes(db, require_owner_dep):
    """Attach all backup routes.  Called from server.py after db + deps exist."""

    @router.get("/export")
    async def export_backup(user: dict = Depends(require_owner_dep)):
        """Stream the current DB as a downloadable .json.gz archive."""
        blob = await build_snapshot(db)
        filename = _make_filename()
        return Response(
            content=blob,
            media_type="application/gzip",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Backup-Size": str(len(blob)),
            },
        )

    @router.post("/import")
    async def import_backup(file: UploadFile = File(...), user: dict = Depends(require_owner_dep)):
        """Restore from an uploaded .json.gz archive.  DESTRUCTIVE."""
        blob = await file.read()
        if len(blob) > 200 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Backup file too large (max 200 MB)")
        summary = await restore_snapshot(db, blob)
        return {"status": "restored", **summary}

    @router.post("/cloud/push")
    async def push_to_cloud(user: dict = Depends(require_owner_dep)):
        """Build a snapshot and upload it to Emergent Object Storage."""
        try:
            blob = await build_snapshot(db)
            filename = _make_filename()
            path = f"{APP_PREFIX}/{filename}"
            put_result = _put_object(path, blob, "application/gzip")
            record = {
                "id": str(uuid.uuid4()),
                "storage_path": put_result["path"],
                "filename": filename,
                "size": len(blob),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "trigger": "manual",
                "is_deleted": False,
            }
            await db.backups.insert_one(record)
            record.pop("_id", None)
            return {"status": "uploaded", **record}
        except requests.HTTPError as e:
            logger.exception("Cloud push failed")
            raise HTTPException(status_code=502, detail=f"Cloud storage error: {e.response.text[:200]}")

    @router.get("/cloud/list")
    async def list_cloud_backups(user: dict = Depends(require_owner_dep)):
        rows = await db.backups.find({"is_deleted": False}, {"_id": 0}).sort("created_at", -1).to_list(500)
        return rows

    @router.get("/cloud/download/{backup_id}")
    async def download_cloud_backup(backup_id: str, user: dict = Depends(require_owner_dep)):
        rec = await db.backups.find_one({"id": backup_id, "is_deleted": False})
        if not rec:
            raise HTTPException(status_code=404, detail="Backup not found")
        try:
            data = _get_object(rec["storage_path"])
        except requests.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Cloud storage error: {e.response.text[:200]}")
        return Response(
            content=data,
            media_type="application/gzip",
            headers={"Content-Disposition": f'attachment; filename="{rec["filename"]}"'},
        )

    @router.post("/cloud/restore/{backup_id}")
    async def restore_cloud_backup(backup_id: str, user: dict = Depends(require_owner_dep)):
        rec = await db.backups.find_one({"id": backup_id, "is_deleted": False})
        if not rec:
            raise HTTPException(status_code=404, detail="Backup not found")
        try:
            data = _get_object(rec["storage_path"])
        except requests.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Cloud storage error: {e.response.text[:200]}")
        summary = await restore_snapshot(db, data)
        return {"status": "restored", "source": rec["filename"], **summary}

    @router.delete("/cloud/{backup_id}")
    async def delete_cloud_backup(backup_id: str, user: dict = Depends(require_owner_dep)):
        rec = await db.backups.find_one({"id": backup_id, "is_deleted": False})
        if not rec:
            raise HTTPException(status_code=404, detail="Backup not found")
        # Object Storage has no delete API → soft-delete in DB only
        await db.backups.update_one({"id": backup_id}, {"$set": {"is_deleted": True, "deleted_at": datetime.now(timezone.utc).isoformat()}})
        return {"status": "deleted"}

    return router


async def run_daily_cloud_backup(db) -> dict:
    """Cron entry point.  Uploads a nightly snapshot and prunes old ones (keep last 30)."""
    blob = await build_snapshot(db)
    filename = f"pitstock-backup-{_now_stamp()}-cron.json.gz"
    path = f"{APP_PREFIX}/{filename}"
    put_result = _put_object(path, blob, "application/gzip")
    await db.backups.insert_one({
        "id": str(uuid.uuid4()),
        "storage_path": put_result["path"],
        "filename": filename,
        "size": len(blob),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "trigger": "cron",
        "is_deleted": False,
    })
    # keep last 30, soft-delete the rest
    keep_ids = [r["id"] async for r in db.backups.find({"is_deleted": False}, {"id": 1, "_id": 0}).sort("created_at", -1).limit(30)]
    if keep_ids:
        await db.backups.update_many(
            {"is_deleted": False, "id": {"$nin": keep_ids}},
            {"$set": {"is_deleted": True, "deleted_at": datetime.now(timezone.utc).isoformat()}},
        )
    return {"uploaded": filename, "size": len(blob), "kept": len(keep_ids)}
