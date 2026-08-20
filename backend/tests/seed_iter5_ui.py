"""Seed an unpaid invoice + a draft PO for UI testing of payment-method dialogs."""
import time
import requests
from dotenv import dotenv_values

BASE = dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"].rstrip("/")
s = requests.Session()
tok = s.post(f"{BASE}/api/auth/login", json={"email": "admin@garage.com", "password": "admin123"}, timeout=30).json()["token"]
s.headers.update({"Authorization": f"Bearer {tok}"})

sku = f"QA_UI_{int(time.time())}"
item = s.post(f"{BASE}/api/inventory", json={"name": "QA_UI Part", "sku": sku, "category": "General",
                                             "quantity": 50, "cost_price": 5.0, "selling_price": 20.0, "min_stock": 1}, timeout=30).json()
cust = s.post(f"{BASE}/api/customers", json={"name": "QA_UI Customer"}, timeout=30).json()
sup = s.post(f"{BASE}/api/suppliers", json={"name": "QA_UI Supplier"}, timeout=30).json()

txn = s.post(f"{BASE}/api/transactions", json={"type": "OUT", "item_id": item["id"], "quantity": 1,
                                              "unit_price": 20.0, "customer_id": cust["id"], "note": "QA_UI sale"}, timeout=30).json()
inv = s.post(f"{BASE}/api/invoices/from-transactions", json={"customer_id": cust["id"],
                                                            "transaction_ids": [txn["id"]], "tax_rate": 0}, timeout=30).json()
po = s.post(f"{BASE}/api/purchase-orders", json={"supplier_id": sup["id"], "items": [
    {"item_id": item["id"], "sku": item["sku"], "name": item["name"], "quantity": 3, "unit_cost": 6.0, "total": 18.0}],
    "note": "QA_UI po"}, timeout=30).json()
print("invoice", inv["invoice_number"], inv["total"], inv["status"])
print("po", po["po_number"], po["total"], po["status"])
