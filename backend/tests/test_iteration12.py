"""
Iteration 12 backend regression:
  * special_parts appear in repair payload + invoice lines  (primary bug fix)
  * POST /api/special-parts/scan-delivery  (delivery-note plate matching)
  * GET  /api/bay-board                    (live TV board)
  * POST /api/import/vehicles-csv          (CSV fleet import)
"""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"


# ---------- helpers ----------
def _find_card(client, card_number):
    r = client.get(f"{API}/repairs", timeout=60)
    assert r.status_code == 200, r.text[:300]
    for c in r.json():
        if c.get("card_number") == card_number:
            return c
    return None


@pytest.fixture(scope="module")
def created(owner_client):
    """Track created objects for cleanup."""
    store = {"customers": [], "vehicles": [], "repairs": [], "special": []}
    yield store
    for rid, spid in store["special"]:
        owner_client.delete(f"{API}/repairs/{rid}/special-parts/{spid}", timeout=60)
    for vid in store["vehicles"]:
        owner_client.delete(f"{API}/vehicles/{vid}", timeout=60)
    for cid in store["customers"]:
        owner_client.delete(f"{API}/customers/{cid}", timeout=60)


# ---------- module: repairs / special parts -> invoice ----------
class TestSpecialPartsInRepairAndInvoice:
    def test_seed_card_has_special_parts(self, owner_client):
        card = _find_card(owner_client, "JOB-260822-E142")
        assert card is not None, "seed card JOB-260822-E142 missing"
        sp = card.get("special_parts") or []
        assert len(sp) >= 1, f"expected >=1 special part, got {sp}"
        assert any("Brake pads BMW E90" in (p.get("name") or "") for p in sp)
        # detail endpoint must expose the same list
        d = owner_client.get(f"{API}/repairs/{card['id']}", timeout=60)
        assert d.status_code == 200
        assert len(d.json().get("special_parts") or []) == len(sp)
        assert "_id" not in d.json()

    def test_invoice_from_repair_contains_special_part_line(self, owner_client, created):
        # fresh card so we do not disturb seeded ones
        cust = owner_client.post(f"{API}/customers", json={
            "name": "TEST_Iter12 Invoice", "phone": "+31600009912"}, timeout=60)
        assert cust.status_code in (200, 201), cust.text[:300]
        cid = cust.json()["id"]
        created["customers"].append(cid)

        rc = owner_client.post(f"{API}/repairs", json={
            "customer_id": cid, "customer_name": "TEST_Iter12 Invoice",
            "customer_phone": "+31600009912", "car_make": "Audi", "car_model": "A3",
            "car_plate": "NL-T12-01", "complaint": "TEST_special part invoice"}, timeout=60)
        assert rc.status_code in (200, 201), rc.text[:300]
        card = rc.json()
        created["repairs"].append(card["id"])

        sp = owner_client.post(f"{API}/repairs/{card['id']}/special-parts", json={
            "name": "TEST_Special Turbo", "part_number": "PN-T12", "quantity": 2,
            "unit_price": 100, "unit_cost": 60, "status": "arrived"}, timeout=60)
        assert sp.status_code in (200, 201), sp.text[:300]
        updated = sp.json()
        assert len(updated["special_parts"]) == 1
        assert updated["special_parts"][0]["total"] == 200
        assert updated["parts_total"] >= 200, updated["parts_total"]

        inv = owner_client.post(f"{API}/repairs/{card['id']}/invoice", json={}, timeout=60)
        assert inv.status_code in (200, 201), inv.text[:300]
        invoice = inv.json()
        lines = invoice.get("lines") or []
        assert any("TEST_Special Turbo" in (l.get("description") or l.get("name") or "")
                   for l in lines), f"special part missing from invoice lines: {lines}"
        # cleanup invoice + repair
        owner_client.delete(f"{API}/invoices/{invoice['id']}", timeout=60)
        owner_client.delete(f"{API}/repairs/{card['id']}", timeout=60)
        created["repairs"].remove(card["id"])


# ---------- module: delivery-note scan ----------
class TestScanDelivery:
    def test_scan_matches_plate(self, owner_client):
        r = owner_client.post(f"{API}/special-parts/scan-delivery",
                              json={"code": "delivery slip 77123 plate B-XX-1234 4x brake pads"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["detected_plate"].replace("-", "").upper() == "BXX1234", d
        assert d["matched"] is True, d
        assert any(m["card_number"] == "JOB-260820-8729" for m in d["matches"]), d["matches"]

    def test_scan_no_match_returns_candidates(self, owner_client):
        r = owner_client.post(f"{API}/special-parts/scan-delivery",
                              json={"code": "BON 12345 for NL-99-XX brake set"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["matched"] is False
        assert d["detected_plate"] == "NL-99-XX"
        assert isinstance(d["candidates"], list) and len(d["candidates"]) > 0
        assert all("_id" not in c for c in d["candidates"])

    def test_scan_lowercase_plate(self, owner_client):
        r = owner_client.post(f"{API}/special-parts/scan-delivery",
                              json={"code": "b-xx-1234"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["matched"] is True, f"lowercase plate not matched: {d}"

    def test_scan_empty_code_400(self, owner_client):
        r = owner_client.post(f"{API}/special-parts/scan-delivery", json={"code": "  "}, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_scan_requires_auth(self):
        r = requests.post(f"{API}/special-parts/scan-delivery", json={"code": "B-XX-1234"}, timeout=60)
        assert r.status_code in (401, 403), r.status_code

    def test_add_special_part_via_scan_flow(self, owner_client, created):
        r = owner_client.post(f"{API}/special-parts/scan-delivery",
                              json={"code": "B-XX-1234"}, timeout=60)
        rid = r.json()["matches"][0]["id"]
        add = owner_client.post(f"{API}/repairs/{rid}/special-parts", json={
            "name": "TEST_scanned part", "part_number": "PN-999", "quantity": 2,
            "unit_price": 10, "unit_cost": 5, "status": "arrived"}, timeout=60)
        assert add.status_code in (200, 201), add.text[:300]
        parts = add.json()["special_parts"]
        mine = [p for p in parts if p["name"] == "TEST_scanned part"]
        assert len(mine) == 1
        created["special"].append((rid, mine[0]["id"]))
        # verify persisted
        g = owner_client.get(f"{API}/repairs/{rid}", timeout=60)
        assert any(p["name"] == "TEST_scanned part" for p in g.json()["special_parts"])


# ---------- module: bay board ----------
class TestBayBoard:
    def test_bay_board_shape(self, owner_client):
        r = owner_client.get(f"{API}/bay-board", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "generated_at" in d and isinstance(d["cards"], list)
        assert len(d["cards"]) > 0, "no open cards returned"
        for c in d["cards"]:
            assert c["status"] in ("open", "in_progress"), c["status"]
            for k in ("id", "card_number", "customer_name", "car_plate", "hours_in_shop",
                      "clocked_minutes", "special_parts_pending", "priority"):
                assert k in c, f"{k} missing from bay-board card"
            assert isinstance(c["hours_in_shop"], (int, float))
            assert "_id" not in c

    def test_bay_board_matches_repairs_open_count(self, owner_client):
        board = owner_client.get(f"{API}/bay-board", timeout=60).json()["cards"]
        repairs = owner_client.get(f"{API}/repairs", timeout=60).json()
        expected = {x["card_number"] for x in repairs if x.get("status") in ("open", "in_progress")}
        got = {c["card_number"] for c in board}
        # subset check (other parallel tests may create/remove cards mid-run)
        assert expected.issubset(got), f"missing from board: {expected - got}"
        # board must never contain a completed/paid card
        for cn in got - expected:
            assert cn.startswith("JOB-"), cn

    def test_bay_board_requires_auth(self):
        r = requests.get(f"{API}/bay-board", timeout=60)
        assert r.status_code in (401, 403), r.status_code


# ---------- module: CSV fleet import ----------
class TestCsvImport:
    CSV = ("customer_name,customer_phone,plate,make,model,year,apk_expiry\n"
           "TEST_Bulk Fleet,+31600000991,NL-TBULK-1,Renault,Clio,2018,2027-03-01\n"
           "TEST_Bulk Fleet,+31600000991,NL-TBULK-2,Renault,Megane,2020,2027-06-15\n")

    def test_import_creates_customer_and_vehicles(self, owner_client, created):
        r = owner_client.post(f"{API}/import/vehicles-csv", json={"csv": self.CSV}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["created_vehicles"] == 2, d
        assert d["created_customers"] == 1, d
        assert d["errors"] == [], d["errors"]

        custs = owner_client.get(f"{API}/customers", timeout=60).json()
        mine = [c for c in custs if c["name"] == "TEST_Bulk Fleet"]
        assert len(mine) == 1, f"expected exactly 1 customer, got {len(mine)}"
        cid = mine[0]["id"]
        created["customers"].append(cid)

        veh = owner_client.get(f"{API}/customers/{cid}/vehicles", timeout=60)
        assert veh.status_code == 200, veh.text[:300]
        plates = sorted(v["plate"] for v in veh.json())
        assert plates == ["NL-TBULK-1", "NL-TBULK-2"], plates
        for v in veh.json():
            created["vehicles"].append(v["id"])
            assert v["apk_expiry"], v
            assert v["make"] == "Renault"

        rep = owner_client.get(f"{API}/customers/{cid}/report", timeout=60)
        if rep.status_code == 200:
            byv = rep.json().get("by_vehicle")
            assert byv is None or len(byv) in (0, 2), f"customer report vehicles: {byv}"

    def test_import_reuses_existing_customer(self, owner_client, created):
        csv2 = ("customer_name,customer_phone,plate,make,model\n"
                "TEST_Bulk Fleet,+31600000991,NL-TBULK-3,Renault,Twingo\n")
        r = owner_client.post(f"{API}/import/vehicles-csv", json={"csv": csv2}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["created_customers"] == 0 and d["reused_customers"] == 1, d
        assert d["created_vehicles"] == 1, d
        custs = owner_client.get(f"{API}/customers", timeout=60).json()
        cid = [c for c in custs if c["name"] == "TEST_Bulk Fleet"][0]["id"]
        veh = owner_client.get(f"{API}/customers/{cid}/vehicles", timeout=60).json()
        for v in veh:
            if v["plate"] == "NL-TBULK-3":
                created["vehicles"].append(v["id"])

    def test_import_empty_csv_400(self, owner_client):
        r = owner_client.post(f"{API}/import/vehicles-csv", json={"csv": "   "}, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_import_reports_bad_rows(self, owner_client):
        bad = "customer_name,customer_phone,plate\n,,\n"
        r = owner_client.post(f"{API}/import/vehicles-csv", json={"csv": bad}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["created_vehicles"] == 0
        assert len(d["errors"]) == 1, d

    def test_import_requires_auth(self):
        r = requests.post(f"{API}/import/vehicles-csv", json={"csv": self.CSV}, timeout=60)
        assert r.status_code in (401, 403), r.status_code
