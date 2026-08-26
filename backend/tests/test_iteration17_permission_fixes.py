"""Iteration 17 — verify the 4 permission fixes from iteration 16.

FIX 1: super_admin bypasses has_permission() (no impersonation needed)
FIX 2: reminders endpoints gated by reminders.view / reminders.send
FIX 3: email-logs endpoints owner-only
FIX 4: passport token/rotate gated by customers.view / customers.edit
"""
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
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token: {list(r.json().keys())}"
    return tok


def hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_tok():
    return login(*OWNER)


@pytest.fixture(scope="module")
def super_tok():
    return login(*SUPER)


@pytest.fixture(scope="module")
def wh_tok():
    return login(*WAREHOUSE)


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
        "role": "staff", "permissions": perms}, timeout=30)
    assert r.status_code in (200, 201), f"create staff failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    uid = body.get("id") or body.get("user", {}).get("id")
    assert uid, body
    created_users.append(uid)
    return login(email, pwd), uid


@pytest.fixture(scope="module")
def some_vehicle_id(owner_tok):
    cs = requests.get(f"{API}/customers", headers=hdr(owner_tok), timeout=30).json()
    for c in cs:
        vs = requests.get(f"{API}/customers/{c['id']}/vehicles", headers=hdr(owner_tok), timeout=30).json()
        if vs:
            return vs[0]["id"]
    # create one
    c = requests.post(f"{API}/customers", headers=hdr(owner_tok), json={
        "name": "TEST Passport Cust", "phone": "0600000099"}, timeout=30)
    cid = c.json()["id"]
    v = requests.post(f"{API}/customers/{cid}/vehicles", headers=hdr(owner_tok), json={
        "plate": f"TZ{uuid.uuid4().hex[:4].upper()}", "make": "VW", "model": "Up"}, timeout=30)
    return v.json()["id"]


# ── FIX 1: super_admin direct access to scope-guarded endpoints ────────────
SCOPED_GETS = ["/inventory", "/repairs", "/customers", "/invoices", "/reminders", "/email-logs"]


class TestSuperAdminBypass:
    @pytest.mark.parametrize("path", SCOPED_GETS)
    def test_super_admin_direct_get(self, super_tok, path):
        r = requests.get(f"{API}{path}", headers=hdr(super_tok), timeout=60)
        assert r.status_code == 200, f"super_admin got {r.status_code} on {path}: {r.text[:200]}"

    @pytest.mark.parametrize("path", SCOPED_GETS)
    def test_owner_direct_get(self, owner_tok, path):
        r = requests.get(f"{API}{path}", headers=hdr(owner_tok), timeout=60)
        assert r.status_code == 200, f"owner got {r.status_code} on {path}: {r.text[:200]}"


# ── FIX 2: reminders gated ────────────────────────────────────────────────
class TestRemindersGating:
    def test_warehouse_forbidden(self, wh_tok):
        h = hdr(wh_tok)
        rid = str(uuid.uuid4())
        checks = [
            ("GET", f"{API}/reminders", None),
            ("POST", f"{API}/reminders", {"invoice_id": rid, "channel": "email"}),
            ("POST", f"{API}/reminders/scan-vehicles", {}),
            ("POST", f"{API}/reminders/{rid}/send", {}),
            ("POST", f"{API}/reminders/{rid}/mark-sent", {}),
            ("POST", f"{API}/reminders/send-all-pending", {}),
            ("DELETE", f"{API}/reminders/{rid}", None),
        ]
        leaks = []
        for method, url, body in checks:
            r = requests.request(method, url, headers=h, json=body, timeout=30)
            if r.status_code != 403:
                leaks.append(f"{method} {url.replace(API,'')} -> {r.status_code} {r.text[:120]}")
        assert not leaks, "LEAKS: " + "; ".join(leaks)

    def test_reminders_view_only_staff(self, owner_tok, created_users):
        tok, _ = make_staff(owner_tok, created_users, ["reminders.view"], "remview")
        h = hdr(tok)
        g = requests.get(f"{API}/reminders", headers=h, timeout=30)
        assert g.status_code == 200, f"reminders.view staff got {g.status_code} on GET: {g.text[:200]}"
        rid = str(uuid.uuid4())
        write_checks = [
            ("POST", f"{API}/reminders/scan-vehicles", {}),
            ("POST", f"{API}/reminders/{rid}/send", {}),
            ("POST", f"{API}/reminders/{rid}/mark-sent", {}),
            ("POST", f"{API}/reminders/send-all-pending", {}),
            ("DELETE", f"{API}/reminders/{rid}", None),
        ]
        leaks = []
        for method, url, body in write_checks:
            r = requests.request(method, url, headers=h, json=body, timeout=30)
            if r.status_code != 403:
                leaks.append(f"{method} {url.replace(API,'')} -> {r.status_code} {r.text[:120]}")
        assert not leaks, "LEAKS (reminders.view should not write): " + "; ".join(leaks)

    def test_reminders_view_send_staff(self, owner_tok, created_users):
        tok, _ = make_staff(owner_tok, created_users, ["reminders.view", "reminders.send"], "remsend")
        h = hdr(tok)
        assert requests.get(f"{API}/reminders", headers=h, timeout=30).status_code == 200
        sc = requests.post(f"{API}/reminders/scan-vehicles", headers=h, json={}, timeout=60)
        assert sc.status_code in (200, 201), f"scan-vehicles: {sc.status_code} {sc.text[:200]}"
        sa = requests.post(f"{API}/reminders/send-all-pending", headers=h, json={}, timeout=90)
        assert sa.status_code in (200, 201), f"send-all-pending: {sa.status_code} {sa.text[:200]}"
        # unknown id must NOT be 403 (permission passed) -> 404/400
        d = requests.delete(f"{API}/reminders/{uuid.uuid4()}", headers=h, timeout=30)
        assert d.status_code != 403, "reminders.send staff blocked on DELETE"


# ── FIX 3: email-logs owner-only ─────────────────────────────────────────
class TestEmailLogsOwnerOnly:
    def test_warehouse_forbidden(self, wh_tok):
        h = hdr(wh_tok)
        g = requests.get(f"{API}/email-logs", headers=h, timeout=30)
        assert g.status_code == 403, f"email-logs leaked to warehouse staff: {g.status_code} {g.text[:200]}"
        p = requests.post(f"{API}/email-logs/{uuid.uuid4()}/resend", headers=h, json={}, timeout=30)
        assert p.status_code == 403, f"email-logs resend leaked: {p.status_code}"

    def test_inventory_staff_forbidden(self, owner_tok, created_users):
        tok, _ = make_staff(owner_tok, created_users, ["inventory.view", "inventory.edit"], "invstaff")
        h = hdr(tok)
        assert requests.get(f"{API}/email-logs", headers=h, timeout=30).status_code == 403
        assert requests.post(f"{API}/email-logs/{uuid.uuid4()}/resend", headers=h, json={}, timeout=30).status_code == 403

    def test_owner_allowed(self, owner_tok):
        r = requests.get(f"{API}/email-logs", headers=hdr(owner_tok), timeout=30)
        assert r.status_code == 200, r.text[:200]
        assert isinstance(r.json(), (list, dict))


# ── FIX 4: passport endpoints gated ──────────────────────────────────────
class TestPassportGating:
    def test_warehouse_forbidden(self, wh_tok, some_vehicle_id):
        h = hdr(wh_tok)
        g = requests.get(f"{API}/vehicles/{some_vehicle_id}/passport/token", headers=h, timeout=30)
        assert g.status_code == 403, f"passport token leaked: {g.status_code} {g.text[:200]}"
        p = requests.post(f"{API}/vehicles/{some_vehicle_id}/passport/rotate", headers=h, json={}, timeout=30)
        assert p.status_code == 403, f"passport rotate leaked: {p.status_code}"

    def test_customers_view_staff(self, owner_tok, created_users, some_vehicle_id):
        tok, _ = make_staff(owner_tok, created_users, ["customers.view"], "custview")
        h = hdr(tok)
        g = requests.get(f"{API}/vehicles/{some_vehicle_id}/passport/token", headers=h, timeout=30)
        assert g.status_code == 200, f"customers.view staff got {g.status_code} on passport token: {g.text[:200]}"
        p = requests.post(f"{API}/vehicles/{some_vehicle_id}/passport/rotate", headers=h, json={}, timeout=30)
        assert p.status_code == 403, f"rotate leaked to customers.view staff: {p.status_code}"

    def test_customers_edit_staff(self, owner_tok, created_users, some_vehicle_id):
        tok, _ = make_staff(owner_tok, created_users, ["customers.view", "customers.edit"], "custedit")
        h = hdr(tok)
        assert requests.get(f"{API}/vehicles/{some_vehicle_id}/passport/token", headers=h, timeout=30).status_code == 200
        p = requests.post(f"{API}/vehicles/{some_vehicle_id}/passport/rotate", headers=h, json={}, timeout=30)
        assert p.status_code in (200, 201), f"rotate blocked for customers.edit: {p.status_code} {p.text[:200]}"
