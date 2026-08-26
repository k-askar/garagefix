"""
SaaS billing — invoices the platform bills each garage for its subscription.

Every time the daily `subscription-sweep` cron sees a garage entering its
last 7 days, we auto-generate a small PDF invoice for the next billing
window and attach it to the payment-reminder email so the garage owner can
pay in one click without contacting support.

Data model:
    saas_invoices:
      id, tenant_id, invoice_number ("GF-2026-042")
      period_start, period_end (ISO dates)
      plan ("trial"|"starter"|"pro"), amount (EUR), currency
      status ("draft"|"sent"|"paid")
      created_at, sent_at, paid_at, pdf_base64 (cached bytes for resend)

Endpoints (super_admin only):
    GET  /api/saas-invoices                       — list all
    POST /api/saas-invoices/generate/{tenant_id}  — force-generate manually
    POST /api/saas-invoices/{id}/mark-paid
    GET  /api/saas-invoices/{id}/pdf              — download the PDF
"""
from __future__ import annotations

import base64
import io
import logging
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Monthly price per plan (EUR).  Kept here so the platform owner can bump
# prices with a single edit; if you ever want per-tenant overrides, add a
# `plan_price_eur` field to the tenant document and prefer it below.
PLAN_PRICE_EUR = {
    "trial":   0.0,
    "starter": 29.0,
    "pro":     79.0,
}


def _next_invoice_number(existing_count: int) -> str:
    """GF-2026-0042 style — year + sequence."""
    y = date.today().year
    return f"GF-{y}-{(existing_count + 1):04d}"


def _generate_pdf(invoice: dict, tenant: dict) -> bytes:
    """Build a clean A4 PDF for the SaaS invoice using reportlab.
    Reportlab is pure-Python and pip-installable — no system deps needed."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.enums import TA_RIGHT

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="Right", parent=styles["Normal"], alignment=TA_RIGHT))
    right_muted = ParagraphStyle("RightMuted", parent=styles["Normal"], alignment=TA_RIGHT, textColor=colors.grey, fontSize=9)
    big = ParagraphStyle("Big", parent=styles["Heading1"], fontSize=22, spaceAfter=4, textColor=colors.HexColor("#0EA5E9"))
    muted = ParagraphStyle("Muted", parent=styles["Normal"], textColor=colors.grey, fontSize=9)

    story = []

    # Header — platform brand + invoice metadata
    header_data = [[
        Paragraph("<b>GarageFix Workshop OS</b><br/>Platform billing", styles["Normal"]),
        Paragraph(
            f"<font size=18><b>INVOICE</b></font><br/>"
            f"<font size=10>{invoice['invoice_number']}</font><br/>"
            f"<font size=8 color='grey'>Issued {invoice['period_start']}</font>",
            right_muted,
        ),
    ]]
    header_tbl = Table(header_data, colWidths=[95 * mm, 75 * mm])
    header_tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(header_tbl)
    story.append(Spacer(1, 14))
    story.append(Table([[""]], colWidths=[170 * mm], style=TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 1.2, colors.HexColor("#0EA5E9")),
    ])))
    story.append(Spacer(1, 10))

    # Billed-to block
    story.append(Paragraph("<b>BILLED TO</b>", muted))
    story.append(Paragraph(f"<b>{(tenant.get('name') or '').strip()}</b>", styles["Normal"]))
    story.append(Paragraph(tenant.get("owner_email") or "", styles["Normal"]))
    story.append(Paragraph(f"Country: {tenant.get('country') or 'NL'}", styles["Normal"]))
    story.append(Spacer(1, 14))

    # Line-items table
    plan = (invoice.get("plan") or "starter").title()
    period = f"{invoice['period_start']} → {invoice['period_end']}"
    amount = float(invoice["amount"] or 0)
    line = [
        ["Description", "Period", "Amount"],
        [f"GarageFix — {plan} plan", period, f"€ {amount:.2f}"],
    ]
    tbl = Table(line, colWidths=[85 * mm, 55 * mm, 30 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F5F5F5")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#333")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#DDD")),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 8))

    # Totals
    totals = [
        ["Subtotal", f"€ {amount:.2f}"],
        ["VAT (0%)", "€ 0.00"],
        ["Total due", f"€ {amount:.2f}"],
    ]
    tot_tbl = Table(totals, colWidths=[140 * mm, 30 * mm])
    tot_tbl.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LINEABOVE", (0, 2), (-1, 2), 1, colors.HexColor("#0EA5E9")),
        ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 2), (-1, 2), colors.HexColor("#0EA5E9")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tot_tbl)
    story.append(Spacer(1, 20))

    # Footer
    story.append(Paragraph(
        f"Payment is due before <b>{invoice['period_start']}</b>. "
        "Once received, your workspace stays active without interruption.",
        muted,
    ))
    story.append(Spacer(1, 20))
    story.append(Paragraph("Thank you for choosing GarageFix — Workshop OS.", muted))

    doc.build(story)
    return buf.getvalue()


class GenerateBody(BaseModel):
    plan: Optional[str] = None
    amount: Optional[float] = None


async def _create_saas_invoice(db, tenant: dict, *, plan: Optional[str] = None, amount: Optional[float] = None):
    """Materialise a new SaaS invoice document for the given tenant and
    cache the PDF bytes inside the doc so future email attaches or downloads
    don't re-render.  Idempotent per (tenant_id, period_start) — if we
    already generated one for the current expiry date, return the existing."""
    raw_db = getattr(db, "_db", db)
    exp = tenant.get("subscription_expires_at")
    # Bill for the NEXT month starting from the current expiry.
    try:
        start = date.fromisoformat(exp) if exp else date.today()
    except Exception:
        start = date.today()
    end = start + timedelta(days=30)
    period_start = start.isoformat()

    existing = await raw_db.saas_invoices.find_one({"tenant_id": tenant["id"], "period_start": period_start})
    if existing:
        return existing

    tenant_plan = plan or tenant.get("plan") or "starter"
    price = amount if amount is not None else PLAN_PRICE_EUR.get(tenant_plan, PLAN_PRICE_EUR["starter"])
    seq = await raw_db.saas_invoices.count_documents({})
    inv = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant["id"],
        "invoice_number": _next_invoice_number(seq),
        "period_start": period_start,
        "period_end": end.isoformat(),
        "plan": tenant_plan,
        "amount": float(price),
        "currency": "EUR",
        "status": "draft",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sent_at": None,
        "paid_at": None,
    }
    try:
        pdf_bytes = _generate_pdf(inv, tenant)
        inv["pdf_base64"] = base64.b64encode(pdf_bytes).decode()
    except Exception as e:
        logger.warning(f"SaaS invoice PDF gen failed for {tenant.get('name')}: {e}")
        inv["pdf_base64"] = None
    await raw_db.saas_invoices.insert_one(inv)
    inv.pop("_id", None)
    return inv


def register(db, require_super_admin):
    router = APIRouter()

    @router.get("/saas-invoices")
    async def list_saas_invoices(user: dict = Depends(require_super_admin)):
        raw_db = getattr(db, "_db", db)
        cursor = raw_db.saas_invoices.find({}, {"_id": 0, "pdf_base64": 0}).sort("created_at", -1)
        rows = await cursor.to_list(500)
        # Enrich with tenant name for the UI.
        tenants = {t["id"]: t async for t in raw_db.tenants.find({}, {"_id": 0})}
        for r in rows:
            t = tenants.get(r.get("tenant_id")) or {}
            r["tenant_name"] = t.get("name") or "—"
            r["tenant_email"] = t.get("owner_email") or ""
        return rows

    @router.post("/saas-invoices/generate/{tenant_id}")
    async def generate_saas_invoice(tenant_id: str, payload: GenerateBody = GenerateBody(), user: dict = Depends(require_super_admin)):
        raw_db = getattr(db, "_db", db)
        t = await raw_db.tenants.find_one({"id": tenant_id}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Tenant not found")
        inv = await _create_saas_invoice(db, t, plan=payload.plan, amount=payload.amount)
        inv.pop("pdf_base64", None)
        return inv

    @router.post("/saas-invoices/{invoice_id}/mark-paid")
    async def mark_saas_invoice_paid(invoice_id: str, user: dict = Depends(require_super_admin)):
        raw_db = getattr(db, "_db", db)
        res = await raw_db.saas_invoices.update_one(
            {"id": invoice_id},
            {"$set": {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat()}},
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Invoice not found")
        return {"ok": True}

    @router.get("/saas-invoices/{invoice_id}/pdf")
    async def download_saas_invoice_pdf(invoice_id: str, user: dict = Depends(require_super_admin)):
        raw_db = getattr(db, "_db", db)
        row = await raw_db.saas_invoices.find_one({"id": invoice_id})
        if not row:
            raise HTTPException(status_code=404, detail="Invoice not found")
        b64 = row.get("pdf_base64")
        if not b64:
            # Regenerate on demand if the cached PDF got lost.
            t = await raw_db.tenants.find_one({"id": row.get("tenant_id")}, {"_id": 0}) or {}
            pdf = _generate_pdf(row, t)
        else:
            pdf = base64.b64decode(b64)
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{row.get("invoice_number", "invoice")}.pdf"'},
        )

    return router
