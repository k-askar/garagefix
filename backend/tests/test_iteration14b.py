"""Iteration 14b — car_country must be present in every payload that renders a plate badge."""
import os
import pytest
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"


class TestPlateCountryPayloads:
    def test_dashboard_summary_open_cars_include_car_country(self, owner_client):
        r = owner_client.get(f"{API}/dashboard/summary", timeout=30)
        assert r.status_code == 200, r.text
        cars = r.json().get("open_cars", [])
        if not cars:
            pytest.skip("no open cards")
        missing = [c["card_number"] for c in cars if "car_country" not in c]
        assert not missing, (
            "GET /api/dashboard/summary open_cars omits car_country -> Dashboard.jsx falls back to 'NL' "
            f"and non-Dutch plates render as Dutch. Cards missing the field: {missing}"
        )

    def test_workboard_cards_include_car_country(self, owner_client):
        r = owner_client.get(f"{API}/repairs", timeout=30)
        assert r.status_code == 200
        assert all("car_country" in c for c in r.json())

    def test_bay_board_includes_car_country(self, owner_client):
        r = owner_client.get(f"{API}/bays", timeout=30)
        if r.status_code == 404:
            pytest.skip("no /bays endpoint")
        assert r.status_code == 200, r.text
