"""Iteration 4 regression tests: PUT /repairs totals persistence + profit report date validation."""
import uuid
import pytest
from conftest import BASE_URL


@pytest.fixture(scope="module")
def item(owner_client):
    sku = f"TEST_SKU_{uuid.uuid4().hex[:6].upper()}"
    r = owner_client.post(f"{BASE_URL}/api/inventory", json={
        "sku": sku, "barcode": f"TESTBC{uuid.uuid4().hex[:8].upper()}",
        "name": "TEST_Filter", "category": "TEST_Filters", "quantity": 10,
        "reorder_point": 2, "cost_price": 7.0, "selling_price": 21.0,
        "unit": "pcs", "location": "T4"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    it = r.json()
    yield it
    owner_client.delete(f"{BASE_URL}/api/inventory/{it['id']}", timeout=30)


# --- Fix 1: PUT /api/repairs/{id} persists parts_total/grand_total ---
class TestRepairTotalsPersistence:
    def test_labor_change_persists_grand_total_everywhere(self, owner_client, item):
        card = owner_client.post(f"{BASE_URL}/api/repairs", json={
            "customer_name": "TEST_Totals", "car_plate": "TEST-T4",
            "complaint": "TEST_totals check"}, timeout=30).json()
        rid = card["id"]
        try:
            ap = owner_client.post(f"{BASE_URL}/api/repairs/{rid}/parts",
                                   json={"item_id": item["id"], "quantity": 1}, timeout=30)
            assert ap.status_code == 200, ap.text
            assert ap.json()["parts_total"] == 21.0

            up = owner_client.put(f"{BASE_URL}/api/repairs/{rid}",
                                  json={"labor_charge": 40.0}, timeout=30)
            assert up.status_code == 200, up.text
            assert up.json()["parts_total"] == 21.0
            assert up.json()["grand_total"] == 61.0

            # GET single
            one = owner_client.get(f"{BASE_URL}/api/repairs/{rid}", timeout=30).json()
            assert one["grand_total"] == 61.0, one["grand_total"]
            assert one["parts_total"] == 21.0

            # GET list
            lst = owner_client.get(f"{BASE_URL}/api/repairs", timeout=30).json()
            row = next(x for x in lst if x["id"] == rid)
            assert row["grand_total"] == 61.0, row["grand_total"]

            # changing labor again recomputes
            up2 = owner_client.put(f"{BASE_URL}/api/repairs/{rid}",
                                   json={"labor_charge": 10.0}, timeout=30)
            assert up2.status_code == 200
            assert owner_client.get(f"{BASE_URL}/api/repairs/{rid}",
                                    timeout=30).json()["grand_total"] == 31.0

            # unrelated update keeps totals intact
            owner_client.put(f"{BASE_URL}/api/repairs/{rid}",
                             json={"notes": "TEST_note"}, timeout=30)
            fresh = owner_client.get(f"{BASE_URL}/api/repairs/{rid}", timeout=30).json()
            assert fresh["grand_total"] == 31.0 and fresh["labor_charge"] == 10.0
        finally:
            owner_client.delete(f"{BASE_URL}/api/repairs/{rid}", timeout=30)


# --- Fix 2: profit report invalid dates -> 400 with clear detail ---
class TestProfitDateValidation:
    @pytest.mark.parametrize("params", [
        {"start": "not-a-date", "end": "2026-01-01"},
        {"start": "2026-01-01", "end": "13/45/2026"},
        {"start": "2026-02-30"},
    ])
    def test_bad_dates_return_400(self, owner_client, params):
        r = owner_client.get(f"{BASE_URL}/api/reports/profit", params=params, timeout=30)
        assert r.status_code == 400, f"{params} -> {r.status_code}: {r.text[:200]}"
        assert r.json()["detail"] == "Invalid date. Use YYYY-MM-DD."

    def test_valid_dates_still_200(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/reports/profit",
                             params={"start": "2026-01-01", "end": "2026-12-31"}, timeout=30)
        assert r.status_code == 200, r.text
        assert "total_profit" in r.json()
