"""Iteration 14 — Part return / un-return flow, car_country on repairs, repair regression."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"


# ---------------------------------------------------------------- helpers
def _stocked_item(client, min_qty=3):
    r = client.get(f"{API}/inventory", timeout=30)
    assert r.status_code == 200, r.text
    items = r.json()
    items = items if isinstance(items, list) else items.get("items", [])
    cands = [i for i in items if (i.get("quantity") or 0) >= min_qty]
    if not cands:
        pytest.skip("No inventory item with sufficient stock")
    return cands[0]


def _item_qty(client, item_id):
    r = client.get(f"{API}/inventory/{item_id}", timeout=30)
    if r.status_code == 200:
        return int(r.json().get("quantity", 0))
    r = client.get(f"{API}/inventory", timeout=30)
    items = r.json()
    items = items if isinstance(items, list) else items.get("items", [])
    return int(next(i for i in items if i["id"] == item_id)["quantity"])


@pytest.fixture(scope="module")
def created(owner_client):
    ids = []
    yield ids
    for rid in ids:
        owner_client.delete(f"{API}/repairs/{rid}", timeout=30)


@pytest.fixture
def repair_with_part(owner_client, created):
    """Create a fresh repair with one part fitted. Returns (card, item, qty)."""
    item = _stocked_item(owner_client)
    payload = {
        "customer_name": "TEST_Return Customer",
        "car_make": "Mercedes",
        "car_model": "Sprinter",
        "car_plate": "TEST-RET-1",
        "car_country": "DE",
        "complaint": "TEST_return flow",
    }
    r = owner_client.post(f"{API}/repairs", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create repair failed {r.status_code}: {r.text[:300]}"
    card = r.json()
    rid = card["id"]
    created.append(rid)
    qty = 2
    r2 = owner_client.post(f"{API}/repairs/{rid}/parts", json={"item_id": item["id"], "quantity": qty}, timeout=30)
    assert r2.status_code == 200, f"add part failed {r2.status_code}: {r2.text[:300]}"
    return r2.json(), item, qty


# ---------------------------------------------------------------- car_country
class TestRepairCarCountry:
    def test_list_repairs_includes_car_country(self, owner_client):
        r = owner_client.get(f"{API}/repairs", timeout=30)
        assert r.status_code == 200, r.text
        cards = r.json()
        assert isinstance(cards, list) and len(cards) > 0, "no repairs found"
        for c in cards:
            assert "car_country" in c, f"card {c.get('card_number')} missing car_country"
        countries = {c.get("car_country") for c in cards}
        assert "NL" in countries, f"expected seed NL country, got {countries}"

    def test_no_mongo_id_leak(self, owner_client):
        r = owner_client.get(f"{API}/repairs", timeout=30)
        assert all("_id" not in c for c in r.json())

    def test_create_preserves_non_nl_country(self, owner_client, created):
        r = owner_client.post(f"{API}/repairs", json={
            "customer_name": "TEST_DE Cust", "car_make": "BMW", "car_model": "X5",
            "car_plate": "TEST-DE-9", "car_country": "DE", "complaint": "TEST",
        }, timeout=30)
        assert r.status_code in (200, 201), r.text
        card = r.json()
        created.append(card["id"])
        assert card["car_country"] == "DE"
        g = owner_client.get(f"{API}/repairs/{card['id']}", timeout=30)
        assert g.status_code == 200
        assert g.json()["car_country"] == "DE"


# ---------------------------------------------------------------- return flow
class TestPartReturn:
    def test_return_marks_part_and_excludes_from_total(self, owner_client, repair_with_part):
        card, item, qty = repair_with_part
        rid = card["id"]
        part = card["parts_used"][0]
        assert part.get("returned") is False, "new part should default returned=False"
        total_before = card["grand_total"]
        part_total = part["total"]
        qty_before = _item_qty(owner_client, item["id"])

        r = owner_client.post(f"{API}/repairs/{rid}/parts/{part['txn_id']}/return",
                              json={"reason": "TEST_defective"}, timeout=30)
        assert r.status_code == 200, f"return failed {r.status_code}: {r.text[:300]}"
        out = r.json()
        p = out["parts_used"][0]
        # (a) flags
        assert p["returned"] is True
        assert p["returned_at"], "returned_at not set"
        assert p["return_reason"] == "TEST_defective"
        # (b) grand_total excludes returned part
        assert out["grand_total"] == pytest.approx(round(total_before - part_total, 2), abs=0.02), \
            f"grand_total {out['grand_total']} expected {total_before - part_total}"
        assert out["parts_total"] == pytest.approx(0, abs=0.01)
        # persistence
        g = owner_client.get(f"{API}/repairs/{rid}", timeout=30).json()
        assert g["parts_used"][0]["returned"] is True
        assert g["grand_total"] == pytest.approx(out["grand_total"], abs=0.01)
        # (c) inventory restocked
        assert _item_qty(owner_client, item["id"]) == qty_before + qty
        # (d) compensating IN transaction
        txns = owner_client.get(f"{API}/transactions", timeout=30).json()
        txns = txns if isinstance(txns, list) else txns.get("items", [])
        matches = [t for t in txns if t.get("repair_id") == rid and t.get("type") == "IN"
                   and str(t.get("note", "")).startswith("RETURN")]
        assert matches, "no compensating IN transaction with note starting 'RETURN'"
        assert matches[0]["item_id"] == item["id"]
        assert matches[0]["quantity"] == qty
        # (e) second return -> 400
        r2 = owner_client.post(f"{API}/repairs/{rid}/parts/{part['txn_id']}/return",
                               json={"reason": "again"}, timeout=30)
        assert r2.status_code == 400, f"expected 400 on double return, got {r2.status_code}"

    def test_unreturn_restores(self, owner_client, repair_with_part):
        card, item, qty = repair_with_part
        rid = card["id"]
        part = card["parts_used"][0]
        total_with_part = card["grand_total"]

        rr = owner_client.post(f"{API}/repairs/{rid}/parts/{part['txn_id']}/return",
                               json={"reason": "wrong part"}, timeout=30)
        assert rr.status_code == 200, rr.text
        qty_after_return = _item_qty(owner_client, item["id"])

        r = owner_client.post(f"{API}/repairs/{rid}/parts/{part['txn_id']}/unreturn", timeout=30)
        assert r.status_code == 200, f"unreturn failed {r.status_code}: {r.text[:300]}"
        out = r.json()
        p = out["parts_used"][0]
        assert p["returned"] is False
        assert not p.get("return_reason")
        assert out["grand_total"] == pytest.approx(total_with_part, abs=0.02)
        assert _item_qty(owner_client, item["id"]) == qty_after_return - qty
        txns = owner_client.get(f"{API}/transactions", timeout=30).json()
        txns = txns if isinstance(txns, list) else txns.get("items", [])
        matches = [t for t in txns if t.get("repair_id") == rid and t.get("type") == "OUT"
                   and str(t.get("note", "")).startswith("UN-RETURN")]
        assert matches, "no compensating OUT transaction with note starting 'UN-RETURN'"

    def test_unreturn_when_not_returned_400(self, owner_client, repair_with_part):
        card, _item, _qty = repair_with_part
        rid = card["id"]
        txn = card["parts_used"][0]["txn_id"]
        r = owner_client.post(f"{API}/repairs/{rid}/parts/{txn}/unreturn", timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_return_unknown_txn_404(self, owner_client, repair_with_part):
        card, _i, _q = repair_with_part
        r = owner_client.post(f"{API}/repairs/{card['id']}/parts/nope-123/return", json={"reason": "x"}, timeout=30)
        assert r.status_code == 404
        r2 = owner_client.post(f"{API}/repairs/nope-rid/parts/nope-123/return", json={"reason": "x"}, timeout=30)
        assert r2.status_code == 404

    def test_return_requires_auth(self, repair_with_part):
        card, _i, _q = repair_with_part
        txn = card["parts_used"][0]["txn_id"]
        r = requests.post(f"{API}/repairs/{card['id']}/parts/{txn}/return", json={"reason": "x"}, timeout=30)
        assert r.status_code in (401, 403), f"unauthenticated return got {r.status_code}"

    def test_unreturn_insufficient_stock_400(self, owner_client, repair_with_part):
        """Return the part, drain the stock to below qty, then unreturn -> 400."""
        card, item, qty = repair_with_part
        rid = card["id"]
        txn = card["parts_used"][0]["txn_id"]
        assert owner_client.post(f"{API}/repairs/{rid}/parts/{txn}/return",
                                 json={"reason": "drain test"}, timeout=30).status_code == 200
        cur = _item_qty(owner_client, item["id"])
        # set stock to qty-1 via inventory update (owner only)
        upd = owner_client.put(f"{API}/inventory/{item['id']}", json={**item, "quantity": max(0, qty - 1)}, timeout=30)
        if upd.status_code != 200:
            pytest.skip(f"cannot adjust inventory for short-stock test: {upd.status_code}")
        try:
            r = owner_client.post(f"{API}/repairs/{rid}/parts/{txn}/unreturn", timeout=30)
            assert r.status_code == 400, f"expected 400 on short stock, got {r.status_code}"
        finally:
            owner_client.put(f"{API}/inventory/{item['id']}", json={**item, "quantity": cur}, timeout=30)


# ------------------------------------------------- backward compat + regression
class TestRepairRegression:
    def test_legacy_part_without_returned_field_counts_in_total(self, owner_client, created):
        """Simulate an older PartUsed doc (no 'returned' key) — must still be billed."""
        item = _stocked_item(owner_client)
        r = owner_client.post(f"{API}/repairs", json={
            "customer_name": "TEST_Legacy", "car_make": "VW", "car_model": "Golf",
            "car_plate": "TEST-LEG-1", "complaint": "TEST legacy",
        }, timeout=30)
        assert r.status_code in (200, 201), r.text
        rid = r.json()["id"]
        created.append(rid)
        add = owner_client.post(f"{API}/repairs/{rid}/parts", json={"item_id": item["id"], "quantity": 1}, timeout=30)
        assert add.status_code == 200, add.text
        card = add.json()
        part = card["parts_used"][0]
        # strip the new fields directly in mongo to emulate a legacy doc
        try:
            from pymongo import MongoClient
            env = dotenv_values("/app/backend/.env")
            mc = MongoClient(env["MONGO_URL"])
            res = mc[env["DB_NAME"]].repairs.update_one({"id": rid}, {"$unset": {
                "parts_used.0.returned": "",
                "parts_used.0.returned_at": "",
                "parts_used.0.return_reason": "",
            }})
            assert res.modified_count == 1
        except Exception as exc:  # pragma: no cover
            pytest.skip(f"could not mutate mongo doc: {exc}")
        g = owner_client.get(f"{API}/repairs/{rid}", timeout=30)
        assert g.status_code == 200, g.text
        gc = g.json()
        assert gc["parts_used"][0]["returned"] is False, "legacy doc should default returned=False"
        assert gc["parts_total"] == pytest.approx(part["total"], abs=0.02), \
            "legacy part must remain counted in parts_total"

    def test_remove_part_still_works(self, owner_client, repair_with_part):
        card, item, qty = repair_with_part
        rid = card["id"]
        txn = card["parts_used"][0]["txn_id"]
        before = _item_qty(owner_client, item["id"])
        r = owner_client.delete(f"{API}/repairs/{rid}/parts/{txn}", timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["parts_used"] == []
        assert _item_qty(owner_client, item["id"]) == before + qty

    def test_remove_returned_part_does_not_double_restock(self, owner_client, repair_with_part):
        """A returned part was already restocked; deleting it must not restock twice."""
        card, item, qty = repair_with_part
        rid = card["id"]
        txn = card["parts_used"][0]["txn_id"]
        assert owner_client.post(f"{API}/repairs/{rid}/parts/{txn}/return",
                                 json={"reason": "dbl restock check"}, timeout=30).status_code == 200
        after_return = _item_qty(owner_client, item["id"])
        r = owner_client.delete(f"{API}/repairs/{rid}/parts/{txn}", timeout=30)
        assert r.status_code == 200, r.text
        after_delete = _item_qty(owner_client, item["id"])
        assert after_delete == after_return, (
            f"double restock: qty went {after_return} -> {after_delete} after deleting an "
            f"already-returned part (expected unchanged)"
        )

    def test_get_and_list_still_ok(self, owner_client):
        r = owner_client.get(f"{API}/repairs", timeout=30)
        assert r.status_code == 200
        cards = r.json()
        if cards:
            g = owner_client.get(f"{API}/repairs/{cards[0]['id']}", timeout=30)
            assert g.status_code == 200
            for k in ("card_number", "parts_total", "grand_total", "parts_used", "car_country"):
                assert k in g.json(), f"missing {k}"

    def test_transactions_endpoint_ok(self, owner_client):
        r = owner_client.get(f"{API}/transactions", timeout=30)
        assert r.status_code == 200
