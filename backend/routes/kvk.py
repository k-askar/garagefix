"""KvK (Chamber of Commerce) Basisprofielen lookup for Dutch companies."""
from __future__ import annotations

import os
import re
import httpx
from fastapi import APIRouter, HTTPException, Depends


def register(get_current_user):
    router = APIRouter()

    @router.get("/kvk/lookup")
    async def kvk_lookup(kvk: str, user: dict = Depends(get_current_user)):
        """Look up a Dutch company by its 8-digit KvK number.
        Uses the official KvK Basisprofielen API (production or test/sandbox
        depending on `KVK_ENV`).  Returns 501 with a helpful message when the
        key hasn't been configured yet so the frontend can guide the owner to
        replace the sandbox key with a real production one."""
        cleaned = re.sub(r"[^0-9]", "", (kvk or ""))
        if len(cleaned) != 8:
            raise HTTPException(status_code=400, detail="KvK number must be 8 digits")
        api_key = os.environ.get("KVK_API_KEY", "").strip()
        if not api_key:
            raise HTTPException(
                status_code=501,
                detail=(
                    "KvK auto-fill is optioneel. Vraag een gratis API-key aan op "
                    "https://developers.kvk.nl → zet 'KVK_API_KEY=…' in backend/.env → "
                    "herstart de backend. Ondertussen kun je de bedrijfsgegevens gewoon "
                    "handmatig invullen."
                ),
            )
        kvk_env = (os.environ.get("KVK_ENV") or "").strip().lower()
        base = "https://api.kvk.nl/test/api/v1" if kvk_env == "test" else "https://api.kvk.nl/api/v1"
        url = f"{base}/basisprofielen/{cleaned}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, headers={"apikey": api_key, "Accept": "application/json"})
                if r.status_code == 404:
                    hint = " (probeer een test-nummer zoals 68727720)" if kvk_env == "test" else ""
                    raise HTTPException(status_code=404, detail=f"KvK {cleaned} niet gevonden{hint}")
                if r.status_code == 401:
                    raise HTTPException(status_code=401, detail="KVK API key rejected — replace KVK_API_KEY with a valid one")
                r.raise_for_status()
                data = r.json()
        except HTTPException:
            raise
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"KvK API unreachable: {e}")
        handelsnaam = (
            data.get("handelsnaam")
            or (data.get("_embedded", {}).get("eigenaar", {}) or {}).get("handelsnaam")
            or (data.get("_embedded", {}).get("hoofdvestiging", {}) or {}).get("naam")
            or ""
        )
        hoofdvestiging = data.get("_embedded", {}).get("hoofdvestiging", {}) or {}
        addresses = (hoofdvestiging.get("adressen") or []) + (data.get("adressen") or [])
        addr = next((a for a in addresses if a.get("type") in (None, "bezoekadres", "correspondentieadres")),
                    addresses[0] if addresses else {})
        return {
            "kvk_number":  cleaned,
            "company_name": handelsnaam,
            "vat_number":  data.get("btwNummer") or "",
            "street":      addr.get("straatnaam") or "",
            "house_number": str(addr.get("huisnummer") or "") if addr.get("huisnummer") else "",
            "house_number_addition": addr.get("huisnummerToevoeging") or "",
            "postcode":    addr.get("postcode") or "",
            "city":        addr.get("plaats") or "",
            "address_country": "NL",
            "trade_names": [h.get("naam") for h in (data.get("handelsnamen") or []) if h.get("naam")],
        }

    return router
