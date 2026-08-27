"""Cleanup for iteration 19 — remove TEST_/scan-sourced inventory rows and close
scan sessions created during testing (tenant TestGarage via super_admin impersonation)."""
import os
import requests
from dotenv import dotenv_values

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE}/api"
TENANT = "d85ebd4a-40a2-407f-9473-d3d5044e1889"

tok = requests.post(f"{API}/auth/login", json={"email": "platform@pitstock.app", "password": "platform123"}, timeout=30).json()["token"]
h = {"Authorization": f"Bearer {tok}"}
tok = requests.post(f"{API}/tenants/{TENANT}/impersonate", headers=h, timeout=30).json()["token"]
h = {"Authorization": f"Bearer {tok}"}

inv = requests.get(f"{API}/inventory", headers=h, timeout=30).json()
print("inventory rows:", len(inv))
for it in inv:
    if (it.get("name") or "").startswith("TEST_") or it.get("source_scan_id"):
        r = requests.delete(f"{API}/inventory/{it['id']}", headers=h, timeout=30)
        print("deleted", it["name"], r.status_code)

sessions = requests.get(f"{API}/inventory/scan/sessions", headers=h, timeout=30).json()
print("open/waiting sessions:", len(sessions))
for s in sessions:
    r = requests.post(f"{API}/inventory/scan/sessions/{s['id']}/close", headers=h, timeout=30)
    print("closed", s["id"], s.get("invoice_number"), r.status_code)

print("waiting after cleanup:", len(requests.get(f"{API}/inventory/scan/waiting", headers=h, timeout=30).json()))
print("inventory after cleanup:", len(requests.get(f"{API}/inventory", headers=h, timeout=30).json()))
