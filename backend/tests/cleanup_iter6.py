import json, requests
u = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]
t = requests.post(u + '/api/auth/login', json={"email": "admin@garage.com", "password": "admin123"}).json()["token"]
h = {"Authorization": f"Bearer {t}"}
cards = requests.get(u + '/api/repairs', headers=h).json()
for c in cards:
    if str(c.get("customer_name", "")).startswith("TEST_"):
        r = requests.delete(f"{u}/api/repairs/{c['id']}", headers=h)
        print("deleted", c["card_number"], c["customer_name"], r.status_code)
print("remaining TEST cards:", [c["customer_name"] for c in requests.get(u + '/api/repairs', headers=h).json() if str(c.get("customer_name","")).startswith("TEST_")])
