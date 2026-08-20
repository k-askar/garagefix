"""Iteration 5 - Payment methods / accounts feature tests."""
import time
import pytest
import requests
from conftest import BASE_URL


# ---------- helpers ----------
def _methods(client):
    r = client.get(f"{BASE_URL}/api/payment-methods", timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def _balance(client, mid):
    r = client.get(f"{BASE_URL}/api/payments/summary", timeout=30)
    assert r.status_code == 200
    for m in r.json()["methods"]:
        if m["id"] == mid:
            return m["balance"]
    raise AssertionError("method not found in summary")


@pytest.fixture(scope="module")
def seed(owner_client):
    """Create inventory item + customer + supplier for invoice/PO flows."""
    sku = f"TEST_PM_{int(time.time())}"
    r = owner_client.post(f"{BASE_URL}/api/inventory", json={
        "name": "TEST_PM Widget", "sku": sku, "category": "General",
        "quantity": 100, "cost_price": 10.0, "selling_price": 25.0,
        "min_stock": 1,
    }, timeout=30)
    assert r.status_code in (200, 201), r.text[:300]
    item = r.json()

    rc = owner_client.post(f"{BASE_URL}/api/customers", json={"name": "TEST_PM Customer"}, timeout=30)
    assert rc.status_code in (200, 201), rc.text[:300]
    cust = rc.json()

    rs = owner_client.post(f"{BASE_URL}/api/suppliers", json={"name": "TEST_PM Supplier"}, timeout=30)
    assert rs.status_code in (200, 201), rs.text[:300]
    sup = rs.json()

    data = {"item": item, "customer": cust, "supplier": sup}
    yield data
    owner_client.delete(f"{BASE_URL}/api/inventory/{item['id']}", timeout=30)


# ---------- GET /payment-methods seeding + balance ----------
class TestPaymentMethodsList:
    def test_defaults_seeded_with_balance(self, owner_client):
        methods = _methods(owner_client)
        names = [m["name"] for m in methods]
        for expected in ["Cash", "Bank Transfer", "Card / ATM"]:
            assert expected in names, f"missing default method {expected}; got {names}"
        for m in methods:
            assert "balance" in m, f"balance missing on {m['name']}"
            assert isinstance(m["balance"], (int, float))
            assert "_id" not in m

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/payment-methods", timeout=30)
        assert r.status_code in (401, 403), r.status_code

    def test_summary_total_matches_sum(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/payments/summary", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "methods" in data and "total_balance" in data
        s = round(sum(m["balance"] for m in data["methods"]), 2)
        assert abs(s - data["total_balance"]) < 0.01


# ---------- CRUD ----------
class TestPaymentMethodCRUD:
    def test_create_update_delete_and_rbac(self, owner_client, staff_client):
        # staff denied
        r = staff_client.post(f"{BASE_URL}/api/payment-methods", json={
            "name": "TEST_PM StaffTry", "type": "other", "opening_balance": 10}, timeout=30)
        assert r.status_code == 403, f"staff create expected 403, got {r.status_code}"

        # owner create
        r = owner_client.post(f"{BASE_URL}/api/payment-methods", json={
            "name": "TEST_PM PayPal", "type": "other", "opening_balance": 100}, timeout=30)
        assert r.status_code in (200, 201), r.text[:300]
        m = r.json()
        mid = m["id"]
        assert m["name"] == "TEST_PM PayPal"
        assert m["opening_balance"] == 100
        assert m["type"] == "other"
        assert m["active"] is True

        # appears in list with balance == opening
        listed = [x for x in _methods(owner_client) if x["id"] == mid]
        assert listed, "created method not in list"
        assert listed[0]["balance"] == 100

        # update
        r = owner_client.put(f"{BASE_URL}/api/payment-methods/{mid}", json={
            "name": "TEST_PM Wise", "opening_balance": 250}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["name"] == "TEST_PM Wise"
        assert r.json()["opening_balance"] == 250

        got = [x for x in _methods(owner_client) if x["id"] == mid][0]
        assert got["name"] == "TEST_PM Wise"
        assert got["balance"] == 250

        # deactivate
        r = owner_client.put(f"{BASE_URL}/api/payment-methods/{mid}", json={"active": False}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["active"] is False, "active=False was dropped by None-filter"

        # reactivate
        owner_client.put(f"{BASE_URL}/api/payment-methods/{mid}", json={"active": True}, timeout=30)

        # staff denied update / delete
        assert staff_client.put(f"{BASE_URL}/api/payment-methods/{mid}", json={"name": "X"}, timeout=30).status_code == 403
        assert staff_client.delete(f"{BASE_URL}/api/payment-methods/{mid}", timeout=30).status_code == 403

        # delete blocked when entries exist
        e = owner_client.post(f"{BASE_URL}/api/payment-entries", json={
            "method_id": mid, "direction": "in", "amount": 5, "note": "TEST_PM block delete"}, timeout=30)
        assert e.status_code in (200, 201), e.text[:300]
        eid = e.json()["id"]
        r = owner_client.delete(f"{BASE_URL}/api/payment-methods/{mid}", timeout=30)
        assert r.status_code == 400, f"expected 400 when entries exist, got {r.status_code}"

        # remove entry then delete succeeds
        assert owner_client.delete(f"{BASE_URL}/api/payment-entries/{eid}", timeout=30).status_code == 200
        r = owner_client.delete(f"{BASE_URL}/api/payment-methods/{mid}", timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert not [x for x in _methods(owner_client) if x["id"] == mid]

    def test_update_unknown_id_404(self, owner_client):
        r = owner_client.put(f"{BASE_URL}/api/payment-methods/does-not-exist", json={"name": "x"}, timeout=30)
        assert r.status_code == 404

    def test_invalid_type_rejected(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/payment-methods", json={
            "name": "TEST_PM Bad", "type": "crypto"}, timeout=30)
        assert r.status_code == 422, r.status_code


# ---------- entries + statement ----------
class TestEntriesAndStatement:
    def test_manual_entries_and_statement(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/payment-methods", json={
            "name": "TEST_PM Statement", "type": "cash", "opening_balance": 500}, timeout=30)
        mid = r.json()["id"]
        try:
            dep = owner_client.post(f"{BASE_URL}/api/payment-entries", json={
                "method_id": mid, "direction": "in", "amount": 200,
                "counterpart": "TEST_PM Cust", "note": "deposit"}, timeout=30)
            assert dep.status_code in (200, 201), dep.text[:300]
            assert dep.json()["reference_type"] == "manual"
            assert dep.json()["method_name"] == "TEST_PM Statement"
            wd = owner_client.post(f"{BASE_URL}/api/payment-entries", json={
                "method_id": mid, "direction": "out", "amount": 75.5, "note": "withdraw"}, timeout=30)
            assert wd.status_code in (200, 201), wd.text[:300]

            assert _balance(owner_client, mid) == 624.5

            st = owner_client.get(f"{BASE_URL}/api/payment-methods/{mid}/statement", timeout=30)
            assert st.status_code == 200, st.text[:300]
            s = st.json()
            assert s["opening_balance"] == 500
            assert s["period_opening"] == 500
            assert s["total_in"] == 200
            assert s["total_out"] == 75.5
            assert s["closing_balance"] == 624.5
            assert len(s["entries"]) == 2
            assert s["entries"][0]["balance_after"] == 700
            assert s["entries"][1]["balance_after"] == 624.5
            assert all("_id" not in e for e in s["entries"])

            # filtered entries list
            le = owner_client.get(f"{BASE_URL}/api/payment-entries", params={"method_id": mid}, timeout=30)
            assert le.status_code == 200
            assert len(le.json()) == 2

            # cleanup entries
            for e in le.json():
                assert owner_client.delete(f"{BASE_URL}/api/payment-entries/{e['id']}", timeout=30).status_code == 200
        finally:
            owner_client.delete(f"{BASE_URL}/api/payment-methods/{mid}", timeout=30)

    def test_entry_validation(self, owner_client):
        methods = _methods(owner_client)
        mid = methods[0]["id"]
        r = owner_client.post(f"{BASE_URL}/api/payment-entries", json={
            "method_id": mid, "direction": "in", "amount": 0}, timeout=30)
        assert r.status_code == 422, r.status_code
        r = owner_client.post(f"{BASE_URL}/api/payment-entries", json={
            "method_id": mid, "direction": "sideways", "amount": 10}, timeout=30)
        assert r.status_code == 422, r.status_code
        r = owner_client.post(f"{BASE_URL}/api/payment-entries", json={
            "method_id": "nope", "direction": "in", "amount": 10}, timeout=30)
        assert r.status_code == 404, r.status_code

    def test_statement_unknown_method_404(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/payment-methods/nope/statement", timeout=30)
        assert r.status_code == 404


# ---------- invoice mark-paid ----------
class TestInvoicePayment:
    def test_mark_paid_logs_in_entry(self, owner_client, seed):
        item, cust = seed["item"], seed["customer"]
        # OUT transaction
        t = owner_client.post(f"{BASE_URL}/api/transactions", json={
            "type": "OUT", "item_id": item["id"], "quantity": 2,
            "unit_price": 30.0, "customer_id": cust["id"], "note": "TEST_PM sale"}, timeout=30)
        assert t.status_code in (200, 201), t.text[:300]
        txn_id = t.json()["id"]

        inv = owner_client.post(f"{BASE_URL}/api/invoices/from-transactions", json={
            "customer_id": cust["id"], "transaction_ids": [txn_id], "tax_rate": 0}, timeout=30)
        assert inv.status_code in (200, 201), inv.text[:300]
        invoice = inv.json()
        assert invoice["status"] == "draft"
        total = invoice["total"]

        mid = [m for m in _methods(owner_client) if m["name"] == "Cash"][0]["id"]
        before = _balance(owner_client, mid)

        r = owner_client.post(f"{BASE_URL}/api/invoices/{invoice['id']}/mark-paid",
                              json={"payment_method_id": mid}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("payment_method") == "Cash"

        after = _balance(owner_client, mid)
        assert round(after - before, 2) == round(total, 2), f"balance delta {after-before} != invoice total {total}"

        # invoice reflects method
        invs = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30).json()
        mine = [i for i in invs if i["id"] == invoice["id"]][0]
        assert mine["status"] == "paid"
        assert mine["payment_method_name"] == "Cash"
        assert mine["payment_method_id"] == mid

        # re-mark -> 400
        r = owner_client.post(f"{BASE_URL}/api/invoices/{invoice['id']}/mark-paid",
                             json={"payment_method_id": mid}, timeout=30)
        assert r.status_code == 400, r.status_code

        # invoice-ref entry cannot be deleted
        entries = owner_client.get(f"{BASE_URL}/api/payment-entries",
                                   params={"method_id": mid, "limit": 500}, timeout=30).json()
        inv_entries = [e for e in entries if e.get("reference_id") == invoice["id"]]
        assert inv_entries, "no payment entry logged for invoice"
        assert inv_entries[0]["direction"] == "in"
        assert inv_entries[0]["reference_type"] == "invoice"
        assert inv_entries[0]["reference_no"] == invoice["invoice_number"]
        d = owner_client.delete(f"{BASE_URL}/api/payment-entries/{inv_entries[0]['id']}", timeout=30)
        assert d.status_code == 400, f"invoice entry deletable! got {d.status_code}"

        # cash-register exposes payment_method_name
        cr = owner_client.get(f"{BASE_URL}/api/cash-register", timeout=30)
        assert cr.status_code == 200, cr.text[:300]
        crj = cr.json()
        found = [i for i in crj["invoices"] if i["id"] == invoice["id"]]
        assert found, "paid invoice missing from cash register"
        assert found[0].get("payment_method_name") == "Cash"

        owner_client.delete(f"{BASE_URL}/api/invoices/{invoice['id']}", timeout=30)

    def test_mark_paid_bad_method_404(self, owner_client, seed):
        item, cust = seed["item"], seed["customer"]
        t = owner_client.post(f"{BASE_URL}/api/transactions", json={
            "type": "OUT", "item_id": item["id"], "quantity": 1,
            "unit_price": 10.0, "customer_id": cust["id"], "note": "TEST_PM sale2"}, timeout=30)
        txn_id = t.json()["id"]
        inv = owner_client.post(f"{BASE_URL}/api/invoices/from-transactions", json={
            "customer_id": cust["id"], "transaction_ids": [txn_id]}, timeout=30).json()
        r = owner_client.post(f"{BASE_URL}/api/invoices/{inv['id']}/mark-paid",
                              json={"payment_method_id": "bogus"}, timeout=30)
        assert r.status_code == 404, r.status_code
        # invoice must still be draft
        invs = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30).json()
        assert [i for i in invs if i["id"] == inv["id"]][0]["status"] == "draft"
        owner_client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=30)


# ---------- PO receive ----------
class TestPOReceive:
    def test_receive_logs_out_entry_and_updates_inventory(self, owner_client, staff_client, seed):
        item, sup = seed["item"], seed["supplier"]
        before_item = owner_client.get(f"{BASE_URL}/api/inventory/{item['id']}", timeout=30).json()
        qty_before = before_item["quantity"]

        po = owner_client.post(f"{BASE_URL}/api/purchase-orders", json={
            "supplier_id": sup["id"],
            "items": [{"item_id": item["id"], "sku": item["sku"], "name": item["name"],
                       "quantity": 5, "unit_cost": 12.0, "total": 60.0}],
            "note": "TEST_PM po",
        }, timeout=30)
        assert po.status_code in (200, 201), po.text[:300]
        poj = po.json()
        po_total = poj["total"]

        mid = [m for m in _methods(owner_client) if m["name"] == "Bank Transfer"][0]["id"]
        before = _balance(owner_client, mid)

        # staff denied
        rs = staff_client.post(f"{BASE_URL}/api/purchase-orders/{poj['id']}/receive",
                               json={"payment_method_id": mid}, timeout=30)
        assert rs.status_code == 403, rs.status_code

        r = owner_client.post(f"{BASE_URL}/api/purchase-orders/{poj['id']}/receive",
                              json={"payment_method_id": mid}, timeout=30)
        assert r.status_code == 200, r.text[:300]

        after = _balance(owner_client, mid)
        assert round(before - after, 2) == round(po_total, 2), f"expected -{po_total}, got {after-before}"

        after_item = owner_client.get(f"{BASE_URL}/api/inventory/{item['id']}", timeout=30).json()
        assert after_item["quantity"] == qty_before + 5
        assert after_item["cost_price"] == 12.0

        pos = owner_client.get(f"{BASE_URL}/api/purchase-orders", timeout=30).json()
        mine = [p for p in pos if p["id"] == poj["id"]][0]
        assert mine["status"] == "received"
        assert mine.get("payment_method_name") == "Bank Transfer"

        # duplicate receive
        r = owner_client.post(f"{BASE_URL}/api/purchase-orders/{poj['id']}/receive",
                              json={"payment_method_id": mid}, timeout=30)
        assert r.status_code == 400, r.status_code

        entries = owner_client.get(f"{BASE_URL}/api/payment-entries",
                                   params={"method_id": mid, "limit": 500}, timeout=30).json()
        po_entries = [e for e in entries if e.get("reference_id") == poj["id"]]
        assert po_entries, "no OUT entry logged for PO"
        assert po_entries[0]["direction"] == "out"
        assert po_entries[0]["reference_type"] == "po"
        d = owner_client.delete(f"{BASE_URL}/api/payment-entries/{po_entries[0]['id']}", timeout=30)
        assert d.status_code == 400, f"po entry deletable! got {d.status_code}"

        owner_client.delete(f"{BASE_URL}/api/purchase-orders/{poj['id']}", timeout=30)
