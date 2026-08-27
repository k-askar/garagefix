"""Verify settings persistence of the new PDF-look fields, then clean up TEST_ inventory rows."""
import requests
from dotenv import dotenv_values

B = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
TENANT = "d85ebd4a-40a2-407f-9473-d3d5044e1889"
sa = requests.post(f"{B}/api/auth/login", json={"email": "platform@pitstock.app", "password": "platform123"}).json()["token"]
tok = requests.post(f"{B}/api/tenants/{TENANT}/impersonate", headers={"Authorization": f"Bearer {sa}"}).json()["token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

cur = requests.get(f"{B}/api/settings", headers=H)
print("GET /settings", cur.status_code)
base = cur.json()
print({k: base.get(k) for k in ("invoice_body_font", "invoice_number_scale", "invoice_qr_size", "invoice_qr_position")})

payload = dict(base)
payload.pop("_id", None)
payload.update({"invoice_body_font": "jetbrains", "invoice_number_scale": "lg",
                "invoice_qr_size": "lg", "invoice_qr_position": "bottom"})
p = requests.put(f"{B}/api/settings", headers=H, json=payload)
print("PUT /settings", p.status_code, p.text[:200])
again = requests.get(f"{B}/api/settings", headers=H).json()
print("persisted:", {k: again.get(k) for k in ("invoice_body_font", "invoice_number_scale", "invoice_qr_size", "invoice_qr_position")})

# restore original values
requests.put(f"{B}/api/settings", headers=H, json={**{k: v for k, v in base.items() if k != "_id"}})
print("restored:", {k: requests.get(f'{B}/api/settings', headers=H).json().get(k) for k in ("invoice_body_font", "invoice_qr_position")})

# cleanup TEST_ items + their variants
inv = requests.get(f"{B}/api/inventory", headers=H).json()
masters = [i for i in inv if str(i.get("name", "")).startswith("TEST_")]
for m in masters:
    vs = requests.get(f"{B}/api/inventory/{m['id']}/variants", headers=H)
    for v in (vs.json() if vs.ok else []):
        print("del variant", v["name"], requests.delete(f"{B}/api/inventory/{v['id']}", headers=H).status_code)
    print("del master", m["name"], requests.delete(f"{B}/api/inventory/{m['id']}", headers=H).status_code)
