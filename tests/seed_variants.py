"""Seed a master inventory item + 2 variants in TestGarage for frontend variant-edit testing."""
import json
import requests
from dotenv import dotenv_values

B = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
TENANT = "d85ebd4a-40a2-407f-9473-d3d5044e1889"

r = requests.post(f"{B}/api/auth/login", json={"email": "platform@pitstock.app", "password": "platform123"})
r.raise_for_status()
sa = r.json()["token"]
imp = requests.post(f"{B}/api/tenants/{TENANT}/impersonate", headers={"Authorization": f"Bearer {sa}"})
imp.raise_for_status()
tok = imp.json()["token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

inv = requests.get(f"{B}/api/inventory", headers=H)
print("GET /inventory", inv.status_code, len(inv.json()) if inv.ok else inv.text[:300])

master = None
for it in (inv.json() if inv.ok else []):
    if it.get("name") == "TEST_Motorolie 5W30" and not it.get("parent_id"):
        master = it
        break

if not master:
    c = requests.post(f"{B}/api/inventory", headers=H, json={
        "name": "TEST_Motorolie 5W30", "sku": "TEST-OIL-MASTER", "barcode": "TESTOIL0001",
        "category": "Oil", "cost_price": 10, "selling_price": 20, "quantity": 0,
        "reorder_point": 5, "unit": "pcs", "is_master": True,
    })
    print("POST master", c.status_code, c.text[:400])
    c.raise_for_status()
    master = c.json()
print("master id", master["id"])

vs = requests.get(f"{B}/api/inventory/{master['id']}/variants", headers=H)
print("variants existing", vs.status_code, [v.get("name") for v in vs.json()] if vs.ok else vs.text[:300])
existing = {v.get("name") for v in (vs.json() if vs.ok else [])}

for nm, price, bc in [("Olie 1L", 12.5, "TESTOIL1L"), ("Olie 4L", 39.9, "TESTOIL4L")]:
    if nm in existing:
        continue
    v = requests.post(f"{B}/api/inventory/{master['id']}/variants", headers=H, json={
        "name": nm, "name_ar": "زيت", "barcode": bc, "unit": "L",
        "cost_price": price / 2, "selling_price": price, "quantity": 10, "reorder_point": 3,
    })
    print("POST variant", nm, v.status_code, v.text[:300])

vs = requests.get(f"{B}/api/inventory/{master['id']}/variants", headers=H)
print(json.dumps([{k: v.get(k) for k in ("id", "sku", "name", "selling_price", "quantity")} for v in vs.json()], indent=1))
