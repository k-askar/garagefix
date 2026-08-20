"""Seed a few TEST_ invoices (from unbilled OUT transactions) for the ZIP/Excel UI flow."""
import requests
from dotenv import dotenv_values

BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
h = {"Authorization": "Bearer " + requests.post(
    f"{BASE}/api/auth/login", json={"email": "admin@garage.com", "password": "admin123"}).json()["token"]}

txns = requests.get(f"{BASE}/api/transactions", headers=h).json()
if isinstance(txns, dict):
    txns = txns.get("items", [])
free = [t for t in txns if t.get("type") == "OUT" and not t.get("invoice_id")]
print("free OUT txns:", len(free))
made = []
for t in free[:3]:
    r = requests.post(f"{BASE}/api/invoices/from-transactions", headers=h,
                      json={"transaction_ids": [t["id"]], "tax_rate": 21, "note": "TEST_seed"})
    print(r.status_code, r.text[:120])
    if r.status_code == 200:
        made.append(r.json()["invoice_number"])
print("created:", made)
print("total invoices now:", len(requests.get(f"{BASE}/api/invoices", headers=h).json()))
