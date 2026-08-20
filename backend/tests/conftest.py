import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

OWNER = {"email": "admin@garage.com", "password": "admin123"}
STAFF = {"email": "mike@garage.com", "password": "mike1234", "name": "Mike Mechanic", "role": "staff"}


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    return r


@pytest.fixture(scope="session")
def owner_token():
    r = _login(**OWNER)
    if r.status_code != 200:
        pytest.fail(f"Owner login failed {r.status_code}: {r.text[:300]}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def owner_client(owner_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {owner_token}"})
    return s


@pytest.fixture(scope="session")
def staff_token(owner_client):
    # ensure staff user exists
    r = _login(STAFF["email"], STAFF["password"])
    if r.status_code == 200:
        return r.json()["token"]
    cr = owner_client.post(f"{BASE_URL}/api/users", json=STAFF, timeout=30)
    if cr.status_code not in (200, 201, 400):
        pytest.fail(f"Could not create staff user: {cr.status_code} {cr.text[:300]}")
    r = _login(STAFF["email"], STAFF["password"])
    if r.status_code != 200:
        pytest.fail(f"Staff login failed {r.status_code}: {r.text[:300]}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def staff_client(staff_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {staff_token}"})
    return s
