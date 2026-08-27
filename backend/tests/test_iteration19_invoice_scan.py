"""Iteration 19 — AI invoice / pakbon scanning module (routes/invoice_scan.py).

Covers: upload+parse (POST /api/inventory/scan/invoice), sessions list/detail,
waiting list, item PATCH (+barcode re-match), enter (new / update / partial),
wait, delete, and tenant isolation.
"""
import os
import re
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE}/api"

SUPER = ("platform@pitstock.app", "platform123")
TENANT_A = "d85ebd4a-40a2-407f-9473-d3d5044e1889"
INVOICE_PNG = "/tmp/test_invoice.png"


def login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok
    return tok


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def super_tok():
    return login(*SUPER)


@pytest.fixture(scope="module")
def tok_a(super_tok):
    """Impersonation token scoped to TestGarage (tenant A)."""
    r = requests.post(f"{API}/tenants/{TENANT_A}/impersonate", headers=hdr(super_tok), timeout=30)
    assert r.status_code == 200, f"impersonate failed: {r.status_code} {r.text[:300]}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def created_inventory():
    ids = []
    yield ids


@pytest.fixture(scope="module", autouse=True)
def cleanup(tok_a, created_inventory):
    yield
    for iid in created_inventory:
        requests.delete(f"{API}/inventory/{iid}", headers=hdr(tok_a), timeout=30)


# ---------------- upload + parse ----------------

@pytest.fixture(scope="module")
def session_doc(tok_a):
    assert os.path.exists(INVOICE_PNG), f"missing fixture image {INVOICE_PNG}"
    with open(INVOICE_PNG, "rb") as f:
        files = {"file": ("test_invoice.png", f.read(), "image/png")}
    r = requests.post(f"{API}/inventory/scan/invoice", headers=hdr(tok_a),
                      files=files, data={"engine": "claude"}, timeout=180)
    assert r.status_code == 200, f"scan failed: {r.status_code} {r.text[:500]}"
    return r.json()


class TestScanUpload:
    def test_response_shape(self, session_doc):
        d = session_doc
        assert isinstance(d.get("id"), str) and d["id"]
        assert "_id" not in d
        sup = d.get("supplier") or {}
        assert sup.get("name"), "supplier.name missing"
        assert "kvk" in sup and "iban" in sup
        assert isinstance(d.get("invoice_number"), str)
        assert isinstance(d.get("invoice_date"), str)
        assert isinstance(d.get("total_amount"), (int, float)) and d["total_amount"] > 0
        assert 0 < float(d.get("confidence", 0)) <= 1
        assert d.get("status") == "open"
        assert d.get("engine") == "claude"

    def test_items_parsed(self, session_doc):
        items = session_doc.get("items") or []
        assert 3 <= len(items) <= 6, f"expected 3-5 items, got {len(items)}"
        for it in items:
            assert it["name"]
            assert re.fullmatch(r"\d*", it["barcode"] or "")
            assert isinstance(it["quantity"], int) and it["quantity"] >= 1
            assert isinstance(it["cost_price"], (int, float)) and it["cost_price"] > 0
            assert it["match_type"] in ("new", "update")
            assert it["status"] == "pending"

    def test_empty_file_rejected(self, tok_a):
        r = requests.post(f"{API}/inventory/scan/invoice", headers=hdr(tok_a),
                          files={"file": ("empty.png", b"", "image/png")}, timeout=60)
        assert r.status_code == 400, r.text[:200]

    def test_unsupported_type_rejected(self, tok_a):
        r = requests.post(f"{API}/inventory/scan/invoice", headers=hdr(tok_a),
                          files={"file": ("notes.txt", b"hello world", "text/plain")}, timeout=60)
        assert r.status_code == 400, r.text[:200]

    def test_requires_auth(self):
        r = requests.post(f"{API}/inventory/scan/invoice",
                          files={"file": ("x.png", b"123", "image/png")}, timeout=60)
        assert r.status_code in (401, 403)


# ---------------- sessions / waiting listings ----------------

class TestSessionListings:
    def test_list_sessions_contains_new(self, tok_a, session_doc):
        r = requests.get(f"{API}/inventory/scan/sessions", headers=hdr(tok_a), timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert any(s["id"] == session_doc["id"] for s in rows)
        assert all("_id" not in s for s in rows)

    def test_get_session_detail(self, tok_a, session_doc):
        r = requests.get(f"{API}/inventory/scan/sessions/{session_doc['id']}", headers=hdr(tok_a), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == session_doc["id"]
        assert len(d["items"]) == len(session_doc["items"])

    def test_get_session_404(self, tok_a):
        r = requests.get(f"{API}/inventory/scan/sessions/{uuid.uuid4()}", headers=hdr(tok_a), timeout=30)
        assert r.status_code == 404

    def test_waiting_list_is_list(self, tok_a):
        r = requests.get(f"{API}/inventory/scan/waiting", headers=hdr(tok_a), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------- PATCH item ----------------

class TestPatchItem:
    def test_edit_fields(self, tok_a, session_doc):
        sid = session_doc["id"]
        iid = session_doc["items"][0]["id"]
        payload = {"name": "TEST_Edited Part", "quantity": 7, "cost_price": 12.34}
        r = requests.patch(f"{API}/inventory/scan/sessions/{sid}/items/{iid}",
                           headers=hdr(tok_a), json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        g = requests.get(f"{API}/inventory/scan/sessions/{sid}", headers=hdr(tok_a), timeout=30).json()
        it = next(x for x in g["items"] if x["id"] == iid)
        assert it["name"] == "TEST_Edited Part"
        assert it["quantity"] == 7
        assert it["cost_price"] == 12.34

    def test_barcode_rematch_to_update(self, tok_a, session_doc, created_inventory):
        # Create an inventory item with a known barcode
        code = "9" + str(uuid.uuid4().int)[:12]
        inv = requests.post(f"{API}/inventory", headers=hdr(tok_a), json={
            "name": "TEST_Existing Match Item", "barcode": code, "quantity": 5,
            "cost_price": 10.0, "selling_price": 20.0,
        }, timeout=30)
        assert inv.status_code in (200, 201), inv.text[:300]
        inv_id = inv.json()["id"]
        created_inventory.append(inv_id)

        sid = session_doc["id"]
        iid = session_doc["items"][1]["id"]
        r = requests.patch(f"{API}/inventory/scan/sessions/{sid}/items/{iid}",
                           headers=hdr(tok_a), json={"barcode": code}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        g = requests.get(f"{API}/inventory/scan/sessions/{sid}", headers=hdr(tok_a), timeout=30).json()
        it = next(x for x in g["items"] if x["id"] == iid)
        assert it["barcode"] == code
        assert it["match_type"] == "update"
        assert it["matched_item_id"] == inv_id

    def test_patch_unknown_item_404(self, tok_a, session_doc):
        r = requests.patch(f"{API}/inventory/scan/sessions/{session_doc['id']}/items/{uuid.uuid4()}",
                           headers=hdr(tok_a), json={"name": "x"}, timeout=30)
        assert r.status_code == 404


# ---------------- enter: new / update / partial ----------------

class TestEnterFlows:
    def test_enter_new_creates_inventory_and_transaction(self, tok_a, session_doc, created_inventory):
        sid = session_doc["id"]
        iid = session_doc["items"][2]["id"]
        code = "8" + str(uuid.uuid4().int)[:12]
        name = "TEST_New Scan Part"
        # make sure the row is `new`
        requests.patch(f"{API}/inventory/scan/sessions/{sid}/items/{iid}", headers=hdr(tok_a),
                       json={"barcode": code, "name": name, "quantity": 3,
                             "cost_price": 9.5, "selling_price": 19.0}, timeout=30)

        before = requests.get(f"{API}/inventory", headers=hdr(tok_a), timeout=30).json()
        r = requests.post(f"{API}/inventory/scan/sessions/{sid}/items/{iid}/enter",
                          headers=hdr(tok_a), json={}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["match"] == "new"
        assert body["entered_qty"] == 3
        assert body["remaining"] == 0
        inv_id = body["inventory_item_id"]
        created_inventory.append(inv_id)

        after = requests.get(f"{API}/inventory", headers=hdr(tok_a), timeout=30).json()
        assert len(after) == len(before) + 1

        got = requests.get(f"{API}/inventory/{inv_id}", headers=hdr(tok_a), timeout=30)
        assert got.status_code == 200
        d = got.json()
        assert d["name"] == name
        assert d["barcode"] == code
        assert d["quantity"] == 3
        assert d["cost_price"] == 9.5
        assert d["selling_price"] == 19.0

        # session row is entered
        g = requests.get(f"{API}/inventory/scan/sessions/{sid}", headers=hdr(tok_a), timeout=30).json()
        it = next(x for x in g["items"] if x["id"] == iid)
        assert it["status"] == "entered"
        assert it["entered_item_id"] == inv_id

        # IN transaction logged
        txs = requests.get(f"{API}/transactions", headers=hdr(tok_a), timeout=30).json()
        assert any(t.get("item_id") == inv_id and t.get("type") == "IN" and t.get("quantity") == 3
                   for t in txs), "no IN transaction logged for scan entry"

    def test_enter_existing_barcode_bumps_quantity(self, tok_a, session_doc, created_inventory):
        sid = session_doc["id"]
        iid = session_doc["items"][1]["id"]
        code = "6" + str(uuid.uuid4().int)[:12]
        inv = requests.post(f"{API}/inventory", headers=hdr(tok_a), json={
            "name": "TEST_Bump Target", "barcode": code, "quantity": 5,
            "cost_price": 10.0, "selling_price": 20.0,
        }, timeout=30)
        assert inv.status_code in (200, 201), inv.text[:300]
        inv_id = inv.json()["id"]
        created_inventory.append(inv_id)
        pr = requests.patch(f"{API}/inventory/scan/sessions/{sid}/items/{iid}",
                            headers=hdr(tok_a), json={"barcode": code}, timeout=30)
        assert pr.status_code == 200, pr.text[:300]
        prev = requests.get(f"{API}/inventory/{inv_id}", headers=hdr(tok_a), timeout=30).json()

        r = requests.post(f"{API}/inventory/scan/sessions/{sid}/items/{iid}/enter",
                          headers=hdr(tok_a), json={"quantity": 2, "cost_price": 11.0, "selling_price": 22.0},
                          timeout=60)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["match"] == "update"
        assert body["inventory_item_id"] == inv_id
        assert body["entered_qty"] == 2

        now = requests.get(f"{API}/inventory/{inv_id}", headers=hdr(tok_a), timeout=30).json()
        assert now["quantity"] == prev["quantity"] + 2
        assert now["cost_price"] == 11.0
        assert now["selling_price"] == 22.0

    def test_enter_already_handled_rejected(self, tok_a, session_doc):
        sid = session_doc["id"]
        iid = session_doc["items"][2]["id"]
        r = requests.post(f"{API}/inventory/scan/sessions/{sid}/items/{iid}/enter",
                          headers=hdr(tok_a), json={}, timeout=60)
        assert r.status_code == 400, r.text[:200]

    def test_partial_delivery_flow(self, tok_a, session_doc, created_inventory):
        sid = session_doc["id"]
        iid = session_doc["items"][0]["id"]
        code = "7" + str(uuid.uuid4().int)[:12]
        requests.patch(f"{API}/inventory/scan/sessions/{sid}/items/{iid}", headers=hdr(tok_a),
                       json={"barcode": code, "quantity": 4, "cost_price": 5.0}, timeout=30)

        r1 = requests.post(f"{API}/inventory/scan/sessions/{sid}/items/{iid}/enter",
                           headers=hdr(tok_a), json={"enter_partial_qty": 1}, timeout=60)
        assert r1.status_code == 200, r1.text[:300]
        b1 = r1.json()
        assert b1["entered_qty"] == 1
        assert b1["remaining"] == 3, f"expected remaining=3, got {b1}"
        created_inventory.append(b1["inventory_item_id"])

        g = requests.get(f"{API}/inventory/scan/sessions/{sid}", headers=hdr(tok_a), timeout=30).json()
        it = next(x for x in g["items"] if x["id"] == iid)
        assert it["status"] == "waiting"
        assert it["quantity"] == 3
        assert it["entered_qty"] == 1

        # waiting list surfaces it
        w = requests.get(f"{API}/inventory/scan/waiting", headers=hdr(tok_a), timeout=30).json()
        assert any(x["item_id"] == iid and x["quantity"] == 3 for x in w), "partial row missing from waiting list"

        # close the rest
        r2 = requests.post(f"{API}/inventory/scan/sessions/{sid}/items/{iid}/enter",
                           headers=hdr(tok_a), json={"enter_partial_qty": 3}, timeout=60)
        assert r2.status_code == 200, r2.text[:300]
        b2 = r2.json()
        assert b2["remaining"] == 0
        assert b2["entered_qty"] == 3

        g2 = requests.get(f"{API}/inventory/scan/sessions/{sid}", headers=hdr(tok_a), timeout=30).json()
        it2 = next(x for x in g2["items"] if x["id"] == iid)
        assert it2["status"] == "entered"
        assert it2["entered_qty"] == 4

        inv = requests.get(f"{API}/inventory/{b2['inventory_item_id']}", headers=hdr(tok_a), timeout=30).json()
        assert inv["quantity"] == 4, f"expected 4 units total in stock, got {inv['quantity']}"

        w2 = requests.get(f"{API}/inventory/scan/waiting", headers=hdr(tok_a), timeout=30).json()
        assert not any(x["item_id"] == iid for x in w2), "row still waiting after full entry"

    def test_enter_zero_qty_rejected(self, tok_a, session_doc):
        sid = session_doc["id"]
        iid = session_doc["items"][3]["id"] if len(session_doc["items"]) > 3 else session_doc["items"][0]["id"]
        r = requests.post(f"{API}/inventory/scan/sessions/{sid}/items/{iid}/enter",
                          headers=hdr(tok_a), json={"quantity": 0}, timeout=60)
        assert r.status_code == 400, r.text[:200]


# ---------------- wait / delete ----------------

class TestWaitDelete:
    @pytest.fixture(scope="class")
    def fresh_session(self, tok_a, session_doc):
        return session_doc

    def test_wait_then_delete(self, tok_a, session_doc):
        sid = session_doc["id"]
        # find a still-pending row
        g = requests.get(f"{API}/inventory/scan/sessions/{sid}", headers=hdr(tok_a), timeout=30).json()
        pend = [x for x in g["items"] if x["status"] == "pending"]
        if not pend:
            pytest.skip("no pending rows left in the shared session")
        iid = pend[0]["id"]

        r = requests.post(f"{API}/inventory/scan/sessions/{sid}/items/{iid}/wait", headers=hdr(tok_a), timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["status"] == "waiting"

        w = requests.get(f"{API}/inventory/scan/waiting", headers=hdr(tok_a), timeout=30).json()
        assert any(x["item_id"] == iid for x in w), "waited row missing from /waiting"

        d = requests.post(f"{API}/inventory/scan/sessions/{sid}/items/{iid}/delete", headers=hdr(tok_a), timeout=30)
        assert d.status_code == 200, d.text[:300]
        assert d.json()["status"] == "deleted"

        w2 = requests.get(f"{API}/inventory/scan/waiting", headers=hdr(tok_a), timeout=30).json()
        assert not any(x["item_id"] == iid for x in w2), "deleted row still in /waiting"

        g2 = requests.get(f"{API}/inventory/scan/sessions/{sid}", headers=hdr(tok_a), timeout=30).json()
        it = next(x for x in g2["items"] if x["id"] == iid)
        assert it["status"] == "deleted"


# ---------------- tenant isolation ----------------

class TestTenantIsolation:
    def test_session_not_visible_in_other_tenant(self, super_tok, tok_a, session_doc):
        # find or create a second tenant
        tl = requests.get(f"{API}/tenants", headers=hdr(super_tok), timeout=30)
        assert tl.status_code == 200, tl.text[:300]
        others = [t for t in tl.json() if t["id"] != TENANT_A]
        if others:
            tid_b = others[0]["id"]
        else:
            cr = requests.post(f"{API}/tenants", headers=hdr(super_tok), json={
                "name": f"TEST_IsolationGarage_{uuid.uuid4().hex[:6]}",
                "owner_email": f"TEST_iso_{uuid.uuid4().hex[:6]}@test.com",
                "owner_password": "isotest123",
                "owner_name": "Iso Owner",
            }, timeout=60)
            assert cr.status_code in (200, 201), f"tenant create failed: {cr.status_code} {cr.text[:300]}"
            tid_b = (cr.json().get("tenant") or cr.json()).get("id")
            assert tid_b

        tb = requests.post(f"{API}/tenants/{tid_b}/impersonate", headers=hdr(super_tok), timeout=30)
        assert tb.status_code == 200, tb.text[:300]
        tok_b = tb.json()["token"]

        rows = requests.get(f"{API}/inventory/scan/sessions", headers=hdr(tok_b), timeout=30)
        assert rows.status_code == 200, rows.text[:300]
        assert not any(s["id"] == session_doc["id"] for s in rows.json()), "session leaked across tenants"

        one = requests.get(f"{API}/inventory/scan/sessions/{session_doc['id']}", headers=hdr(tok_b), timeout=30)
        assert one.status_code == 404, f"cross-tenant session detail readable: {one.status_code}"

        w = requests.get(f"{API}/inventory/scan/waiting", headers=hdr(tok_b), timeout=30)
        assert w.status_code == 200
        assert not any(x["session_id"] == session_doc["id"] for x in w.json()), "waiting rows leaked"
