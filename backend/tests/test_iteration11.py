"""Iteration 11 — invoice PDF/email/settings customisation backend tests."""
import io
import os
import struct
import zlib

import pytest
import requests

from conftest import BASE_URL


def _png_bytes():
    """Build a tiny valid 1x1 PNG in-memory."""
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


# ---------------- Settings new fields ----------------
class TestSettingsNewFields:
    def test_get_settings_has_new_fields(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/settings", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ("bank_name", "bic", "invoice_show_qr", "invoice_header_align", "invoice_currency_symbol_pos"):
            assert k in d, f"missing field {k}"
        assert isinstance(d["invoice_show_qr"], bool)
        assert d["invoice_header_align"] in ("left", "center", "right")
        assert d["invoice_currency_symbol_pos"] in ("prefix", "suffix")

    def test_put_settings_roundtrip_new_fields(self, owner_client):
        orig = owner_client.get(f"{BASE_URL}/api/settings", timeout=30).json()
        payload = {**orig,
                   "bank_name": "TEST_ING Bank",
                   "bic": "INGBNL2A",
                   "invoice_show_qr": False,
                   "invoice_header_align": "center",
                   "invoice_currency_symbol_pos": "prefix",
                   "iban": "NL91ABNA0417164300"}
        payload.pop("last_backup_at", None)
        r = owner_client.put(f"{BASE_URL}/api/settings", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:400]
        got = owner_client.get(f"{BASE_URL}/api/settings", timeout=30).json()
        assert got["bank_name"] == "TEST_ING Bank"
        assert got["bic"] == "INGBNL2A"
        assert got["invoice_show_qr"] is False
        assert got["invoice_header_align"] == "center"
        assert got["invoice_currency_symbol_pos"] == "prefix"
        # restore sane values for frontend tests
        restore = {**got, "invoice_show_qr": True, "invoice_header_align": "left",
                   "invoice_currency_symbol_pos": "suffix", "bank_name": "ING Bank",
                   "bic": "INGBNL2A", "iban": "NL91ABNA0417164300"}
        rr = owner_client.put(f"{BASE_URL}/api/settings", json=restore, timeout=30)
        assert rr.status_code == 200

    def test_invalid_header_align_rejected(self, owner_client):
        orig = owner_client.get(f"{BASE_URL}/api/settings", timeout=30).json()
        bad = {**orig, "invoice_header_align": "diagonal"}
        r = owner_client.put(f"{BASE_URL}/api/settings", json=bad, timeout=30)
        assert r.status_code == 422, f"expected 422, got {r.status_code}"


# ---------------- Public logo endpoint ----------------
class TestPublicLogoEndpoint:
    def test_logo_upload_and_public_fetch(self, owner_client):
        files = {"file": ("TEST_logo.png", _png_bytes(), "image/png")}
        up = owner_client.post(f"{BASE_URL}/api/settings/logo", files=files, timeout=60)
        if up.status_code == 502:
            pytest.skip(f"object storage unavailable: {up.text[:200]}")
        assert up.status_code == 200, up.text[:400]
        logo_url = up.json()["logo_url"]
        assert logo_url.startswith("/api/settings/logo-file?path=")
        # fetch with NO auth header
        anon = requests.get(f"{BASE_URL}{logo_url}", timeout=30)
        assert anon.status_code == 200, f"public fetch failed {anon.status_code}: {anon.text[:200]}"
        assert anon.headers.get("content-type", "").startswith("image/"), anon.headers.get("content-type")
        assert len(anon.content) > 0

    def test_logo_invalid_path_404_not_401(self):
        r = requests.get(f"{BASE_URL}/api/settings/logo-file", params={"path": "pitstock/logos/does-not-exist.png"}, timeout=30)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:200]}"


# ---------------- Invoice email ----------------
@pytest.fixture(scope="class")
def sample_invoice(owner_client):
    r = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30)
    assert r.status_code == 200, r.text[:300]
    invs = r.json()
    if not invs:
        pytest.skip("no invoices present to test email")
    return invs[0]


class TestInvoiceEmail:
    def test_email_no_recipient_400(self, owner_client):
        # create an invoice-less customer scenario: use invoice whose customer has no email
        invs = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30).json()
        target = None
        for inv in invs:
            cid = inv.get("customer_id")
            if not cid:
                target = inv
                break
            c = owner_client.get(f"{BASE_URL}/api/customers/{cid}", timeout=30)
            if c.status_code == 200 and not (c.json() or {}).get("email"):
                target = inv
                break
        if not target:
            pytest.skip("every invoice customer has an email; cannot test 400 path")
        r = owner_client.post(f"{BASE_URL}/api/invoices/{target['id']}/email", json={}, timeout=60)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"
        assert "recipient" in r.json().get("detail", "").lower()

    def test_email_invoice_not_found(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/invoices/nope-not-real/email",
                              json={"to": "test@example.com"}, timeout=60)
        assert r.status_code == 404

    def test_email_success(self, owner_client, sample_invoice):
        inv_id = sample_invoice["id"]
        r = owner_client.post(f"{BASE_URL}/api/invoices/{inv_id}/email",
                              json={"to": "test@example.com", "subject": "Hi", "message": "note"},
                              timeout=90)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        d = r.json()
        assert d["ok"] is True
        assert d["to"] == "test@example.com"

    def test_email_metadata_exposed_on_list(self, owner_client, sample_invoice):
        """BUG: Invoice response_model lacks last_emailed_at/last_emailed_to so they get stripped."""
        inv_id = sample_invoice["id"]
        invs = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30).json()
        found = next((i for i in invs if i["id"] == inv_id), None)
        assert found is not None
        assert found.get("last_emailed_to") == "test@example.com"
        assert found.get("last_emailed_at")

    def test_email_requires_auth(self, sample_invoice):
        r = requests.post(f"{BASE_URL}/api/invoices/{sample_invoice['id']}/email",
                          json={"to": "test@example.com"}, timeout=30)
        assert r.status_code in (401, 403)


# ---------------- Regression ----------------
class TestRegression:
    def test_invoices_list_no_mongo_id(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30)
        assert r.status_code == 200
        for inv in r.json()[:10]:
            assert "_id" not in inv

    def test_appointment_conflicts(self, owner_client):
        mechs = owner_client.get(f"{BASE_URL}/api/users", timeout=30)
        mid = ""
        if mechs.status_code == 200 and mechs.json():
            mid = mechs.json()[0]["id"]
        r = owner_client.get(f"{BASE_URL}/api/appointments/conflicts",
                             params={"mechanic_id": mid,
                                     "start": "2026-07-10T09:00:00",
                                     "duration_min": 60}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert "conflicts" in r.json()

    def test_overdue_reminders(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/invoices/overdue/send-reminders", timeout=90)
        assert r.status_code == 200, r.text[:300]

    def test_invoice_lifecycle_from_transactions(self, owner_client):
        cust = owner_client.post(f"{BASE_URL}/api/customers",
                                 json={"name": "TEST_Iter11 Cust", "phone": "+31600000011",
                                       "email": "test_iter11@example.com"}, timeout=30)
        assert cust.status_code in (200, 201), cust.text[:300]
        cid = cust.json()["id"]
        item_id = None
        try:
            inv_items = owner_client.get(f"{BASE_URL}/api/inventory", timeout=30).json()
            if not inv_items:
                pytest.skip("no inventory items to build a transaction")
            item = next((i for i in inv_items if (i.get("quantity") or 0) > 1), inv_items[0])
            item_id = item["id"]
            tx = owner_client.post(f"{BASE_URL}/api/transactions",
                                   json={"type": "OUT", "item_id": item_id, "quantity": 1,
                                         "unit_price": 100.0, "customer_id": cid,
                                         "note": "TEST_iter11 tx"},
                                   timeout=30)
            assert tx.status_code in (200, 201), tx.text[:300]
            r = owner_client.post(f"{BASE_URL}/api/invoices/from-transactions",
                                  json={"customer_id": cid, "transaction_ids": [tx.json()["id"]],
                                        "tax_rate": 21.0},
                                  timeout=30)
            assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:400]}"
            inv = r.json()
            inv_id = inv.get("id")
            assert inv_id
            assert inv["subtotal"] == 100.0
            assert round(inv["tax"], 2) == 21.0
            assert round(inv["total"], 2) == 121.0
            mp = owner_client.post(f"{BASE_URL}/api/invoices/{inv_id}/mark-paid",
                                   json={"payment_method": "cash"}, timeout=30)
            assert mp.status_code == 200, mp.text[:300]
            invs = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30).json()
            found = next((i for i in invs if i["id"] == inv_id), None)
            assert found and found["status"] == "paid"
            dele = owner_client.delete(f"{BASE_URL}/api/invoices/{inv_id}", timeout=30)
            assert dele.status_code == 200
            invs = owner_client.get(f"{BASE_URL}/api/invoices", timeout=30).json()
            assert not any(i["id"] == inv_id for i in invs)
        finally:
            owner_client.delete(f"{BASE_URL}/api/customers/{cid}", timeout=30)
