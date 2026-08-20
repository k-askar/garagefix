"""Backend tests for the backup & restore feature (iteration 9).

Covers: /api/backup/export, /api/backup/import, /api/backup/cloud/{push,list,download,restore,<id>},
owner-only guards for all 7 endpoints, and /api/cron/backup token auth.
"""
import gzip
import io
import json
import os

import pytest
import requests
from dotenv import dotenv_values

from conftest import BASE_URL

CRON_SECRET = dotenv_values("/app/backend/.env").get("WEBHOOK_CRON_SECRET", "").strip('"')

MANAGED = [
    "users", "settings", "suppliers", "customers", "vehicles", "inventory",
    "transactions", "purchase_orders", "repairs", "invoices",
    "appointments", "reminders", "payment_methods", "payment_entries",
]


# --- module-scope safety net: keep a pristine snapshot and restore it at the end ---
@pytest.fixture(scope="module")
def pristine(owner_client):
    r = owner_client.get(f"{BASE_URL}/api/backup/export", timeout=180)
    assert r.status_code == 200, r.text[:300]
    blob = r.content
    yield blob
    files = {"file": ("restore.json.gz", io.BytesIO(blob), "application/gzip")}
    rr = owner_client.post(f"{BASE_URL}/api/backup/import", files=files, timeout=300)
    assert rr.status_code == 200, f"final restore failed: {rr.text[:300]}"


# --- Export ---
class TestExport:
    def test_export_headers_and_payload(self, owner_client, pristine):
        r = owner_client.get(f"{BASE_URL}/api/backup/export", timeout=180)
        assert r.status_code == 200
        assert r.headers.get("content-type") == "application/gzip"
        assert "attachment" in r.headers.get("content-disposition", "")
        assert ".json.gz" in r.headers.get("content-disposition", "")
        payload = json.loads(gzip.decompress(r.content).decode("utf-8"))
        assert payload["version"] == 1
        assert payload["app"] == "pitstock"
        assert "created_at" in payload
        cols = payload["collections"]
        assert sorted(cols.keys()) == sorted(MANAGED), f"collections mismatch: {sorted(cols.keys())}"
        assert len(cols["users"]) >= 1
        assert all("_id" not in d for d in cols["users"])

    def test_export_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/api/backup/export", timeout=60)
        assert r.status_code == 401


# --- Import / restore ---
class TestImport:
    def test_import_roundtrip(self, owner_client, pristine):
        files = {"file": ("b.json.gz", io.BytesIO(pristine), "application/gzip")}
        r = owner_client.post(f"{BASE_URL}/api/backup/import", files=files, timeout=300)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["status"] == "restored"
        assert d["total_docs"] > 0
        assert sorted(d["counts"].keys()) == sorted(MANAGED)
        # verify data still reachable after restore
        inv = owner_client.get(f"{BASE_URL}/api/inventory", timeout=60)
        assert inv.status_code == 200
        assert len(inv.json()) == d["counts"]["inventory"]

    def test_import_non_gzip(self, owner_client):
        files = {"file": ("bad.json.gz", io.BytesIO(b"this is not gzip at all"), "application/gzip")}
        r = owner_client.post(f"{BASE_URL}/api/backup/import", files=files, timeout=120)
        assert r.status_code == 400, r.text[:300]
        assert "gz" in r.json()["detail"].lower()

    def test_import_wrong_app(self, owner_client):
        blob = gzip.compress(json.dumps({"app": "somethingelse", "collections": {}}).encode())
        files = {"file": ("wrong.json.gz", io.BytesIO(blob), "application/gzip")}
        r = owner_client.post(f"{BASE_URL}/api/backup/import", files=files, timeout=120)
        assert r.status_code == 400
        assert "PitStock" in r.json()["detail"]

    def test_import_corrupt_json_inside_gzip(self, owner_client):
        blob = gzip.compress(b"{not json,,,")
        files = {"file": ("corrupt.json.gz", io.BytesIO(blob), "application/gzip")}
        r = owner_client.post(f"{BASE_URL}/api/backup/import", files=files, timeout=120)
        assert r.status_code == 400
        assert "Corrupt JSON" in r.json()["detail"]

    def test_import_bad_collections_section(self, owner_client):
        blob = gzip.compress(json.dumps({"app": "pitstock", "collections": ["nope"]}).encode())
        files = {"file": ("bad2.json.gz", io.BytesIO(blob), "application/gzip")}
        r = owner_client.post(f"{BASE_URL}/api/backup/import", files=files, timeout=120)
        assert r.status_code == 400
        assert "collections" in r.json()["detail"]


# --- Cloud lifecycle ---
class TestCloud:
    def test_cloud_lifecycle(self, owner_client, pristine):
        # push
        r = owner_client.post(f"{BASE_URL}/api/backup/cloud/push", timeout=240)
        assert r.status_code == 200, r.text[:400]
        rec = r.json()
        assert rec["status"] == "uploaded"
        assert rec["trigger"] == "manual"
        assert rec["size"] > 0
        assert rec["filename"].endswith(".json.gz")
        assert "_id" not in rec
        bid = rec["id"]

        # list contains it
        lr = owner_client.get(f"{BASE_URL}/api/backup/cloud/list", timeout=60)
        assert lr.status_code == 200
        rows = lr.json()
        assert any(x["id"] == bid for x in rows)
        assert all("_id" not in x for x in rows)

        # download returns gzip with matching pitstock payload
        dr = owner_client.get(f"{BASE_URL}/api/backup/cloud/download/{bid}", timeout=240)
        assert dr.status_code == 200, dr.text[:300]
        assert dr.headers.get("content-type") == "application/gzip"
        payload = json.loads(gzip.decompress(dr.content).decode("utf-8"))
        assert payload["app"] == "pitstock"
        assert len(dr.content) == rec["size"]

        # restore from cloud
        rr = owner_client.post(f"{BASE_URL}/api/backup/cloud/restore/{bid}", timeout=300)
        assert rr.status_code == 200, rr.text[:300]
        rd = rr.json()
        assert rd["status"] == "restored"
        assert rd["total_docs"] > 0
        assert rd["source"] == rec["filename"]

        # delete (soft)
        delr = owner_client.delete(f"{BASE_URL}/api/backup/cloud/{bid}", timeout=60)
        assert delr.status_code == 200
        assert delr.json()["status"] == "deleted"

        # gone from list and 404 on download/restore/delete
        rows2 = owner_client.get(f"{BASE_URL}/api/backup/cloud/list", timeout=60).json()
        assert not any(x["id"] == bid for x in rows2)
        assert owner_client.get(f"{BASE_URL}/api/backup/cloud/download/{bid}", timeout=60).status_code == 404
        assert owner_client.post(f"{BASE_URL}/api/backup/cloud/restore/{bid}", timeout=60).status_code == 404
        assert owner_client.delete(f"{BASE_URL}/api/backup/cloud/{bid}", timeout=60).status_code == 404

    def test_unknown_id_404(self, owner_client):
        fake = "00000000-0000-0000-0000-000000000000"
        assert owner_client.get(f"{BASE_URL}/api/backup/cloud/download/{fake}", timeout=60).status_code == 404
        assert owner_client.post(f"{BASE_URL}/api/backup/cloud/restore/{fake}", timeout=60).status_code == 404
        assert owner_client.delete(f"{BASE_URL}/api/backup/cloud/{fake}", timeout=60).status_code == 404


# --- Owner-only guards (all 7 endpoints) ---
class TestOwnerGuard:
    def test_staff_forbidden_everywhere(self, staff_client):
        fake = "11111111-1111-1111-1111-111111111111"
        calls = [
            ("get", f"{BASE_URL}/api/backup/export", {}),
            ("post", f"{BASE_URL}/api/backup/import",
             {"files": {"file": ("x.json.gz", io.BytesIO(gzip.compress(b'{}')), "application/gzip")}}),
            ("post", f"{BASE_URL}/api/backup/cloud/push", {}),
            ("get", f"{BASE_URL}/api/backup/cloud/list", {}),
            ("get", f"{BASE_URL}/api/backup/cloud/download/{fake}", {}),
            ("post", f"{BASE_URL}/api/backup/cloud/restore/{fake}", {}),
            ("delete", f"{BASE_URL}/api/backup/cloud/{fake}", {}),
        ]
        failures = []
        for method, url, kw in calls:
            r = getattr(staff_client, method)(url, timeout=120, **kw)
            if r.status_code != 403:
                failures.append(f"{method.upper()} {url} -> {r.status_code}")
        assert not failures, f"staff not blocked: {failures}"


# --- Cron endpoint ---
class TestCron:
    def test_cron_no_token(self):
        r = requests.post(f"{BASE_URL}/api/cron/backup", timeout=60)
        assert r.status_code == 401

    def test_cron_wrong_token(self):
        r = requests.post(f"{BASE_URL}/api/cron/backup",
                          headers={"Authorization": "Bearer wrong-token"}, timeout=60)
        assert r.status_code == 401

    def test_cron_valid_token_creates_row(self, owner_client, pristine):
        assert CRON_SECRET, "WEBHOOK_CRON_SECRET missing from /app/backend/.env"
        before = {x["id"] for x in owner_client.get(f"{BASE_URL}/api/backup/cloud/list", timeout=60).json()}
        r = requests.post(f"{BASE_URL}/api/cron/backup",
                          headers={"Authorization": f"Bearer {CRON_SECRET}"}, timeout=120)
        assert r.status_code == 200, r.text[:300]
        # background task — poll for the new row
        new_row = None
        for _ in range(20):
            import time
            time.sleep(3)
            rows = owner_client.get(f"{BASE_URL}/api/backup/cloud/list", timeout=60).json()
            fresh = [x for x in rows if x["id"] not in before]
            if fresh:
                new_row = fresh[0]
                break
        assert new_row is not None, "cron backup row never appeared in cloud list"
        assert new_row["trigger"] == "cron"
        assert new_row["size"] > 0
        # cleanup the cron row
        owner_client.delete(f"{BASE_URL}/api/backup/cloud/{new_row['id']}", timeout=60)
