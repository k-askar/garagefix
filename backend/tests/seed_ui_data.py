"""Seeds/cleans UI test data for frontend playwright run."""
import requests
from dotenv import dotenv_values

BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
tok = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@garage.com", "password": "admin123"}).json()["token"]
h = {"Authorization": f"Bearer {tok}"}

items = requests.get(f"{BASE}/api/inventory", headers=h).json()
for i in items:
    if i["name"].startswith("TEST_") or i["sku"].startswith("TEST-CSV"):
        requests.delete(f"{BASE}/api/inventory/{i['id']}", headers=h)
        print("deleted leftover", i["name"])

items = requests.get(f"{BASE}/api/inventory", headers=h).json()
golf = [i for i in items if "golf" in (i.get("compatible_vehicles") or "").lower()]
if not golf:
    r = requests.post(f"{BASE}/api/inventory", headers=h, json={
        "name": "Golf Timing Belt", "sku": "UI-GOLF-1", "category": "Engine",
        "cost_price": 30, "selling_price": 65, "quantity": 12,
        "compatible_vehicles": "VW Golf VII, VW Golf VI"})
    print("seeded golf item", r.status_code, r.text[:200])
else:
    print("golf item exists:", golf[0]["name"])

# ensure an OUT transaction exists for receipt test
txns = requests.get(f"{BASE}/api/transactions", headers=h).json()
if not any(t["type"] == "OUT" for t in txns):
    items = requests.get(f"{BASE}/api/inventory", headers=h).json()
    it = next(i for i in items if i["quantity"] > 2)
    r = requests.post(f"{BASE}/api/transactions", headers=h, json={
        "type": "OUT", "item_id": it["id"], "quantity": 1, "unit_price": it["selling_price"], "note": "UI receipt test"})
    print("seeded OUT txn", r.status_code)
else:
    print("OUT txn exists")

# ensure staff user
u = requests.get(f"{BASE}/api/users", headers=h).json()
if not any(x["email"] == "mike@garage.com" for x in u):
    r = requests.post(f"{BASE}/api/users", headers=h, json={
        "email": "mike@garage.com", "password": "mike1234", "name": "Mike Mechanic", "role": "staff"})
    print("created staff", r.status_code)
else:
    print("staff exists")
