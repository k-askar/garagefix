"""Regression tests for the customer/vehicle delete guard-rails added in
2026-02-28b.  Uses `httpx.Client` (sync) so no async plugin is required."""
import os
import httpx


API = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[-1].strip().splitlines()[0]
)
BASE = f"{API}/api"


def _headers():
    with httpx.Client(timeout=20.0) as c:
        r = c.post(f"{BASE}/auth/login", json={"email": "platform@pitstock.app", "password": "platform123"})
        token = r.json()["token"]
        tenants = c.get(f"{BASE}/tenants", headers={"Authorization": f"Bearer {token}"}).json()
        tid = (tenants[0] if isinstance(tenants, list) else tenants["items"][0])["id"]
        imp = c.post(f"{BASE}/tenants/{tid}/impersonate", headers={"Authorization": f"Bearer {token}"}).json()["token"]
        return {"Authorization": f"Bearer {imp}"}


def test_delete_customer_and_vehicle_no_history_ok():
    H = _headers()
    with httpx.Client(timeout=20.0, headers=H) as c:
        cust = c.post(f"{BASE}/customers", json={"name": "pytest guard clean"}).json()
        veh  = c.post(f"{BASE}/customers/{cust['id']}/vehicles", json={"make": "VW", "model": "Golf", "year": "2020", "plate": "PY-CLN"}).json()
        assert c.delete(f"{BASE}/vehicles/{veh['id']}").status_code == 200
        assert c.delete(f"{BASE}/customers/{cust['id']}").status_code == 200


def test_delete_blocked_when_repair_exists():
    H = _headers()
    with httpx.Client(timeout=20.0, headers=H) as c:
        cust = c.post(f"{BASE}/customers", json={"name": "pytest guard blocked"}).json()
        veh  = c.post(f"{BASE}/customers/{cust['id']}/vehicles", json={"make": "BMW", "model": "3", "year": "2019", "plate": "PY-BLK"}).json()
        rep  = c.post(f"{BASE}/repairs", json={"customer_id": cust["id"], "vehicle_id": veh["id"], "vehicle_info": "BMW 3 · PY-BLK"}).json()
        # Both endpoints must refuse the delete with 409 …
        r_veh = c.delete(f"{BASE}/vehicles/{veh['id']}")
        r_cst = c.delete(f"{BASE}/customers/{cust['id']}")
        assert r_veh.status_code == 409, r_veh.text
        assert r_cst.status_code == 409, r_cst.text
        assert "werkbon" in r_veh.json()["detail"].lower()
        assert "werkbon" in r_cst.json()["detail"].lower()
        # … and the customer message must count the shared repair ONCE.
        assert "1 werkbon" in r_cst.json()["detail"]
        # Cleanup.
        c.delete(f"{BASE}/repairs/{rep['id']}")
        c.delete(f"{BASE}/vehicles/{veh['id']}")
        c.delete(f"{BASE}/customers/{cust['id']}")
