"""Iteration 3 backend tests: Purchase Orders, Invoices, Profit Report, Repair Cards."""
import uuid
import pytest
import requests
from conftest import BASE_URL


# ---------- helpers / shared fixtures ----------
@pytest.fixture(scope="module")
def test_item(owner_client):
    """Create a dedicated inventory item with known cost/selling price."""
    sku = f"TEST_SKU_{uuid.uuid4().hex[:6].upper()}"
    payload = {
        "sku": sku, "barcode": f"TESTBC{uuid.uuid4().hex[:8].upper()}",
        "name": "TEST_Brake Pad", "category": "TEST_Brakes",
        "quantity": 20, "reorder_point": 30,
        "cost_price": 10.0, "selling_price": 25.0,
        "unit": "pcs", "location": "T1",
    }
    r = owner_client.post(f"{BASE_URL}/api/inventory", json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    item = r.json()
    yield item
    owner_client.delete(f"{BASE_URL}/api/inventory/{item['id']}", timeout=30)


@pytest.fixture(scope="module")
def test_customer(owner_client):
    r = owner_client.post(f"{BASE_URL}/api/customers",
                          json={"name": "TEST_Customer QA", "phone": "555000", "email": "qa@test.local"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    c = r.json()
    yield c
    owner_client.delete(f"{BASE_URL}/api/customers/{c['id']}", timeout=30)


def _get_item(owner_client, item_id):
    r = owner_client.get(f"{BASE_URL}/api/inventory/{item_id}", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ============ Purchase Orders ============
class TestPurchaseOrders:
    def test_suggest_returns_low_stock_groups(self, owner_client, test_item):
        r = owner_client.get(f"{BASE_URL}/api/purchase-orders/suggest", timeout=30)
        assert r.status_code == 200, r.text
        groups = r.json()
        assert isinstance(groups, list) and len(groups) > 0
        g = groups[0]
        for k in ("supplier_name", "items", "total"):
            assert k in g, f"missing {k} in suggestion group"
        all_skus = [l["sku"] for grp in groups for l in grp["items"]]
        assert test_item["sku"] in all_skus, "low-stock test item not suggested"
        line = [l for grp in groups for l in grp["items"] if l["sku"] == test_item["sku"]][0]
        # reorder_point*2 - qty = 60-20 = 40
        assert line["quantity"] == 40
        assert line["unit_cost"] == 10.0

    def test_po_lifecycle_draft_send_receive(self, owner_client, test_item):
        before = _get_item(owner_client, test_item["id"])["quantity"]
        payload = {"items": [{"item_id": test_item["id"], "sku": test_item["sku"],
                              "name": test_item["name"], "quantity": 5, "unit_cost": 10.0}],
                   "note": "TEST_PO"}
        r = owner_client.post(f"{BASE_URL}/api/purchase-orders", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        assert po["status"] == "draft"
        assert po["total"] == 50.0
        assert po["po_number"].startswith("PO-")
        pid = po["id"]

        # persisted in list
        lst = owner_client.get(f"{BASE_URL}/api/purchase-orders", timeout=30).json()
        assert any(p["id"] == pid for p in lst)

        # send
        assert owner_client.post(f"{BASE_URL}/api/purchase-orders/{pid}/send", timeout=30).status_code == 200
        lst = owner_client.get(f"{BASE_URL}/api/purchase-orders", timeout=30).json()
        sent = next(p for p in lst if p["id"] == pid)
        assert sent["status"] == "sent" and sent["sent_at"]

        # double send should fail
        assert owner_client.post(f"{BASE_URL}/api/purchase-orders/{pid}/send", timeout=30).status_code == 400

        # receive -> inventory increments + IN txn
        assert owner_client.post(f"{BASE_URL}/api/purchase-orders/{pid}/receive", timeout=30).status_code == 200
        after = _get_item(owner_client, test_item["id"])["quantity"]
        assert after == before + 5, f"expected {before+5} got {after}"
        txns = owner_client.get(f"{BASE_URL}/api/transactions", timeout=30).json()
        assert any(t["type"] == "IN" and t["item_id"] == test_item["id"] and po["po_number"] in (t.get("note") or "")
                   for t in txns), "IN transaction for PO not found"

        # already received
        assert owner_client.post(f"{BASE_URL}/api/purchase-orders/{pid}/receive", timeout=30).status_code == 400

        # delete
        assert owner_client.delete(f"{BASE_URL}/api/purchase-orders/{pid}", timeout=30).status_code == 200
        lst = owner_client.get(f"{BASE_URL}/api/purchase-orders", timeout=30).json()
        assert not any(p["id"] == pid for p in lst)

    def test_po_404_on_unknown(self, owner_client):
        assert owner_client.post(f"{BASE_URL}/api/purchase-orders/{uuid.uuid4()}/send", timeout=30).status_code == 404
        assert owner_client.post(f"{BASE_URL}/api/purchase-orders/{uuid.uuid4()}/receive", timeout=30).status_code == 404

    def test_po_validation_rejects_zero_qty(self, owner_client, test_item):
        payload = {"items": [{"item_id": test_item["id"], "sku": test_item["sku"],
                              "name": test_item["name"], "quantity": 0, "unit_cost": 10.0}]}
        r = owner_client.post(f"{BASE_URL}/api/purchase-orders", json=payload, timeout=30)
        assert r.status_code == 422, r.text

    def test_staff_cannot_create_or_receive(self, staff_client, owner_client, test_item):
        payload = {"items": [{"item_id": test_item["id"], "sku": test_item["sku"],
                              "name": test_item["name"], "quantity": 1, "unit_cost": 1.0}]}
        r = staff_client.post(f"{BASE_URL}/api/purchase-orders", json=payload, timeout=30)
        assert r.status_code == 403, r.text
        po = owner_client.post(f"{BASE_URL}/api/purchase-orders", json=payload, timeout=30).json()
        assert staff_client.post(f"{BASE_URL}/api/purchase-orders/{po['id']}/receive", timeout=30).status_code == 403
        assert staff_client.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", timeout=30).status_code == 403
        owner_client.delete(f"{BASE_URL}/api/purchase-orders/{po['id']}", timeout=30)

    def test_unauthenticated_blocked(self):
        r = requests.get(f"{BASE_URL}/api/purchase-orders", timeout=30)
        assert r.status_code == 401


# ============ Invoices ============
class TestInvoices:
    @pytest.fixture(scope="class")
    def out_txns(self, owner_client, test_item, test_customer):
        ids = []
        for q in (2, 3):
            r = owner_client.post(f"{BASE_URL}/api/transactions", json={
                "type": "OUT", "item_id": test_item["id"], "quantity": q,
                "unit_price": 25.0, "customer_id": test_customer["id"], "note": "TEST_OUT"
            }, timeout=30)
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        return ids

    def test_invoice_from_transactions(self, owner_client, out_txns, test_customer):
        r = owner_client.post(f"{BASE_URL}/api/invoices/from-transactions", json={
            "customer_id": test_customer["id"], "transaction_ids": out_txns, "tax_rate": 10.0,
            "note": "TEST_INV"}, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["invoice_number"].startswith("INV-")
        assert len(inv["lines"]) == 2
        assert inv["subtotal"] == 125.0  # (2+3)*25
        assert inv["tax"] == 12.5
        assert inv["total"] == 137.5
        assert inv["status"] == "draft"
        assert inv["customer_name"] == test_customer["name"]

        # persisted
        lst = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30).json()
        got = next((i for i in lst if i["id"] == inv["id"]), None)
        assert got and got["total"] == 137.5

        # balance unpaid
        bal = owner_client.get(f"{BASE_URL}/api/customers/{test_customer['id']}/balance", timeout=30)
        assert bal.status_code == 200
        b = bal.json()
        assert b["unpaid"] >= 137.5 and b["invoice_count"] >= 1

        # mark paid
        assert owner_client.post(f"{BASE_URL}/api/invoices/{inv['id']}/mark-paid", timeout=30).status_code == 200
        lst = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30).json()
        assert next(i for i in lst if i["id"] == inv["id"])["status"] == "paid"
        b2 = owner_client.get(f"{BASE_URL}/api/customers/{test_customer['id']}/balance", timeout=30).json()
        assert b2["paid"] >= 137.5

        owner_client.delete(f"{BASE_URL}/api/invoices/{inv['id']}", timeout=30)

    def test_invoice_empty_txn_ids_400(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/invoices/from-transactions",
                              json={"transaction_ids": [str(uuid.uuid4())]}, timeout=30)
        assert r.status_code == 400, r.text

    def test_mark_paid_unknown_404(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/invoices/{uuid.uuid4()}/mark-paid", timeout=30)
        assert r.status_code == 404


# ============ Profit Report ============
class TestProfitReport:
    def test_profit_report_structure_and_math(self, owner_client, test_item, test_customer):
        # sell 4 @ 25 (cost 10) -> revenue 100, cost 40, profit 60
        r = owner_client.post(f"{BASE_URL}/api/transactions", json={
            "type": "OUT", "item_id": test_item["id"], "quantity": 4,
            "unit_price": 25.0, "customer_id": test_customer["id"], "note": "TEST_PROFIT"}, timeout=30)
        assert r.status_code == 200, r.text

        from datetime import datetime, timezone, timedelta
        today = datetime.now(timezone.utc).date()
        start = (today - timedelta(days=7)).isoformat()
        rep = owner_client.get(f"{BASE_URL}/api/reports/profit",
                               params={"start": start, "end": today.isoformat()}, timeout=30)
        assert rep.status_code == 200, rep.text
        d = rep.json()
        for k in ("total_revenue", "total_cost", "total_profit", "margin", "by_item", "by_category", "start", "end"):
            assert k in d, f"missing {k}"
        assert d["start"] == start and d["end"] == today.isoformat()
        assert isinstance(d["by_item"], list) and isinstance(d["by_category"], list)
        row = next((x for x in d["by_item"] if x["item_id"] == test_item["id"]), None)
        assert row, "test item missing from by_item"
        assert row["revenue"] >= 100.0
        assert row["cost"] >= 40.0
        assert row["profit"] == round(row["revenue"] - row["cost"], 2)
        assert "margin" in row and row["margin"] > 0
        cat = next((c for c in d["by_category"] if c["category"] == "TEST_Brakes"), None)
        assert cat, "test category missing from by_category"
        assert cat["profit"] == round(cat["revenue"] - cat["cost"], 2)
        assert d["total_profit"] == round(d["total_revenue"] - d["total_cost"], 2)

    def test_profit_report_defaults_no_params(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/reports/profit", timeout=30)
        assert r.status_code == 200, r.text
        assert "total_profit" in r.json()

    def test_profit_report_empty_range(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/reports/profit",
                             params={"start": "2001-01-01", "end": "2001-01-02"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total_revenue"] == 0 and d["margin"] == 0 and d["by_item"] == []

    def test_profit_report_bad_date_format(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/reports/profit",
                             params={"start": "not-a-date", "end": "2026-01-01"}, timeout=30)
        assert r.status_code in (400, 422), f"expected 4xx for bad date, got {r.status_code}: {r.text[:200]}"

    def test_staff_can_view_profit(self, staff_client):
        r = staff_client.get(f"{BASE_URL}/api/reports/profit", timeout=30)
        assert r.status_code == 200


# ============ Repair / Job Cards ============
class TestRepairCards:
    def test_repair_full_lifecycle(self, owner_client, test_item, test_customer):
        start_qty = _get_item(owner_client, test_item["id"])["quantity"]
        r = owner_client.post(f"{BASE_URL}/api/repairs", json={
            "customer_id": test_customer["id"], "customer_name": "TEST_Ignored",
            "customer_phone": "999", "car_make": "Toyota", "car_model": "Corolla",
            "car_year": "2015", "car_plate": "TEST-123", "complaint": "TEST_Brake noise"}, timeout=30)
        assert r.status_code == 200, r.text
        card = r.json()
        rid = card["id"]
        assert card["card_number"].startswith("JOB-")
        assert card["status"] == "open"
        assert card["customer_name"] == test_customer["name"]  # resolved from customer_id
        assert card["complaint"] == "TEST_Brake noise"

        # GET persisted
        got = owner_client.get(f"{BASE_URL}/api/repairs/{rid}", timeout=30)
        assert got.status_code == 200 and got.json()["car_plate"] == "TEST-123"

        # add part -> decrements inventory, creates OUT txn
        ap = owner_client.post(f"{BASE_URL}/api/repairs/{rid}/parts",
                               json={"item_id": test_item["id"], "quantity": 2}, timeout=30)
        assert ap.status_code == 200, ap.text
        c2 = ap.json()
        assert len(c2["parts_used"]) == 1
        part = c2["parts_used"][0]
        assert part["unit_price"] == 25.0 and part["total"] == 50.0 and part["txn_id"]
        assert c2["parts_total"] == 50.0 and c2["grand_total"] == 50.0
        assert _get_item(owner_client, test_item["id"])["quantity"] == start_qty - 2
        txns = owner_client.get(f"{BASE_URL}/api/transactions", timeout=30).json()
        rt = next((t for t in txns if t["id"] == part["txn_id"]), None)
        assert rt and rt["type"] == "OUT" and rt.get("repair_id") == rid
        assert rt.get("item_cost") == 10.0

        # over-stock part rejected
        bad = owner_client.post(f"{BASE_URL}/api/repairs/{rid}/parts",
                                json={"item_id": test_item["id"], "quantity": 999999}, timeout=30)
        assert bad.status_code == 400, bad.text

        # update labor + status
        up = owner_client.put(f"{BASE_URL}/api/repairs/{rid}",
                              json={"labor_charge": 30.0, "status": "in_progress",
                                    "diagnosis": "TEST_worn pads", "work_done": "Replaced pads"}, timeout=30)
        assert up.status_code == 200, up.text
        u = up.json()
        assert u["labor_charge"] == 30.0 and u["status"] == "in_progress"
        assert u["grand_total"] == 80.0, f"grand_total not recalculated with labor: {u['grand_total']}"
        # verify persisted grand_total (not just computed in response)
        fresh = owner_client.get(f"{BASE_URL}/api/repairs/{rid}", timeout=30).json()
        assert fresh["grand_total"] == 80.0, (
            f"grand_total not persisted after labor update: {fresh['grand_total']}")

        # remove part -> restock
        rm = owner_client.delete(f"{BASE_URL}/api/repairs/{rid}/parts/{part['txn_id']}", timeout=30)
        assert rm.status_code == 200, rm.text
        assert rm.json()["parts_used"] == []
        assert _get_item(owner_client, test_item["id"])["quantity"] == start_qty
        assert owner_client.delete(f"{BASE_URL}/api/repairs/{rid}/parts/{part['txn_id']}",
                                   timeout=30).status_code == 404

        # re-add a part then invoice
        ap2 = owner_client.post(f"{BASE_URL}/api/repairs/{rid}/parts",
                                json={"item_id": test_item["id"], "quantity": 1}, timeout=30)
        assert ap2.status_code == 200
        inv = owner_client.post(f"{BASE_URL}/api/repairs/{rid}/invoice", timeout=30)
        assert inv.status_code == 200, inv.text
        i = inv.json()
        assert i["invoice_number"].startswith("INV-")
        assert len(i["lines"]) == 2, f"expected part + labor lines, got {i['lines']}"
        assert i["subtotal"] == 55.0  # 25 part + 30 labor
        assert i["repair_id"] == rid
        after = owner_client.get(f"{BASE_URL}/api/repairs/{rid}", timeout=30).json()
        assert after["status"] == "completed" and after["invoice_id"] == i["id"]
        assert after["completed_at"]

        # delete repair restocks
        qty_before_delete = _get_item(owner_client, test_item["id"])["quantity"]
        assert owner_client.delete(f"{BASE_URL}/api/repairs/{rid}", timeout=30).status_code == 200
        assert _get_item(owner_client, test_item["id"])["quantity"] == qty_before_delete + 1
        assert owner_client.get(f"{BASE_URL}/api/repairs/{rid}", timeout=30).status_code == 404
        owner_client.delete(f"{BASE_URL}/api/invoices/{i['id']}", timeout=30)

    def test_repair_unknown_404(self, owner_client):
        rid = str(uuid.uuid4())
        assert owner_client.get(f"{BASE_URL}/api/repairs/{rid}", timeout=30).status_code == 404
        assert owner_client.put(f"{BASE_URL}/api/repairs/{rid}", json={"notes": "x"}, timeout=30).status_code == 404
        assert owner_client.post(f"{BASE_URL}/api/repairs/{rid}/parts",
                                 json={"item_id": "x", "quantity": 1}, timeout=30).status_code == 404
        assert owner_client.post(f"{BASE_URL}/api/repairs/{rid}/invoice", timeout=30).status_code == 404

    def test_repair_part_unknown_item_404(self, owner_client):
        c = owner_client.post(f"{BASE_URL}/api/repairs", json={"customer_name": "TEST_X"}, timeout=30).json()
        r = owner_client.post(f"{BASE_URL}/api/repairs/{c['id']}/parts",
                              json={"item_id": str(uuid.uuid4()), "quantity": 1}, timeout=30)
        assert r.status_code == 404, r.text
        owner_client.delete(f"{BASE_URL}/api/repairs/{c['id']}", timeout=30)

    def test_repair_list_status_filter(self, owner_client):
        c = owner_client.post(f"{BASE_URL}/api/repairs", json={"customer_name": "TEST_Filter"}, timeout=30).json()
        r = owner_client.get(f"{BASE_URL}/api/repairs", params={"status": "open"}, timeout=30)
        assert r.status_code == 200
        assert all(x["status"] == "open" for x in r.json())
        assert any(x["id"] == c["id"] for x in r.json())
        owner_client.delete(f"{BASE_URL}/api/repairs/{c['id']}", timeout=30)

    def test_staff_can_manage_cards_but_not_delete(self, staff_client, owner_client):
        r = staff_client.post(f"{BASE_URL}/api/repairs", json={"customer_name": "TEST_StaffCard"}, timeout=30)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        assert staff_client.delete(f"{BASE_URL}/api/repairs/{rid}", timeout=30).status_code == 403
        owner_client.delete(f"{BASE_URL}/api/repairs/{rid}", timeout=30)
