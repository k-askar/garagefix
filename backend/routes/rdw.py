"""
RDW (Netherlands vehicle registry) open-data plate lookup.
Public endpoint used by the frontend to auto-fill make/model/APK/year.
"""
from __future__ import annotations

import re
import asyncio
import httpx
from fastapi import APIRouter, HTTPException, Depends


def register(get_current_user):
    router = APIRouter()

    @router.get("/rdw/lookup")
    async def rdw_lookup(plate: str, user: dict = Depends(get_current_user)):
        """Fetch make/model/year/color/apk_expiry from the public RDW open-data API.
        The plate is normalised (uppercase, no separators). Returns 404 when the
        plate is unknown so the frontend can show a friendly toast."""
        cleaned = re.sub(r"[^A-Z0-9]", "", (plate or "").upper())
        if len(cleaned) < 4:
            raise HTTPException(status_code=400, detail="Plate too short")
        main_url = f"https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken={cleaned}"
        fuel_url = f"https://opendata.rdw.nl/resource/8ys7-d773.json?kenteken={cleaned}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                main_resp, fuel_resp = await asyncio.gather(
                    client.get(main_url, headers={"Accept": "application/json"}),
                    client.get(fuel_url, headers={"Accept": "application/json"}),
                    return_exceptions=True,
                )
                if isinstance(main_resp, Exception):
                    raise main_resp
                main_resp.raise_for_status()
                rows = main_resp.json()
                fuel_rows = []
                if not isinstance(fuel_resp, Exception):
                    try:
                        fuel_resp.raise_for_status()
                        fuel_rows = fuel_resp.json() or []
                    except Exception:
                        fuel_rows = []
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"RDW unreachable: {e}")
        if not rows:
            raise HTTPException(status_code=404, detail=f"Plate {cleaned} not found in RDW")
        row = rows[0]
        fuel_row = fuel_rows[0] if fuel_rows else {}

        # Format the plate back with the classical Dutch dashes (e.g. KK-555-D)
        def _format_plate(k: str) -> str:
            k = k.upper()
            groups, buf = [], ""
            for ch in k:
                if not buf:
                    buf = ch
                    continue
                if (buf[-1].isdigit()) == (ch.isdigit()):
                    buf += ch
                else:
                    groups.append(buf)
                    buf = ch
            if buf:
                groups.append(buf)
            return "-".join(groups) if groups else k

        apk_raw = row.get("vervaldatum_apk") or ""
        apk = f"{apk_raw[0:4]}-{apk_raw[4:6]}-{apk_raw[6:8]}" if len(apk_raw) == 8 else ""
        reg_raw = row.get("datum_tenaamstelling") or ""
        reg_date = f"{reg_raw[0:4]}-{reg_raw[4:6]}-{reg_raw[6:8]}" if len(reg_raw) == 8 else ""
        bouw = row.get("datum_eerste_toelating") or ""
        year = bouw[:4] if len(bouw) >= 4 else ""
        return {
            "plate":       _format_plate(cleaned),
            "make":        (row.get("merk") or "").title(),
            "model":       (row.get("handelsbenaming") or "").title(),
            "year":        year,
            "color":       (row.get("eerste_kleur") or "").title(),
            "country":     "NL",
            "apk_expiry":  apk,
            "registration_date": reg_date,
            "vehicle_type": row.get("voertuigsoort") or "",
            "fuel":        (fuel_row.get("brandstof_omschrijving") or row.get("brandstof_omschrijving") or "").title(),
            "cc":          row.get("cilinderinhoud") or "",
            "doors":       row.get("aantal_deuren") or "",
            "seats":       row.get("aantal_zitplaatsen") or "",
            "chassis_location": row.get("plaats_chassisnummer") or "",
            "weight":      row.get("massa_ledig_voertuig") or "",
            "eco_class":   row.get("zuinigheidsclassificatie") or "",
            "open_recall": row.get("openstaande_terugroepactie_indicator") or "",
            # Meldcode voertuig is NOT part of the RDW open data feed (privacy — it is
            # only printed on the owner's registration paper).  We surface it as an
            # empty string so the frontend can prompt the owner to type it manually.
            "meldcode":    "",
        }

    return router
