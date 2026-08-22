"""Cleanup of iteration-12 UI test artifacts (E2E Bulk* customers/vehicles + scanned special part)."""
import requests
from dotenv import dotenv_values

B = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{B}/api"
s = requests.Session()
tok = s.post(f"{API}/auth/login", json={"email": "admin@garage.com", "password": "admin123"}, timeout=30).json()["token"]
s.headers["Authorization"] = f"Bearer {tok}"

# 1. remove UI-added special part from JOB-260820-8729
for c in s.get(f"{API}/repairs", timeout=60).json():
    for sp in (c.get("special_parts") or []):
        if str(sp.get("name", "")).startswith("TEST_scanned part"):
            r = s.delete(f"{API}/repairs/{c['id']}/special-parts/{sp['id']}", timeout=60)
            print("deleted special part", sp["name"], r.status_code)

# 2. remove imported customers + their vehicles
for cust in s.get(f"{API}/customers", timeout=60).json():
    if cust["name"].startswith("E2E Bulk") or cust["name"].startswith("TEST_"):
        for v in s.get(f"{API}/customers/{cust['id']}/vehicles", timeout=60).json():
            print("del vehicle", v.get("plate"), s.delete(f"{API}/vehicles/{v['id']}", timeout=60).status_code)
        print("del customer", cust["name"], s.delete(f"{API}/customers/{cust['id']}", timeout=60).status_code)
print("done")
