"""Cleanup iteration-10 test artifacts: TEST_seed invoices, TEST_ cash movements, TEST_ photos, TEST_ repair cards."""
import requests
from dotenv import dotenv_values

BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
h = {"Authorization": "Bearer " + requests.post(
    f"{BASE}/api/auth/login", json={"email": "admin@garage.com", "password": "admin123"}).json()["token"]}

for inv in requests.get(f"{BASE}/api/invoices", headers=h).json():
    if (inv.get("note") or "").startswith("TEST_"):
        print("del invoice", inv["invoice_number"], requests.delete(f"{BASE}/api/invoices/{inv['id']}", headers=h).status_code)

for mv in requests.get(f"{BASE}/api/cash-movements", headers=h).json():
    if (mv.get("note") or "").startswith("TEST_"):
        print("del movement", mv["id"], requests.delete(f"{BASE}/api/cash-movements/{mv['id']}", headers=h).status_code)

for c in requests.get(f"{BASE}/api/repairs", headers=h).json():
    if (c.get("customer_name") or "").startswith("TEST_"):
        print("del card", c["card_number"], requests.delete(f"{BASE}/api/repairs/{c['id']}", headers=h).status_code)
        continue
    for p in (c.get("photos") or []):
        if (p.get("filename") or "").startswith("TEST_"):
            print("del photo", p["filename"],
                  requests.delete(f"{BASE}/api/repairs/{c['id']}/photos/{p['id']}", headers=h).status_code)
print("cleanup done")
