"""Cleanup of QA-created data after frontend tests."""
import requests
from dotenv import dotenv_values

BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
tok = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@garage.com", "password": "admin123"}).json()["token"]
h = {"Authorization": f"Bearer {tok}"}

for u in requests.get(f"{BASE}/api/users", headers=h).json():
    if u["email"] in ("qa_invitee@garage.com", "sneaky@garage.com", "test_qa_staff@garage.com"):
        print("deleting user", u["email"], requests.delete(f"{BASE}/api/users/{u['id']}", headers=h).status_code)

s = requests.get(f"{BASE}/api/settings", headers=h).json()
s["name"] = "Ahmed Auto Garage"
s["phone"] = ""
print("restore settings", requests.put(f"{BASE}/api/settings", headers=h, json=s).status_code)
print(requests.get(f"{BASE}/api/settings", headers=h).json())

for i in requests.get(f"{BASE}/api/inventory", headers=h).json():
    if i["name"].startswith("TEST_") or i["sku"].startswith("TEST-CSV"):
        print("deleting item", i["name"], requests.delete(f"{BASE}/api/inventory/{i['id']}", headers=h).status_code)
