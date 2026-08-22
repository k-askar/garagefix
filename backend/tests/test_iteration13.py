"""Iteration 13 — A4 delivery-note OCR (Claude Sonnet 4.6 vision) + regression."""
import base64
import io
import os

import pytest
import requests
from PIL import Image, ImageDraw, ImageFont

from conftest import BASE_URL

A4_PATH = "/app/test_reports/a4_delivery_note.jpg"

LINES = [
    "DELIVERY NOTE / PAKBON",
    "",
    "SUPPLIER: AutoOnderdelen BV",
    "Rotterdam, NL   -   Slip no. 77123",
    "",
    "Customer plate: B-XX-1234",
    "Part: Front brake pads BMW E90",
    "OEM / Part no.: 34116794300",
    "Quantity: 2",
    "Inkoop / cost per unit: EUR 42.50",
    "Verkoop / sell per unit: EUR 75.00",
    "",
    "Total inkoop: EUR 85.00",
    "Signature: ______________________",
]


def _font(size):
    for p in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def build_a4_image(path=A4_PATH):
    """Synthetic A4-like delivery note with real typography + geometric features."""
    img = Image.new("RGB", (800, 1100), (247, 246, 242))
    d = ImageDraw.Draw(img)
    # header block + framing lines so the image is not uniform
    d.rectangle([40, 40, 760, 130], fill=(30, 40, 70))
    d.rectangle([40, 40, 760, 1060], outline=(60, 60, 60), width=3)
    d.text((60, 70), "AutoOnderdelen BV", font=_font(34), fill=(255, 255, 255))
    y = 170
    for line in LINES:
        if line:
            d.text((70, y), line, font=_font(26), fill=(15, 15, 15))
        y += 46
    d.line([70, 1000, 730, 1000], fill=(120, 120, 120), width=2)
    for i in range(30):
        d.rectangle([70 + i * 14, 1015, 74 + i * 14, 1045], fill=(20, 20, 20))
    img.save(path, "JPEG", quality=90)
    return path


@pytest.fixture(scope="module")
def a4_b64():
    build_a4_image()
    with open(A4_PATH, "rb") as f:
        return base64.b64encode(f.read()).decode()


# ---------------- OCR endpoint: happy path ----------------
class TestOcrDeliveryNote:
    def test_ocr_extracts_all_fields(self, owner_client, a4_b64):
        r = owner_client.post(
            f"{BASE_URL}/api/special-parts/ocr-delivery-note",
            json={"image_base64": a4_b64, "mime": "image/jpeg"},
            timeout=180,
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:500]}"
        d = r.json()
        print("OCR RESULT:", d)
        for k in ("plate", "part_name", "part_number", "unit_cost", "unit_price", "quantity", "supplier_name", "confidence"):
            assert k in d, f"missing field {k}"
        assert d["plate"] == "B-XX-1234", d["plate"]
        assert "brake pads" in d["part_name"].lower(), d["part_name"]
        assert d["part_number"].replace(" ", "") == "34116794300", d["part_number"]
        assert abs(float(d["unit_cost"]) - 42.5) < 0.01, d["unit_cost"]
        assert abs(float(d["unit_price"]) - 75.0) < 0.01, d["unit_price"]
        assert int(d["quantity"]) == 2, d["quantity"]
        assert "autoonderdelen" in d["supplier_name"].lower(), d["supplier_name"]
        assert float(d["confidence"]) > 0.5, d["confidence"]
        assert "_id" not in d


# ---------------- OCR endpoint: error handling ----------------
class TestOcrErrors:
    def test_empty_image_400(self, owner_client):
        r = owner_client.post(
            f"{BASE_URL}/api/special-parts/ocr-delivery-note",
            json={"image_base64": "", "mime": "image/jpeg"}, timeout=60)
        assert r.status_code == 400, f"{r.status_code}: {r.text[:300]}"

    def test_no_auth_401(self):
        r = requests.post(
            f"{BASE_URL}/api/special-parts/ocr-delivery-note",
            json={"image_base64": "abcd", "mime": "image/jpeg"}, timeout=60)
        assert r.status_code in (401, 403), f"{r.status_code}: {r.text[:300]}"

    def test_garbage_base64_502(self, owner_client):
        junk = base64.b64encode(b"this is definitely not an image" * 40).decode()
        r = owner_client.post(
            f"{BASE_URL}/api/special-parts/ocr-delivery-note",
            json={"image_base64": junk, "mime": "image/jpeg"}, timeout=120)
        assert r.status_code == 502, f"expected 502, got {r.status_code}: {r.text[:300]}"


# ---------------- Regression: barcode/typed scan-delivery ----------------
class TestScanDeliveryRegression:
    def test_typed_slip_matches_card(self, owner_client):
        r = owner_client.post(
            f"{BASE_URL}/api/special-parts/scan-delivery",
            json={"code": "delivery slip 77123 plate B-XX-1234 4x brake pads"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["detected_plate"] == "B-XX-1234", d
        assert d["matched"] is True, d
        assert any(m["card_number"] == "JOB-260820-8729" for m in d["matches"]), d


# ---------------- Regression: special parts on card (iteration 12) ----------------
class TestSpecialPartsRegression:
    def test_e142_has_special_part(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/repairs", timeout=60)
        assert r.status_code == 200
        cards = r.json()
        card = next((c for c in cards if c.get("card_number") == "JOB-260822-E142"), None)
        assert card is not None, "JOB-260822-E142 not found"
        sp = card.get("special_parts") or []
        assert any("Brake pads BMW E90" in (p.get("name") or "") for p in sp), sp
