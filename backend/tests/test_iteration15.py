"""Iteration 15 — super_admin purge-lockout bug fix.

Layers verified:
  (a) startup self-heal clears tenant_id on super_admin users
  (b) delete_tenant(purge=true) never deletes role=super_admin
"""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env["REACT_APP_BACKEND_URL"]).rstrip("/")

backend_env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")

SUPER = {"email": "platform@pitstock.app", "password": "platform123"}


def login(email, password):
    return requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def super_token():
    r = login(**SUPER)
    if r.status_code != 200:
        pytest.fail(f"super_admin login failed {r.status_code}: {r.text[:300]}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def super_client(super_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {super_token}"})
    return s


# ---------------- BUG FIX #1 : super admin login ----------------
class TestSuperAdminLogin:
    def test_login_returns_token_and_clean_tenant(self):
        r = login(**SUPER)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert isinstance(data.get("token"), str) and len(data["token"]) > 20
        u = data["user"]
        assert u["role"] == "super_admin"
        assert u.get("tenant_id") in (None, "")
        assert "_id" not in u

    def test_wrong_password_rejected(self):
        r = login(SUPER["email"], "wrongpass")
        assert r.status_code in (400, 401, 429), r.status_code


# ---------------- BUG FIX #2 : tenants list accessible ----------------
class TestTenantsAccess:
    def test_list_tenants(self, super_client):
        r = super_client.get(f"{BASE_URL}/api/tenants", timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), list)

    def test_db_super_admins_have_null_tenant(self, mongo):
        bad = list(mongo.users.find({"role": "super_admin", "tenant_id": {"$ne": None}}, {"_id": 0, "email": 1}))
        assert bad == [], f"contaminated super_admins in DB: {bad}"


# ---------------- BUG FIX #3 + REGRESSION : purge ----------------
class TestPurgeSafety:
    def test_create_contaminate_purge_super_admin_survives(self, super_client, mongo):
        suffix = uuid.uuid4().hex[:6]
        owner_email = f"purge_bug_test_{suffix}@garage.local"
        payload = {
            "name": f"TEST_PurgeBug_{suffix}",
            "country": "NL",
            "plan": "trial",
            "owner_email": owner_email,
            "owner_name": "TEST Purge Owner",
        }
        cr = super_client.post(f"{BASE_URL}/api/tenants", json=payload, timeout=60)
        assert cr.status_code in (200, 201), cr.text[:400]
        tenant = cr.json()
        tid = tenant.get("id") or tenant.get("tenant", {}).get("id")
        assert tid, tenant

        # tenant visible in list
        lst = super_client.get(f"{BASE_URL}/api/tenants", timeout=30).json()
        assert any(t["id"] == tid for t in lst), "new tenant missing from list"

        # owner user provisioned
        owner_doc = mongo.users.find_one({"email": owner_email})
        assert owner_doc is not None, "owner user was not provisioned"
        assert owner_doc.get("tenant_id") == tid

        # --- simulate contamination: give super_admin this tenant_id ---
        heal = mongo.users.update_many({"role": "super_admin"}, {"$set": {"tenant_id": tid}})
        assert heal.modified_count >= 1
        sa_before = mongo.users.count_documents({"role": "super_admin"})

        try:
            dr = super_client.delete(f"{BASE_URL}/api/tenants/{tid}?purge=true", timeout=60)
            assert dr.status_code == 200, dr.text[:400]
            body = dr.json()
            assert body.get("ok") is True and body.get("purged") is True, body
            assert isinstance(body.get("deleted"), dict), body
            assert body["deleted"].get("tenants") == 1

            # super_admin(s) survived
            sa_after = mongo.users.count_documents({"role": "super_admin"})
            assert sa_after == sa_before, f"super_admin deleted by purge ({sa_before} -> {sa_after})"

            # owner of purged tenant IS gone
            assert mongo.users.find_one({"email": owner_email}) is None, "purged tenant owner still exists"

            # tenant gone from list
            lst2 = super_client.get(f"{BASE_URL}/api/tenants", timeout=30)
            assert lst2.status_code == 200
            assert not any(t["id"] == tid for t in lst2.json()), "purged tenant still listed"
        finally:
            # restore clean state regardless (mirrors startup self-heal)
            mongo.users.update_many({"role": "super_admin"}, {"$set": {"tenant_id": None}})

        # login still works after purge
        r = login(**SUPER)
        assert r.status_code == 200, f"super_admin login broken after purge: {r.text[:300]}"

    def test_tenants_access_after_purge(self, super_client):
        r = super_client.get(f"{BASE_URL}/api/tenants", timeout=30)
        assert r.status_code == 200, r.text[:300]

    def test_soft_delete_still_suspends(self, super_client):
        suffix = uuid.uuid4().hex[:6]
        cr = super_client.post(
            f"{BASE_URL}/api/tenants",
            json={"name": f"TEST_SoftDel_{suffix}", "country": "NL", "plan": "trial",
                  "owner_email": f"soft_del_{suffix}@garage.local", "owner_name": "TEST Soft"},
            timeout=60,
        )
        assert cr.status_code in (200, 201), cr.text[:300]
        tid = cr.json()["id"]
        dr = super_client.delete(f"{BASE_URL}/api/tenants/{tid}", timeout=30)
        assert dr.status_code == 200, dr.text[:300]
        assert dr.json() == {"ok": True, "purged": False}
        # cleanup hard
        super_client.delete(f"{BASE_URL}/api/tenants/{tid}?purge=true", timeout=60)

    def test_purge_unknown_tenant_404(self, super_client):
        r = super_client.delete(f"{BASE_URL}/api/tenants/{uuid.uuid4()}?purge=true", timeout=30)
        assert r.status_code == 404, r.status_code

    def test_purge_requires_super_admin(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@garage.com", "password": "admin123"}, timeout=30)
        assert r.status_code == 200, r.text[:200]
        tok = r.json()["token"]
        rr = requests.delete(f"{BASE_URL}/api/tenants/{uuid.uuid4()}?purge=true",
                             headers={"Authorization": f"Bearer {tok}"}, timeout=30)
        assert rr.status_code == 403, rr.status_code

    def test_owner_login_regression(self):
        r = login("admin@garage.com", "admin123")
        assert r.status_code == 200, r.text[:300]
        assert r.json()["user"]["role"] == "owner"
