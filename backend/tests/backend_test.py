"""Backend tests for PitStock iteration 2: role guards, settings, users, CSV import, vehicle filter."""
import io
import pytest
import requests

from conftest import BASE_URL, STAFF


# --- Health / auth ---
class TestHealth:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=30)
        assert r.status_code == 200
        assert "message" in r.json()

    def test_owner_login_role(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@garage.com", "password": "admin123"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["role"] == "owner"
        assert isinstance(d["token"], str) and len(d["token"]) > 10

    def test_bad_password(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": "admin@garage.com", "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_unauthenticated_inventory(self):
        r = requests.get(f"{BASE_URL}/api/inventory", timeout=30)
        assert r.status_code == 401


# --- Owner-only guards ---
class TestRoleGuards:
    @pytest.fixture(scope="class")
    def item_id(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/inventory", json={
            "name": "TEST_GuardPart", "category": "Brakes", "cost_price": 10, "selling_price": 20,
            "quantity": 25, "compatible_vehicles": "VW Golf V, Audi A3"}, timeout=30)
        assert r.status_code == 200, r.text
        iid = r.json()["id"]
        yield iid
        owner_client.delete(f"{BASE_URL}/api/inventory/{iid}", timeout=30)

    def test_staff_cannot_update_inventory(self, staff_client, item_id):
        r = staff_client.put(f"{BASE_URL}/api/inventory/{item_id}", json={"selling_price": 999}, timeout=30)
        assert r.status_code == 403, r.text

    def test_staff_cannot_delete_inventory(self, staff_client, item_id):
        r = staff_client.delete(f"{BASE_URL}/api/inventory/{item_id}", timeout=30)
        assert r.status_code == 403, r.text

    def test_staff_cannot_list_users(self, staff_client):
        assert staff_client.get(f"{BASE_URL}/api/users", timeout=30).status_code == 403

    def test_staff_cannot_create_users(self, staff_client):
        r = staff_client.post(f"{BASE_URL}/api/users", json={
            "email": "TEST_evil@garage.com", "password": "abc123", "name": "Evil", "role": "owner"}, timeout=30)
        assert r.status_code == 403

    def test_staff_cannot_update_settings(self, staff_client):
        r = staff_client.put(f"{BASE_URL}/api/settings", json={"name": "Hacked"}, timeout=30)
        assert r.status_code == 403

    def test_staff_cannot_import_csv(self, staff_client):
        r = staff_client.post(f"{BASE_URL}/api/inventory/import",
                              files={"file": ("a.csv", io.BytesIO(b"name\nX\n"), "text/csv")}, timeout=30)
        assert r.status_code == 403

    def test_staff_can_read_inventory(self, staff_client):
        r = staff_client.get(f"{BASE_URL}/api/inventory", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_staff_can_read_settings(self, staff_client):
        r = staff_client.get(f"{BASE_URL}/api/settings", timeout=30)
        assert r.status_code == 200
        assert "name" in r.json()

    def test_staff_can_create_inventory(self, staff_client, owner_client):
        r = staff_client.post(f"{BASE_URL}/api/inventory", json={"name": "TEST_StaffPart", "quantity": 3}, timeout=30)
        assert r.status_code == 200, r.text
        owner_client.delete(f"{BASE_URL}/api/inventory/{r.json()['id']}", timeout=30)

    def test_staff_can_create_transaction(self, staff_client, item_id, owner_client):
        r = staff_client.post(f"{BASE_URL}/api/transactions", json={
            "type": "OUT", "item_id": item_id, "quantity": 2, "unit_price": 20, "note": "TEST_staff txn"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "OUT" and d["quantity"] == 2 and d["total"] == 40.0
        assert d["created_by"] == STAFF["email"]
        # stock decremented
        item = owner_client.get(f"{BASE_URL}/api/inventory/{item_id}", timeout=30).json()
        assert item["quantity"] == 23


# --- Settings ---
class TestSettings:
    def test_get_and_update_settings(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/settings", timeout=30)
        assert r.status_code == 200
        original = r.json()

        payload = {"name": "TEST_PitStock QA", "address": "1 QA Street", "phone": "+353 1 000",
                   "email": "qa@garage.com", "tax_id": "IE1234", "footer_note": "TEST footer"}
        u = owner_client.put(f"{BASE_URL}/api/settings", json=payload, timeout=30)
        assert u.status_code == 200, u.text
        assert u.json()["name"] == payload["name"]

        g = owner_client.get(f"{BASE_URL}/api/settings", timeout=30).json()
        for k, v in payload.items():
            assert g[k] == v, f"{k} not persisted"
        assert "_id" not in g

        # restore
        restore = {k: original.get(k, "") for k in payload}
        restore["name"] = original.get("name") or "PitStock Garage"
        owner_client.put(f"{BASE_URL}/api/settings", json=restore, timeout=30)


# --- Users ---
class TestUsers:
    def test_list_users_no_password_hash(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/users", timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 1
        for u in rows:
            assert "password_hash" not in u and "_id" not in u

    def test_create_login_delete_user(self, owner_client):
        payload = {"email": "test_qa_staff@garage.com", "password": "qa123456", "name": "TEST_QA Staff", "role": "staff"}
        owner_client_users = owner_client.get(f"{BASE_URL}/api/users", timeout=30).json()
        for u in owner_client_users:
            if u["email"] == payload["email"]:
                owner_client.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=30)

        c = owner_client.post(f"{BASE_URL}/api/users", json=payload, timeout=30)
        assert c.status_code == 200, c.text
        uid = c.json()["id"]
        assert c.json()["role"] == "staff"
        assert "password_hash" not in c.json()

        # duplicate
        d = owner_client.post(f"{BASE_URL}/api/users", json=payload, timeout=30)
        assert d.status_code == 400

        # new user can log in
        li = requests.post(f"{BASE_URL}/api/auth/login", json={"email": payload["email"], "password": payload["password"]}, timeout=30)
        assert li.status_code == 200
        assert li.json()["user"]["role"] == "staff"

        # appears in list
        rows = owner_client.get(f"{BASE_URL}/api/users", timeout=30).json()
        assert any(u["id"] == uid for u in rows)

        # delete
        de = owner_client.delete(f"{BASE_URL}/api/users/{uid}", timeout=30)
        assert de.status_code == 200
        rows = owner_client.get(f"{BASE_URL}/api/users", timeout=30).json()
        assert not any(u["id"] == uid for u in rows)

    def test_self_deletion_blocked(self, owner_client):
        me = owner_client.get(f"{BASE_URL}/api/auth/me", timeout=30).json()
        r = owner_client.delete(f"{BASE_URL}/api/users/{me['id']}", timeout=30)
        assert r.status_code == 400, r.text

    def test_short_password_rejected(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/users", json={
            "email": "test_short@garage.com", "password": "123", "name": "Short", "role": "staff"}, timeout=30)
        assert r.status_code == 422


# --- CSV import ---
class TestCsvImport:
    created_skus = ["TEST-CSV-1", "TEST-CSV-2", "TEST-CSV-3", "TEST-CSV-BAD"]

    @pytest.fixture(scope="class", autouse=True)
    def cleanup(self, owner_client):
        yield
        rows = owner_client.get(f"{BASE_URL}/api/inventory", timeout=30).json()
        for it in rows:
            if it["sku"] in self.created_skus:
                owner_client.delete(f"{BASE_URL}/api/inventory/{it['id']}", timeout=30)

    def test_import_creates_and_reports_errors(self, owner_client):
        csv_content = (
            "sku,name,category,cost_price,selling_price,quantity,reorder_point,unit,location,compatible_vehicles\n"
            "TEST-CSV-1,TEST_Brake Pad Set,Brakes,20.5,45.99,10,4,pcs,A1,VW Golf VII;Audi A3\n"
            "TEST-CSV-2,TEST_Oil Filter,Filters,4.2,9.9,30,10,pcs,B2,BMW 3 Series\n"
            "TEST-CSV-3,,Filters,1,2,3,4,pcs,C3,Ford Focus\n"
        )
        r = owner_client.post(f"{BASE_URL}/api/inventory/import",
                              files={"file": ("import.csv", io.BytesIO(csv_content.encode()), "text/csv")}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 2, d
        assert d["updated"] == 0, d
        assert len(d["errors"]) == 1 and "missing name" in d["errors"][0].lower()

        rows = owner_client.get(f"{BASE_URL}/api/inventory", timeout=30).json()
        item = next((i for i in rows if i["sku"] == "TEST-CSV-1"), None)
        assert item is not None
        assert item["name"] == "TEST_Brake Pad Set"
        assert item["selling_price"] == 45.99
        assert item["quantity"] == 10
        assert item["barcode"]

    def test_import_updates_existing_sku(self, owner_client):
        csv_content = (
            "sku,name,category,cost_price,selling_price,quantity,compatible_vehicles\n"
            "TEST-CSV-1,TEST_Brake Pad Set,Brakes,22,49.5,15,VW Golf VII\n"
        )
        r = owner_client.post(f"{BASE_URL}/api/inventory/import",
                              files={"file": ("import.csv", io.BytesIO(csv_content.encode()), "text/csv")}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["updated"] == 1 and d["created"] == 0, d

        rows = owner_client.get(f"{BASE_URL}/api/inventory", timeout=30).json()
        item = next(i for i in rows if i["sku"] == "TEST-CSV-1")
        assert item["selling_price"] == 49.5
        assert item["quantity"] == 15

    def test_import_rejects_non_csv(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/inventory/import",
                              files={"file": ("bad.txt", io.BytesIO(b"name\nX"), "text/plain")}, timeout=30)
        assert r.status_code == 400

    def test_import_bad_numeric_row_goes_to_errors(self, owner_client):
        csv_content = "sku,name,cost_price\nTEST-CSV-BAD,TEST_BadNum,notanumber\n"
        r = owner_client.post(f"{BASE_URL}/api/inventory/import",
                              files={"file": ("i.csv", io.BytesIO(csv_content.encode()), "text/csv")}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 0 and len(d["errors"]) == 1, d


# --- Vehicle filter ---
class TestVehicleFilter:
    @pytest.fixture(scope="class")
    def seeded(self, owner_client):
        ids = []
        for name, veh in [("TEST_Golf Wiper", "VW Golf VI, VW Polo"), ("TEST_BMW Sensor", "BMW 320d")]:
            r = owner_client.post(f"{BASE_URL}/api/inventory",
                                  json={"name": name, "quantity": 5, "compatible_vehicles": veh}, timeout=30)
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        yield ids
        for i in ids:
            owner_client.delete(f"{BASE_URL}/api/inventory/{i}", timeout=30)

    def test_filter_matches_case_insensitive(self, owner_client, seeded):
        r = owner_client.get(f"{BASE_URL}/api/inventory", params={"vehicle": "golf"}, timeout=30)
        assert r.status_code == 200
        rows = r.json()
        names = [i["name"] for i in rows]
        assert "TEST_Golf Wiper" in names
        assert all("golf" in (i.get("compatible_vehicles") or "").lower() for i in rows)
        assert "TEST_BMW Sensor" not in names

    def test_filter_no_match_returns_empty(self, owner_client, seeded):
        r = owner_client.get(f"{BASE_URL}/api/inventory", params={"vehicle": "ZZZNoSuchVehicle"}, timeout=30)
        assert r.status_code == 200
        assert r.json() == []

    def test_no_filter_returns_all(self, owner_client, seeded):
        r = owner_client.get(f"{BASE_URL}/api/inventory", timeout=30)
        assert r.status_code == 200
        names = [i["name"] for i in r.json()]
        assert "TEST_Golf Wiper" in names and "TEST_BMW Sensor" in names
