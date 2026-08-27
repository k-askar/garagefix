"""
AI-powered purchase-invoice / packing-slip (pakbon) scanning.

Flow:
  1. Owner (or staff with `inventory.edit`) uploads a PDF / JPG / PNG.
  2. Backend converts PDFs to page-images (pypdfium2, ships as wheels — no
     poppler / OS deps) and sends them to Claude Sonnet 5 vision through
     the Emergent Universal Key.
  3. Model returns strict JSON: supplier metadata + one row per part line.
  4. We persist the whole thing as one `invoice_scans` doc; each parsed row
     starts in `status="pending"` and is auto-matched to an existing
     inventory item by barcode when possible (`match_type = "update"|"new"`).
  5. Front-end walks each row and dispatches ADD / WAIT / DELETE — a shipment
     may arrive over several deliveries so "wait" is first-class.
  6. Original file is stored in Emergent Object Storage and streamed back
     from `/api/inventory/scan-sessions/{sid}/file` for audit.

Endpoints (all under /api, mounted from server.py):
    POST   /inventory/scan/invoice                     upload + parse
    GET    /inventory/scan/sessions                    list open sessions
    GET    /inventory/scan/sessions/{sid}              one session detail
    PATCH  /inventory/scan/sessions/{sid}/items/{iid}  edit an item before save
    POST   /inventory/scan/sessions/{sid}/items/{iid}/enter   commit → inventory
    POST   /inventory/scan/sessions/{sid}/items/{iid}/wait    park for later
    POST   /inventory/scan/sessions/{sid}/items/{iid}/delete  drop row
    POST   /inventory/scan/sessions/{sid}/close        force-close the session
    GET    /inventory/scan/sessions/{sid}/file         download original file
    GET    /inventory/scan/waiting                     aggregated "Wachtend" list
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Vision system prompt — richer than the delivery-note prompt because a
# purchase invoice / pakbon lists MANY parts and includes supplier metadata
# (KvK, IBAN, address) we want the AI to lift for supplier auto-match.
_INV_SCAN_SYSTEM = (
    "You extract structured data from a photograph or scan of an automotive supplier's "
    "PURCHASE INVOICE (factuur) or PACKING SLIP (pakbon / bon de livraison). Documents "
    "may be Dutch, German, French, or English. You MUST return STRICT JSON — no prose, "
    "no code fences, no markdown, no comments.\n\n"
    "Schema — always return every key. Use empty string / 0 when unknown, never invent:\n"
    "{\n"
    '  "supplier": {\n'
    '    "name": string,          // supplier / leverancier name from letterhead\n'
    '    "kvk": string,           // Dutch KvK / registration number if visible\n'
    '    "vat_id": string,        // BTW / VAT number\n'
    '    "iban": string,          // IBAN if printed\n'
    '    "address": string,       // full one-line address\n'
    '    "phone": string,\n'
    '    "email": string\n'
    "  },\n"
    '  "invoice_number": string,  // human doc reference (F-2026-01234, INV-…)\n'
    '  "invoice_date":   string,  // ISO date YYYY-MM-DD if possible\n'
    '  "currency":       string,  // usually "EUR"\n'
    '  "total_amount":   number,  // grand total incl. VAT if shown\n'
    '  "notes":          string,  // one short line if something looks off, else ""\n'
    '  "confidence":     number,  // 0..1 — how sure you are\n'
    '  "items": [                 // EVERY line — never merge, never drop\n'
    "    {\n"
    '      "name":            string,  // human-readable part name\n'
    '      "barcode":         string,  // EAN13 / GTIN if printed. Digits only.\n'
    '      "sku":             string,  // supplier SKU or OEM part number\n'
    '      "quantity":        number,  // qty ordered — integer, default 1\n'
    '      "unit":            string,  // "pcs" | "L" | "kg" | "m" — pcs if unclear\n'
    '      "cost_price":      number,  // purchase price PER UNIT in EUR\n'
    '      "selling_price":   number,  // if a MSRP / verkoopprijs appears on same line, else 0\n'
    '      "category_hint":   string,  // best-guess category: "Oil","Filters","Brakes","Electrical","Tires","General",…\n'
    '      "notes":           string\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "Rules:\n"
    "- ALWAYS include every ordered line — a single doc can have 1–50 items.\n"
    "- Do NOT collapse duplicates. If the doc lists two lines with the same part, return two rows.\n"
    "- Prices: strip currency symbols, use dot decimal separator, no thousands separator.\n"
    "- If both incl-VAT and excl-VAT prices appear, use the excl-VAT (net) purchase price.\n"
    "- Barcodes: keep digits only. If none is printed on the line, leave barcode empty.\n"
    "- Never hallucinate an EAN — empty is better than wrong.\n"
    "- Return ONLY the JSON object. No commentary, no code fences."
)

# The three vision engines the owner can pick from.  Anthropic is the default
# because Claude Sonnet 5 handles Dutch/German invoices best in our tests.
_ENGINE_MAP = {
    "claude":  ("anthropic", "claude-sonnet-5"),
    "openai":  ("openai",    "gpt-5.2"),
    "gemini":  ("gemini",    "gemini-3.1-pro-preview"),
}
_DEFAULT_ENGINE = "claude"


def _num(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("€", "").replace("EUR", "").strip()
    # Handle "1.234,56" (EU) and "1,234.56" (US) — collapse thousands, then dot-decimal.
    if s.count(",") == 1 and s.count(".") == 0:
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(re.sub(r"[^0-9.\-]", "", s) or 0)
    except ValueError:
        return 0.0


def _pdf_to_page_images(pdf_bytes: bytes, max_pages: int = 6, dpi: int = 150) -> List[bytes]:
    """Rasterise a PDF into PNG page images with pypdfium2 (no OS deps).
    Cap at `max_pages` — most pakbons/factuurs are 1–3 pages and vision cost
    scales linearly with pages."""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(pdf_bytes)
    scale = dpi / 72.0
    out: List[bytes] = []
    n = min(len(pdf), max_pages)
    for i in range(n):
        page = pdf[i]
        pil_img = page.render(scale=scale).to_pil()
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG", optimize=True)
        out.append(buf.getvalue())
    pdf.close()
    return out


async def _run_vision(image_bytes_list: List[bytes], engine: str) -> dict:
    """Send all page-images to the picked vision model, return parsed JSON."""
    key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Vision unavailable — EMERGENT_LLM_KEY not configured")

    provider, model = _ENGINE_MAP.get(engine) or _ENGINE_MAP[_DEFAULT_ENGINE]

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"OCR library not installed: {e}")

    chat = LlmChat(
        api_key=key,
        session_id=f"inv-scan-{uuid.uuid4()}",
        system_message=_INV_SCAN_SYSTEM,
    ).with_model(provider, model)

    prompt = (
        "The following image(s) are page(s) of a supplier's purchase invoice or packing "
        "slip. Extract the fields per the schema in your system message. If multiple "
        "pages are provided treat them as ONE document — do NOT duplicate items across "
        "pages. Return ONLY the JSON object."
    )
    file_contents = [ImageContent(image_base64=base64.b64encode(b).decode("ascii")) for b in image_bytes_list]

    try:
        reply = await chat.send_message(UserMessage(text=prompt, file_contents=file_contents))
    except Exception as e:
        logger.error(f"Vision call failed ({provider}/{model}): {e}")
        raise HTTPException(status_code=502, detail=f"AI vision failed: {str(e)[:200]}")

    raw = (reply or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Some models still add a short intro line — grab the first {...} block.
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            raise HTTPException(status_code=502, detail=f"AI returned non-JSON: {raw[:200]}")
        try:
            parsed = json.loads(m.group(0))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=502, detail=f"AI JSON parse failed: {e}")

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="AI response is not an object")
    return parsed


def _normalise_item(raw_it: dict) -> dict:
    return {
        "id":             str(uuid.uuid4()),
        "name":           (raw_it.get("name") or "").strip(),
        "name_ar":        "",
        "barcode":        re.sub(r"\D", "", str(raw_it.get("barcode") or "")),
        "sku":            (raw_it.get("sku") or "").strip(),
        "quantity":       int(_num(raw_it.get("quantity")) or 1),
        "unit":           (raw_it.get("unit") or "pcs").strip() or "pcs",
        "cost_price":     round(_num(raw_it.get("cost_price")), 2),
        "selling_price":  round(_num(raw_it.get("selling_price")), 2),
        "category":       (raw_it.get("category_hint") or "General").strip() or "General",
        "notes":          (raw_it.get("notes") or "").strip(),
        # Workflow bookkeeping
        "status":         "pending",   # pending | entered | waiting | deleted
        "match_type":     "new",       # filled in by the matcher below
        "matched_item_id": None,
        "entered_item_id": None,
        "entered_qty":     0,
        "entered_at":      None,
        "entered_by":      None,
    }


# ---------- Pydantic bodies for row editing ----------

class ScanItemPatch(BaseModel):
    name:          Optional[str] = None
    name_ar:       Optional[str] = None
    barcode:       Optional[str] = None
    sku:           Optional[str] = None
    quantity:      Optional[int] = None
    unit:          Optional[str] = None
    cost_price:    Optional[float] = None
    selling_price: Optional[float] = None
    category:      Optional[str] = None
    notes:         Optional[str] = None


class ScanItemEnter(BaseModel):
    # Optional overrides at the moment of insertion — front-end can carry
    # the same edited values here so the operator doesn't need TWO API calls.
    name:          Optional[str] = None
    name_ar:       Optional[str] = None
    barcode:       Optional[str] = None
    sku:           Optional[str] = None
    quantity:      Optional[int] = None
    unit:          Optional[str] = None
    cost_price:    Optional[float] = None
    selling_price: Optional[float] = None
    category:      Optional[str] = None
    supplier_id:   Optional[str] = None
    # Enter this specific quantity now, and leave the rest as "waiting" for a
    # future delivery — perfect for backordered lines.
    enter_partial_qty: Optional[int] = None


# ---------- Router ----------

router = APIRouter(prefix="/inventory/scan", tags=["invoice-scan"])


def register_routes(db, get_current_user, require_permission, _generate_sku, _generate_barcode):
    """Called from server.py after `db` and shared deps exist."""

    edit_dep = require_permission("inventory.edit")

    # ---------- helpers over `db` ----------

    async def _load_session(sid: str) -> dict:
        s = await db.invoice_scans.find_one({"id": sid}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Scan session not found")
        return s

    async def _match_barcodes(items: List[dict]) -> List[dict]:
        """Auto-flag every parsed row as `update` if its barcode already
        exists in inventory — the front-end then offers 🔄 UPDATE STOCK
        instead of ➕ CREATE NEW."""
        codes = [it["barcode"] for it in items if it.get("barcode")]
        by_code: dict = {}
        if codes:
            existing = await db.inventory.find(
                {"barcode": {"$in": codes}},
                {"_id": 0, "id": 1, "name": 1, "barcode": 1, "quantity": 1, "cost_price": 1, "selling_price": 1},
            ).to_list(500)
            by_code = {r["barcode"]: r for r in existing if r.get("barcode")}
        for it in items:
            m = by_code.get(it.get("barcode"))
            if m:
                it["match_type"] = "update"
                it["matched_item_id"] = m["id"]
                it["matched_snapshot"] = m
            else:
                it["match_type"] = "new"
        return items

    async def _match_supplier(supplier: dict) -> dict:
        """Suggest an existing supplier row by fuzzy name match. Returns the
        supplier dict + suggested_supplier_id / matched_supplier_id."""
        name = (supplier.get("name") or "").strip()
        if not name:
            return supplier
        rx = re.escape(name.split()[0])  # first word is usually distinctive
        cand = await db.suppliers.find_one(
            {"name": {"$regex": rx, "$options": "i"}},
            {"_id": 0, "id": 1, "name": 1},
        )
        if cand:
            supplier["suggested_supplier_id"] = cand["id"]
            supplier["suggested_supplier_name"] = cand["name"]
        return supplier

    async def _find_item(sid: str, iid: str) -> tuple[dict, dict, int]:
        sess = await _load_session(sid)
        for idx, it in enumerate(sess.get("items") or []):
            if it["id"] == iid:
                return sess, it, idx
        raise HTTPException(status_code=404, detail="Item not found in this scan")

    def _save_item(sid: str, idx: int, patch: dict):
        set_ops = {f"items.{idx}.{k}": v for k, v in patch.items()}
        set_ops["updated_at"] = datetime.now(timezone.utc).isoformat()
        return db.invoice_scans.update_one({"id": sid}, {"$set": set_ops})

    async def _recompute_status(sid: str):
        """Close the session automatically when every row is handled."""
        s = await _load_session(sid)
        left = [it for it in (s.get("items") or []) if it["status"] == "pending"]
        if not left:
            waiting = any(it["status"] == "waiting" for it in (s.get("items") or []))
            new_status = "waiting" if waiting else "closed"
            await db.invoice_scans.update_one({"id": sid}, {"$set": {"status": new_status}})

    # ---------- endpoints ----------

    @router.post("/invoice")
    async def scan_invoice(
        file: UploadFile = File(...),
        engine: str = Form(_DEFAULT_ENGINE),
        user: dict = Depends(edit_dep),
    ):
        """Upload a PDF or image, run vision OCR, return a fresh scan session."""
        if engine not in _ENGINE_MAP:
            raise HTTPException(status_code=400, detail=f"Unknown engine '{engine}'. Allowed: {sorted(_ENGINE_MAP)}")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File too large (max 20 MB)")

        mime = (file.content_type or "").lower()
        fname = (file.filename or "upload").lower()
        is_pdf = mime == "application/pdf" or fname.endswith(".pdf")
        is_img = mime.startswith("image/") or fname.rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "webp", "heic")

        if not (is_pdf or is_img):
            raise HTTPException(status_code=400, detail="Only PDF or image files are supported")

        if is_pdf:
            try:
                pages = _pdf_to_page_images(raw, max_pages=6, dpi=150)
            except Exception as e:
                logger.exception("PDF rasterisation failed")
                raise HTTPException(status_code=400, detail=f"Could not read PDF: {str(e)[:200]}")
            if not pages:
                raise HTTPException(status_code=400, detail="PDF has no pages")
        else:
            pages = [raw]

        # Save the original file to Object Storage for audit (best-effort).
        storage_path = ""
        try:
            from backup import _put_object
            ext = fname.rsplit(".", 1)[-1] if "." in fname else ("pdf" if is_pdf else "png")
            storage_path = f"pitstock/invoice-scans/{uuid.uuid4()}.{ext}"
            _put_object(storage_path, raw, mime or "application/octet-stream")
        except Exception as e:
            logger.warning(f"Object-storage save skipped: {e}")
            storage_path = ""

        parsed = await _run_vision(pages, engine=engine)

        raw_items = parsed.get("items") if isinstance(parsed.get("items"), list) else []
        items = [_normalise_item(it) for it in raw_items if it.get("name")]
        items = await _match_barcodes(items)
        supplier = await _match_supplier(parsed.get("supplier") or {})

        sid = str(uuid.uuid4())
        doc = {
            "id": sid,
            "filename": file.filename or "upload",
            "mime": mime,
            "storage_path": storage_path,
            "engine": engine if engine in _ENGINE_MAP else _DEFAULT_ENGINE,
            "supplier": supplier,
            "invoice_number": (parsed.get("invoice_number") or "").strip(),
            "invoice_date":   (parsed.get("invoice_date") or "").strip(),
            "currency":       (parsed.get("currency") or "EUR").strip(),
            "total_amount":   round(_num(parsed.get("total_amount")), 2),
            "confidence":     _num(parsed.get("confidence")),
            "notes":          (parsed.get("notes") or "").strip(),
            "items":          items,
            "status":         "open",   # open | waiting | closed
            "created_at":     datetime.now(timezone.utc).isoformat(),
            "created_by":     user["id"],
            "created_by_name": user.get("name") or user.get("email"),
        }
        await db.invoice_scans.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @router.get("/sessions")
    async def list_sessions(status: Optional[str] = None,
                            user: dict = Depends(require_permission("inventory.view"))):
        """List scan sessions.  `status=open|waiting|closed` filters; default =
        everything not fully closed so the UI can badge "in progress" work."""
        q: dict = {}
        if status:
            q["status"] = status
        else:
            q["status"] = {"$in": ["open", "waiting"]}
        rows = await db.invoice_scans.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
        return rows

    @router.get("/sessions/{sid}")
    async def get_session(sid: str, user: dict = Depends(require_permission("inventory.view"))):
        return await _load_session(sid)

    @router.get("/sessions/{sid}/file")
    async def download_scan_file(sid: str, user: dict = Depends(require_permission("inventory.view"))):
        """Stream the original uploaded PDF/image (audit trail)."""
        s = await _load_session(sid)
        path = s.get("storage_path")
        if not path:
            raise HTTPException(status_code=404, detail="Original file was not stored")
        try:
            from backup import _get_object
            data = _get_object(path)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Storage error: {str(e)[:120]}")
        return Response(
            content=data,
            media_type=s.get("mime") or "application/octet-stream",
            headers={"Content-Disposition": f'inline; filename="{s.get("filename", "scan")}"'},
        )

    @router.patch("/sessions/{sid}/items/{iid}")
    async def patch_scan_item(sid: str, iid: str, payload: ScanItemPatch,
                              user: dict = Depends(edit_dep)):
        _sess, it, idx = await _find_item(sid, iid)
        if it["status"] not in ("pending", "waiting"):
            raise HTTPException(status_code=400, detail="Only pending / waiting items can be edited")
        # `exclude_unset=True` keeps EXPLICIT falsy edits (empty string,
        # cost_price=0) while still ignoring keys the caller didn't send —
        # `v is not None` would silently drop those legitimate resets.
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return {"ok": True, "no_change": True}
        # Barcode can change → re-run the match
        if "barcode" in updates:
            code = re.sub(r"\D", "", str(updates.get("barcode") or ""))
            updates["barcode"] = code
            if code:
                m = await db.inventory.find_one({"barcode": code}, {"_id": 0, "id": 1, "name": 1})
                updates["match_type"] = "update" if m else "new"
                updates["matched_item_id"] = m["id"] if m else None
            else:
                updates["match_type"] = "new"
                updates["matched_item_id"] = None
        await _save_item(sid, idx, updates)
        return {"ok": True, **updates}

    @router.post("/sessions/{sid}/items/{iid}/enter")
    async def enter_scan_item(sid: str, iid: str, payload: ScanItemEnter,
                              user: dict = Depends(edit_dep)):
        """Commit the row to inventory.  If the barcode already exists we
        BUMP quantity + refresh cost/selling; otherwise we create a fresh row."""
        sess, it, idx = await _find_item(sid, iid)
        if it["status"] not in ("pending", "waiting"):
            raise HTTPException(status_code=400, detail="Item already handled")

        p = payload.model_dump()
        merged = {**it, **{k: v for k, v in p.items() if v is not None}}
        # Barcode / SKU coercion
        merged["barcode"] = re.sub(r"\D", "", str(merged.get("barcode") or ""))
        qty_total = int(merged.get("quantity") or 0)
        enter_qty = int(p.get("enter_partial_qty") or qty_total)
        if enter_qty <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be positive")
        if enter_qty > qty_total:
            enter_qty = qty_total
        remaining = qty_total - enter_qty

        supplier_id = p.get("supplier_id") or sess.get("supplier", {}).get("suggested_supplier_id") or None

        # Prefer the fresh live match — user might have edited the barcode.
        existing = None
        if merged.get("barcode"):
            existing = await db.inventory.find_one({"barcode": merged["barcode"]}, {"_id": 0})

        if existing:
            new_qty = int(existing.get("quantity") or 0) + enter_qty
            # Use explicit None check so a legitimate 0.00 override is honoured
            # (`... or existing.get(...)` used to silently swallow that).
            new_cost = merged.get("cost_price") if merged.get("cost_price") is not None else existing.get("cost_price")
            new_sell = merged.get("selling_price") if merged.get("selling_price") is not None else existing.get("selling_price")
            set_ops = {
                "quantity":       new_qty,
                "cost_price":     new_cost,
                "selling_price":  new_sell,
                "updated_at":     datetime.now(timezone.utc).isoformat(),
            }
            if supplier_id and not existing.get("supplier_id"):
                set_ops["supplier_id"] = supplier_id
            await db.inventory.update_one({"id": existing["id"]}, {"$set": set_ops})
            inv_id = existing["id"]
        else:
            inv_id = str(uuid.uuid4())
            doc = {
                "id":             inv_id,
                "sku":            merged.get("sku") or _generate_sku(),
                "barcode":        merged.get("barcode") or _generate_barcode(),
                "name":           merged.get("name") or "",
                "name_ar":        merged.get("name_ar") or "",
                "category":       merged.get("category") or "General",
                "description":    "",
                "notes":          merged.get("notes") or "",
                "cost_price":     float(merged.get("cost_price") or 0),
                "selling_price":  float(merged.get("selling_price") or 0),
                "quantity":       enter_qty,
                "reorder_point":  5,
                "unit":           merged.get("unit") or "pcs",
                "supplier_id":    supplier_id,
                "location":       "",
                "compatible_vehicles": "",
                "parent_id":      None,
                "created_at":     datetime.now(timezone.utc).isoformat(),
                # Audit — link the inventory row back to the scan doc.
                "source_scan_id":  sid,
                "source_scan_file": sess.get("filename"),
            }
            await db.inventory.insert_one(doc)

        # Log a purchase-transaction row so cost accounting still lines up.
        try:
            await db.transactions.insert_one({
                "id":            str(uuid.uuid4()),
                "type":          "IN",
                "item_id":       inv_id,
                "item_name":     merged.get("name") or "",
                "item_sku":      merged.get("sku") or "",
                "quantity":      enter_qty,
                "unit_price":    float(merged.get("cost_price") or 0),
                "total":         round(float(merged.get("cost_price") or 0) * enter_qty, 2),
                "item_cost":     float(merged.get("cost_price") or 0),
                "supplier_id":   supplier_id,
                "supplier_name": sess.get("supplier", {}).get("name") or "",
                "customer_id":   None,
                "customer_name": "",
                "note":          f"AI-scan {sess.get('invoice_number') or sess.get('filename', '')}",
                "internal_use":  False,
                "internal_reason": "",
                "created_by":    user["id"],
                "created_by_name": user.get("name") or user.get("email") or "",
                "created_at":    datetime.now(timezone.utc).isoformat(),
            })
        except Exception as e:
            logger.warning(f"transactions log failed: {e}")

        # Update the scan row.  If a partial delivery was entered, decrement
        # `quantity` and keep it waiting for the rest.
        now_iso = datetime.now(timezone.utc).isoformat()
        if remaining > 0:
            patch = {
                "quantity":        remaining,
                "status":          "waiting",
                "entered_qty":     int(it.get("entered_qty") or 0) + enter_qty,
                "entered_item_id": inv_id,
            }
        else:
            patch = {
                "status":          "entered",
                "entered_qty":     int(it.get("entered_qty") or 0) + enter_qty,
                "entered_item_id": inv_id,
                "entered_at":      now_iso,
                "entered_by":      user["id"],
            }
        await _save_item(sid, idx, patch)
        await _recompute_status(sid)

        return {"ok": True, "inventory_item_id": inv_id, "match": "update" if existing else "new",
                "entered_qty": enter_qty, "remaining": remaining}

    @router.post("/sessions/{sid}/items/{iid}/wait")
    async def wait_scan_item(sid: str, iid: str, user: dict = Depends(edit_dep)):
        _sess, it, idx = await _find_item(sid, iid)
        if it["status"] not in ("pending", "waiting"):
            raise HTTPException(status_code=400, detail="Only pending items can be paused")
        await _save_item(sid, idx, {"status": "waiting"})
        await _recompute_status(sid)
        return {"ok": True, "status": "waiting"}

    @router.post("/sessions/{sid}/items/{iid}/delete")
    async def delete_scan_item(sid: str, iid: str, user: dict = Depends(edit_dep)):
        _sess, it, idx = await _find_item(sid, iid)
        # Guard: `entered` rows already added stock to inventory — flipping them
        # to `deleted` would lie about what happened.  Only pending / waiting
        # rows may be dropped (and `deleted` is idempotent so re-hitting it
        # is a no-op).
        if it["status"] == "entered":
            raise HTTPException(status_code=400, detail="Cannot delete — this row has already been added to inventory")
        if it["status"] == "deleted":
            return {"ok": True, "status": "deleted", "no_change": True}
        await _save_item(sid, idx, {"status": "deleted", "deleted_at": datetime.now(timezone.utc).isoformat()})
        await _recompute_status(sid)
        return {"ok": True, "status": "deleted"}

    @router.post("/sessions/{sid}/close")
    async def close_session(sid: str, user: dict = Depends(edit_dep)):
        """Force-close a session even if some rows are still waiting — used
        when the owner decides the rest will never arrive."""
        s = await _load_session(sid)
        for idx, it in enumerate(s.get("items") or []):
            if it["status"] in ("pending", "waiting"):
                await _save_item(sid, idx, {"status": "deleted", "deleted_at": datetime.now(timezone.utc).isoformat()})
        await db.invoice_scans.update_one({"id": sid}, {"$set": {"status": "closed"}})
        return {"ok": True}

    @router.get("/waiting")
    async def list_waiting(user: dict = Depends(require_permission("inventory.view"))):
        """Flat view of every `waiting` row across every open scan session —
        drives the "⏳ Wachtend" tab so the owner sees at a glance what's still
        expected from earlier deliveries."""
        rows = await db.invoice_scans.find(
            {"status": {"$in": ["open", "waiting"]}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(300)
        out = []
        for s in rows:
            for it in s.get("items") or []:
                if it["status"] == "waiting":
                    out.append({
                        "session_id":     s["id"],
                        "item_id":        it["id"],
                        "supplier_name":  s.get("supplier", {}).get("name") or "",
                        "invoice_number": s.get("invoice_number") or "",
                        "invoice_date":   s.get("invoice_date") or "",
                        "filename":       s.get("filename") or "",
                        "scanned_at":     s.get("created_at") or "",
                        "name":           it.get("name") or "",
                        "barcode":        it.get("barcode") or "",
                        "quantity":       it.get("quantity") or 0,
                        "cost_price":     it.get("cost_price") or 0,
                        "selling_price":  it.get("selling_price") or 0,
                        "match_type":     it.get("match_type") or "new",
                    })
        return out

    return router
