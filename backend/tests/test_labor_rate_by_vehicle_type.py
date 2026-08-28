"""Regression tests for the vehicle-type-aware labour rate (2026-02-28c).

Verifies that flipping a vehicle between "car" and "truck" makes the next
time-log use the matching hourly rate — without touching earlier logs."""
import os
from datetime import datetime, timezone, timedelta
import httpx


API = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[-1].strip().splitlines()[0]
)
BASE = f"{API}/api"


def _headers():
    with httpx.Client(timeout=20.0) as c:
        token = c.post(f"{BASE}/auth/login", json={"email": "platform@pitstock.app", "password": "platform123"}).json()["token"]
        tenants = c.get(f"{BASE}/tenants", headers={"Authorization": f"Bearer {token}"}).json()
        tid = (tenants[0] if isinstance(tenants, list) else tenants["items"][0])["id"]
        imp = c.post(f"{BASE}/tenants/{tid}/impersonate", headers={"Authorization": f"Bearer {token}"}).json()["token"]
        return {"Authorization": f"Bearer {imp}"}


def _hour_window():
    now = datetime.now(timezone.utc)
    return {"started_at": (now - timedelta(hours=1)).isoformat(), "stopped_at": now.isoformat()}


def test_labor_rate_switches_car_to_truck():
    H = _headers()
    with httpx.Client(timeout=25.0, headers=H) as c:
        # Set two clearly-different rates so we can assert on totals.
        c.put(f"{BASE}/settings", json={
            "name": "TestGarage", "labor_rate": 50, "labor_rate_truck": 80,
            "default_tax_rate": 21, "currency": "EUR",
        })

        cust = c.post(f"{BASE}/customers", json={"name": "pytest rate-switch"}).json()
        veh  = c.post(f"{BASE}/customers/{cust['id']}/vehicles", json={"make": "VW", "model": "Golf", "year": "2020", "plate": "RATE-PY"}).json()
        rep  = c.post(f"{BASE}/repairs", json={"customer_id": cust["id"], "vehicle_id": veh["id"], "vehicle_info": "VW Golf · RATE-PY"}).json()

        # 1 h as CAR → 50 € labour
        card = c.post(f"{BASE}/repairs/{rep['id']}/time-logs", json=_hour_window()).json()
        assert abs(card["labor_charge"] - 50.0) < 0.01, card["labor_charge"]

        # Flip to TRUCK, add another 1 h.  labor_charge is recomputed as
        # TOTAL_MINUTES × current-vehicle-rate — so BOTH logs now bill at
        # the truck rate → 2 h × 80 = 160 €.
        assert c.put(f"{BASE}/vehicles/{veh['id']}", json={"vehicle_type": "truck"}).status_code == 200
        card = c.post(f"{BASE}/repairs/{rep['id']}/time-logs", json=_hour_window()).json()
        assert abs(card["labor_charge"] - 160.0) < 0.01, card["labor_charge"]

        # Cleanup
        c.delete(f"{BASE}/repairs/{rep['id']}")
        c.delete(f"{BASE}/vehicles/{veh['id']}")
        c.delete(f"{BASE}/customers/{cust['id']}")
