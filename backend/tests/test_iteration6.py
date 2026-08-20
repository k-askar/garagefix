"""Iteration 6 — Labor time clock on repair cards + settings.labor_rate"""
import time
import pytest
import requests
from datetime import datetime, timedelta, timezone

from conftest import BASE_URL


@pytest.fixture(scope="module")
def orig_settings(owner_client):
    # NOTE: settings are global/shared, so we do NOT restore labor_rate afterwards
    # (a teardown write races with the other xdist worker). Suite leaves labor_rate = 60.
    r = owner_client.get(f"{BASE_URL}/api/settings", timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(autouse=True)
def rate_60(owner_client, orig_settings):
    owner_client.put(f"{BASE_URL}/api/settings", json={**orig_settings, "labor_rate": 60.0}, timeout=30)


@pytest.fixture(scope="module")
def card_ids():
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(owner_client, card_ids):
    yield
    for cid in card_ids:
        owner_client.delete(f"{BASE_URL}/api/repairs/{cid}", timeout=30)


def _new_card(owner_client, card_ids, name="TEST_TimeClock"):
    r = owner_client.post(f"{BASE_URL}/api/repairs", json={
        "customer_name": name, "customer_phone": "0600000000",
        "car_make": "TEST", "car_model": "Clock", "complaint": "TEST time clock",
    }, timeout=30)
    assert r.status_code == 200, r.text[:300]
    c = r.json()
    card_ids.append(c["id"])
    return c


# --- Settings labor_rate ---
class TestSettingsLaborRate:
    def test_get_settings_has_labor_rate(self, owner_client, orig_settings):
        assert "labor_rate" in orig_settings
        assert isinstance(orig_settings["labor_rate"], (int, float))

    def test_put_labor_rate_persists(self, owner_client, orig_settings):
        payload = {**orig_settings, "labor_rate": 60.0}
        r = owner_client.put(f"{BASE_URL}/api/settings", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["labor_rate"] == 60.0
        g = owner_client.get(f"{BASE_URL}/api/settings", timeout=30)
        assert g.json()["labor_rate"] == 60.0

    def test_staff_cannot_update_settings(self, staff_client, orig_settings):
        r = staff_client.put(f"{BASE_URL}/api/settings", json={**orig_settings, "labor_rate": 99.0}, timeout=30)
        assert r.status_code == 403, r.text[:200]

    def test_no_mongo_id_leak(self, owner_client):
        assert "_id" not in owner_client.get(f"{BASE_URL}/api/settings", timeout=30).json()


# --- Clock in / out ---
class TestClockInOut:
    def test_clock_in_creates_running_log_and_status(self, owner_client, card_ids):
        card = _new_card(owner_client, card_ids)
        assert card["status"] == "open"
        r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-in", json={}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        c = r.json()
        assert len(c["time_logs"]) == 1
        log = c["time_logs"][0]
        assert log["started_at"]
        assert log["stopped_at"] is None
        assert log["mechanic_name"], "mechanic_name should be populated from calling user"
        assert c["status"] == "in_progress"

    def test_duplicate_clock_in_400(self, owner_client, card_ids):
        card = _new_card(owner_client, card_ids)
        assert owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-in", json={}, timeout=30).status_code == 200
        r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-in", json={}, timeout=30)
        assert r.status_code == 400
        assert r.json()["detail"] == "A time log is already running on this card"
        c = owner_client.get(f"{BASE_URL}/api/repairs/{card['id']}", timeout=30).json()
        assert len(c["time_logs"]) == 1

    def test_clock_out_computes_labor_and_total(self, owner_client, card_ids, orig_settings):
        card = _new_card(owner_client, card_ids)
        owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-in", json={}, timeout=30)
        time.sleep(3)
        r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-out", json={}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        c = r.json()
        log = c["time_logs"][0]
        assert log["stopped_at"] is not None
        assert log["minutes"] > 0
        assert round(c["labor_minutes"], 2) == round(log["minutes"], 2)
        expected = round((log["minutes"] / 60.0) * 60.0, 2)
        assert abs(c["labor_charge"] - expected) < 0.02, (c["labor_charge"], expected)
        assert abs(c["grand_total"] - round(c["parts_total"] + c["labor_charge"], 2)) < 0.01
        # persisted
        g = owner_client.get(f"{BASE_URL}/api/repairs/{card['id']}", timeout=30).json()
        assert abs(g["labor_charge"] - c["labor_charge"]) < 0.001

    def test_clock_out_without_running_log_400(self, owner_client, card_ids):
        card = _new_card(owner_client, card_ids)
        r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-out", json={}, timeout=30)
        assert r.status_code == 400
        assert r.json()["detail"] == "No running time log to stop"

    def test_clock_in_unknown_card_404(self, owner_client):
        r = owner_client.post(f"{BASE_URL}/api/repairs/does-not-exist/clock-in", json={}, timeout=30)
        assert r.status_code == 404

    def test_clock_in_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/repairs/x/clock-in", json={}, timeout=30)
        assert r.status_code in (401, 403)

    def test_staff_can_clock(self, staff_client, owner_client, card_ids):
        card = _new_card(owner_client, card_ids)
        r = staff_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-in", json={}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["time_logs"][0]["mechanic_name"] == "Mike Mechanic"
        assert staff_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-out", json={}, timeout=30).status_code == 200


# --- Manual time logs ---
class TestManualTimeLogs:
    def test_manual_entry_ok(self, owner_client, card_ids, orig_settings):
        card = _new_card(owner_client, card_ids)
        start = datetime.now(timezone.utc) - timedelta(hours=2)
        stop = start + timedelta(minutes=90)
        r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/time-logs", json={
            "started_at": start.isoformat(), "stopped_at": stop.isoformat(), "note": "TEST manual",
        }, timeout=30)
        assert r.status_code == 200, r.text[:300]
        c = r.json()
        log = c["time_logs"][0]
        assert log["minutes"] == 90.0
        assert c["labor_charge"] == 90.0  # 1.5h * 60
        assert c["labor_minutes"] == 90.0

    def test_manual_entry_stop_before_start_400(self, owner_client, card_ids):
        card = _new_card(owner_client, card_ids)
        now = datetime.now(timezone.utc)
        r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/time-logs", json={
            "started_at": now.isoformat(), "stopped_at": (now - timedelta(minutes=5)).isoformat(),
        }, timeout=30)
        assert r.status_code == 400
        assert "after" in r.json()["detail"].lower()

    def test_manual_entry_equal_times_400(self, owner_client, card_ids):
        card = _new_card(owner_client, card_ids)
        now = datetime.now(timezone.utc).isoformat()
        r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/time-logs",
                              json={"started_at": now, "stopped_at": now}, timeout=30)
        assert r.status_code == 400

    def test_manual_entry_bad_iso_400(self, owner_client, card_ids):
        card = _new_card(owner_client, card_ids)
        r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/time-logs",
                              json={"started_at": "not-a-date", "stopped_at": "also-bad"}, timeout=30)
        assert r.status_code == 400, r.text[:300]


# --- Delete time log ---
class TestDeleteTimeLog:
    def test_delete_recomputes_labor(self, owner_client, card_ids, orig_settings):
        card = _new_card(owner_client, card_ids)
        base = datetime.now(timezone.utc) - timedelta(hours=5)
        for mins in (60, 30):
            r = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/time-logs", json={
                "started_at": base.isoformat(), "stopped_at": (base + timedelta(minutes=mins)).isoformat(),
            }, timeout=30)
            assert r.status_code == 200
            c = r.json()
        assert c["labor_charge"] == 90.0
        log_id = c["time_logs"][0]["id"]
        d = owner_client.delete(f"{BASE_URL}/api/repairs/{card['id']}/time-logs/{log_id}", timeout=30)
        assert d.status_code == 200, d.text[:300]
        c2 = d.json()
        assert len(c2["time_logs"]) == 1
        assert c2["labor_minutes"] == 30.0
        assert c2["labor_charge"] == 30.0
        assert c2["grand_total"] == round(c2["parts_total"] + 30.0, 2)
        g = owner_client.get(f"{BASE_URL}/api/repairs/{card['id']}", timeout=30).json()
        assert g["labor_charge"] == 30.0

    def test_delete_unknown_log_404(self, owner_client, card_ids):
        card = _new_card(owner_client, card_ids)
        r = owner_client.delete(f"{BASE_URL}/api/repairs/{card['id']}/time-logs/nope", timeout=30)
        assert r.status_code == 404


# --- Manual labor override interaction ---
class TestLaborOverride:
    def test_manual_override_then_clock_out_overwrites(self, owner_client, card_ids, orig_settings):
        card = _new_card(owner_client, card_ids)
        r = owner_client.put(f"{BASE_URL}/api/repairs/{card['id']}", json={"labor_charge": 123.45}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["labor_charge"] == 123.45
        assert r.json()["grand_total"] == round(r.json()["parts_total"] + 123.45, 2)
        owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-in", json={}, timeout=30)
        time.sleep(2)
        c = owner_client.post(f"{BASE_URL}/api/repairs/{card['id']}/clock-out", json={}, timeout=30).json()
        assert c["labor_charge"] != 123.45, "clock-out should overwrite manual override"
        assert c["labor_charge"] < 5

    def test_delete_card_cleanup(self, owner_client):
        card = _new_card(owner_client, [], name="TEST_DeleteCleanup")
        d = owner_client.delete(f"{BASE_URL}/api/repairs/{card['id']}", timeout=30)
        assert d.status_code == 200, d.text[:300]
        assert owner_client.get(f"{BASE_URL}/api/repairs/{card['id']}", timeout=30).status_code == 404
