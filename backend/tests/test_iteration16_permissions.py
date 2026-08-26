"""Iteration 16 — permission enforcement matrix (backend)."""
import os
import uuid
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE}/api"

OWNER = ("admin@garage.com", "admin123")
SUPER = ("platform@pitstock.app", "platform123")
WAREHOUSE = ("warehouse@test.com", "warehouse123")


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:300]}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"no token in login response: {list(data.keys())}"
    return tok


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_tok():
    return login(*OWNER)


@pytest.fixture(scope="module")
def wh_tok():
    return login(*WAREHOUSE)


@pytest.fixture(scope="module")
def super_tok():
    return login(*SUPER)


@pytest.fixture(scope="module")
def created_users():
    ids = []
    yield ids
    tok = login(*OWNER)
    for uid in ids:
        requests.delete(f"{API}/users/{uid}", headers=hdr(tok), timeout=30)


def make_staff(owner_tok, created_users, perms, label):
    email = f"TEST_{label}_{uuid.uuid4().hex[:6]}@test.com"
    pwd = "test1234"
    r = requests.post(f"{API}/users", headers=hdr(owner_tok), json={
        "email": email, "name": f"TEST {label}", "password": pwd,
        "role": "staff", "permissions": perms,
    }, timeout=30)
    assert r.status_code in (200, 201), f"create staff failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    uid = body.get("id") or body.get("user", {}).get("id")
    assert uid, f"no id in create user response: {body}"
    created_users.append(uid)
    assert set(perms).issubset(set((body.get("permissions") or body.get("user", {}).get("permissions") or [])))
    return login(email, pwd), uid


# ── Warehouse-only staff: GET matrix ──────────────────────────────────────
FORBIDDEN_GETS = [
    "/repairs", "/customers", "/invoices", "/dashboard/summary", "/suppliers",
    "/appointments", "/ledger", "/reports/profit", "/reports/movement",
    "/parts-catalog", "/payment-methods", "/payment-entries", "/bay-board",
]


class TestWarehouseOnlyStaff:
    def test_inventory_view_allowed(self, wh_tok):
        r = requests.get(f"{API}/inventory", headers=hdr(wh_tok), timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), list)

    @pytest.mark.parametrize("path", FORBIDDEN_GETS)
    def test_forbidden_gets(self, wh_tok, path):
        r = requests.get(f"{API}{path}", headers=hdr(wh_tok), timeout=30)
        assert r.status_code == 403, f"LEAK {path} -> {r.status_code} {r.text[:200]}"
        assert "Missing permission" in r.text

    def test_forbidden_writes(self, wh_tok):
        r = requests.post(f"{API}/inventory", headers=hdr(wh_tok), json={
            "sku": "TEST_X", "name": "TEST x", "quantity": 1, "cost_price": 1, "selling_price": 2}, timeout=30)
        assert r.status_code == 403, f"POST /inventory leaked: {r.status_code}"
        r = requests.delete(f"{API}/inventory/{uuid.uuid4()}", headers=hdr(wh_tok), timeout=30)
        assert r.status_code == 403, f"DELETE /inventory leaked: {r.status_code}"
        r = requests.post(f"{API}/transactions", headers=hdr(wh_tok), json={
            "type": "OUT", "item_id": str(uuid.uuid4()), "quantity": 1, "unit_price": 1.0}, timeout=30)
        assert r.status_code == 403, f"POST /transactions leaked: {r.status_code}"


# ── Owner bypass ──────────────────────────────────────────────────────────
class TestOwnerBypass:
    @pytest.mark.parametrize("path", ["/inventory"] + FORBIDDEN_GETS)
    def test_owner_gets(self, owner_tok, path):
        r = requests.get(f"{API}{path}", headers=hdr(owner_tok), timeout=60)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"


class TestSuperAdmin:
    def test_tenants(self, super_tok):
        r = requests.get(f"{API}/tenants", headers=hdr(super_tok), timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json(), list)

    def test_super_admin_impersonation_data_access(self, super_tok):
        """super_admin passes require_owner but has_permission() has no bypass."""
        tenants = requests.get(f"{API}/tenants", headers=hdr(super_tok), timeout=30).json()
        assert tenants
        tid = tenants[0]["id"]
        r = requests.post(f"{API}/tenants/{tid}/impersonate", headers=hdr(super_tok), timeout=30)
        if r.status_code == 404:
            pytest.skip("no impersonate endpoint")
        assert r.status_code == 200, r.text[:300]
        tok = r.json().get("access_token") or r.json().get("token")
        assert tok
        g = requests.get(f"{API}/inventory", headers=hdr(tok), timeout=30)
        assert g.status_code == 200, f"impersonating super_admin got {g.status_code} on /inventory: {g.text[:200]}"


# ── Granular staff scopes ─────────────────────────────────────────────────
class TestGranularInventoryStaff:
    def test_view_edit_no_delete(self, owner_tok, created_users):
        tok, _ = make_staff(owner_tok, created_users, ["inventory.view", "inventory.edit"], "inv")
        code = f"TEST_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/inventory", headers=hdr(tok), json={
            "sku": code, "name": "TEST part", "quantity": 5,
            "cost_price": 10, "selling_price": 20}, timeout=30)
        assert r.status_code in (200, 201), f"POST /inventory blocked: {r.status_code} {r.text[:300]}"
        item_id = r.json()["id"]
        d = requests.delete(f"{API}/inventory/{item_id}", headers=hdr(tok), timeout=30)
        assert d.status_code == 403, f"DELETE leaked to inventory.edit staff: {d.status_code}"
        # cleanup as owner
        requests.delete(f"{API}/inventory/{item_id}", headers=hdr(owner_tok), timeout=30)


class TestGranularCustomerStaff:
    def test_view_edit_no_delete(self, owner_tok, created_users):
        tok, _ = make_staff(owner_tok, created_users, ["customers.view", "customers.edit"], "cust")
        assert requests.get(f"{API}/customers", headers=hdr(tok), timeout=30).status_code == 200
        r = requests.post(f"{API}/customers", headers=hdr(tok), json={
            "name": "TEST Cust Perm", "phone": "0600000001"}, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        cid = r.json()["id"]
        u = requests.put(f"{API}/customers/{cid}", headers=hdr(tok), json={"name": "TEST Cust Perm 2"}, timeout=30)
        assert u.status_code == 200, u.text[:300]
        d = requests.delete(f"{API}/customers/{cid}", headers=hdr(tok), timeout=30)
        assert d.status_code == 403, f"DELETE customer leaked: {d.status_code}"
        requests.delete(f"{API}/customers/{cid}", headers=hdr(owner_tok), timeout=30)


class TestGranularRepairStaff:
    def test_repairs_scopes(self, owner_tok, created_users):
        tok, _ = make_staff(owner_tok, created_users,
                            ["repairs.view", "repairs.create", "repairs.edit"], "rep")
        # owner sets up customer + vehicle
        c = requests.post(f"{API}/customers", headers=hdr(owner_tok), json={
            "name": "TEST Repair Perm", "phone": "0600000002"}, timeout=30)
        assert c.status_code in (200, 201), c.text[:300]
        cid = c.json()["id"]
        v = requests.post(f"{API}/customers/{cid}/vehicles", headers=hdr(owner_tok), json={
            "plate": f"TP{uuid.uuid4().hex[:4].upper()}", "make": "VW", "model": "Golf"}, timeout=30)
        assert v.status_code in (200, 201), v.text[:300]
        vid = v.json()["id"]

        assert requests.get(f"{API}/repairs", headers=hdr(tok), timeout=30).status_code == 200
        r = requests.post(f"{API}/repairs", headers=hdr(tok), json={
            "customer_id": cid, "vehicle_id": vid, "complaint": "TEST perm check"}, timeout=30)
        assert r.status_code in (200, 201), f"POST /repairs blocked: {r.status_code} {r.text[:300]}"
        rid = r.json()["id"]

        assert requests.put(f"{API}/repairs/{rid}", headers=hdr(tok),
                            json={"complaint": "TEST perm check 2"}, timeout=30).status_code == 200
        ci = requests.post(f"{API}/repairs/{rid}/clock-in", headers=hdr(tok), json={"note": "TEST"}, timeout=30)
        assert ci.status_code in (200, 201), f"clock-in: {ci.status_code} {ci.text[:200]}"
        tl = requests.post(f"{API}/repairs/{rid}/time-logs", headers=hdr(tok), json={
            "started_at": "2026-07-01T09:00:00", "stopped_at": "2026-07-01T09:30:00", "note": "TEST"}, timeout=30)
        assert tl.status_code in (200, 201), f"time-logs: {tl.status_code} {tl.text[:200]}"

        inv = requests.post(f"{API}/repairs/{rid}/invoice", headers=hdr(tok), timeout=30)
        assert inv.status_code == 403, f"repairs invoice leaked (needs repairs.complete): {inv.status_code}"
        d = requests.delete(f"{API}/repairs/{rid}", headers=hdr(tok), timeout=30)
        assert d.status_code == 403, f"DELETE repair leaked: {d.status_code}"

        requests.delete(f"{API}/repairs/{rid}", headers=hdr(owner_tok), timeout=30)
        requests.delete(f"{API}/vehicles/{vid}", headers=hdr(owner_tok), timeout=30)
        requests.delete(f"{API}/customers/{cid}", headers=hdr(owner_tok), timeout=30)


# ── Owner regression flow ─────────────────────────────────────────────────
class TestOwnerRegressionFlow:
    def test_full_flow(self, owner_tok):
        h = hdr(owner_tok)
        c = requests.post(f"{API}/customers", headers=h, json={
            "name": "TEST Regression Owner", "phone": "0600000003"}, timeout=30)
        assert c.status_code in (200, 201), c.text[:300]
        cid = c.json()["id"]
        v = requests.post(f"{API}/customers/{cid}/vehicles", headers=h, json={
            "plate": f"TR{uuid.uuid4().hex[:4].upper()}", "make": "Audi", "model": "A3"}, timeout=30)
        vid = v.json()["id"]
        r = requests.post(f"{API}/repairs", headers=h, json={
            "customer_id": cid, "vehicle_id": vid, "complaint": "TEST regression"}, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        rid = r.json()["id"]
        code = f"TEST_{uuid.uuid4().hex[:6]}"
        it = requests.post(f"{API}/inventory", headers=h, json={
            "sku": code, "name": "TEST reg part", "quantity": 10,
            "cost_price": 5, "selling_price": 15}, timeout=30)
        assert it.status_code in (200, 201), it.text[:300]
        iid = it.json()["id"]
        ap = requests.post(f"{API}/repairs/{rid}/parts", headers=h, json={
            "item_id": iid, "quantity": 2}, timeout=30)
        assert ap.status_code in (200, 201), f"add part: {ap.status_code} {ap.text[:200]}"
        inv = requests.post(f"{API}/repairs/{rid}/invoice", headers=h, timeout=30)
        assert inv.status_code in (200, 201), f"invoice: {inv.status_code} {inv.text[:300]}"
        inv_id = inv.json().get("id") or inv.json().get("invoice", {}).get("id")
        assert inv_id
        mp = requests.post(f"{API}/invoices/{inv_id}/mark-paid", headers=h, json={}, timeout=30)
        assert mp.status_code == 200, f"mark-paid: {mp.status_code} {mp.text[:300]}"
        got = requests.get(f"{API}/invoices", headers=h, timeout=30).json()
        found = [i for i in got if i["id"] == inv_id]
        assert found and found[0]["status"] in ("paid", "PAID"), found[:1]
        # cleanup
        requests.delete(f"{API}/invoices/{inv_id}", headers=h, timeout=30)
        requests.delete(f"{API}/repairs/{rid}", headers=h, timeout=30)
        requests.delete(f"{API}/inventory/{iid}", headers=h, timeout=30)
        requests.delete(f"{API}/vehicles/{vid}", headers=h, timeout=30)
        requests.delete(f"{API}/customers/{cid}", headers=h, timeout=30)


# ── Endpoints still on get_current_user (potential leaks) ─────────────────
class TestPotentialLeaks:
    def test_settings_accessible_to_any_user(self, wh_tok):
        r = requests.get(f"{API}/settings", headers=hdr(wh_tok), timeout=30)
        assert r.status_code in (200, 403), r.status_code

    def test_vehicle_passport_token_not_gated(self, wh_tok, owner_tok):
        vs = requests.get(f"{API}/customers", headers=hdr(owner_tok), timeout=30).json()
        vid = None
        for c in vs:
            vehs = requests.get(f"{API}/customers/{c['id']}/vehicles", headers=hdr(owner_tok), timeout=30).json()
            if vehs:
                vid = vehs[0]["id"]
                break
        if not vid:
            pytest.skip("no vehicles in tenant")
        r = requests.get(f"{API}/vehicles/{vid}/passport/token", headers=hdr(wh_tok), timeout=30)
        print(f"passport-token as warehouse staff -> {r.status_code}")
        assert r.status_code == 403, f"LEAK: passport-token readable by inventory-only staff ({r.status_code})"
