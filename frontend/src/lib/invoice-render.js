/**
 * Single source of truth for how a printable / downloadable invoice looks.
 * Used by:
 *   - Invoices.jsx  ->  printInvoice (window.open + print)
 *   - Invoices.jsx  ->  Download PDF button
 *   - Invoices.jsx  ->  Bulk PDF download (ZIP of PDFs)
 *   - Reports/other flows via invoice-zip.js
 *
 * All values come from the garage `settings` doc so the owner can
 * customise the look from /settings.
 */
import QRCode from "qrcode";
import { formatEUR } from "@/lib/api";

/** Format a euro amount honouring the settings.invoice_currency_symbol_pos toggle. */
function fmtMoney(amount, settings) {
  const pos = settings?.invoice_currency_symbol_pos || "suffix";
  if (pos === "prefix") {
    // "€ 12.50" — English-style with a leading euro sign
    const v = (Number(amount) || 0).toFixed(2);
    return `€ ${v}`;
  }
  // Default Dutch/European suffix formatting via existing helper (e.g. "12,50 €")
  return formatEUR(amount);
}

/* ------------------------- helpers ------------------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function extractPlate(note) {
  if (!note) return null;
  const matches = String(note).match(/\b[A-Z0-9]+(?:-[A-Z0-9]+){1,3}\b/gi) || [];
  const candidates = matches.filter((m) => !/^JOB-/i.test(m));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/* Compact Dutch-style yellow plate — much smaller than the old 22 px one. */
function plateHtml(plate) {
  if (!plate) return "";
  return `<span style="display:inline-flex;align-items:center;gap:0;vertical-align:middle;
    padding:2px 8px;background:#FFC900;color:#000;border:1px solid #000;border-radius:3px;
    font-family:'Arial Black',Impact,'Helvetica Neue',sans-serif;font-weight:900;
    font-size:12px;letter-spacing:0.06em;line-height:1.15;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <span style="background:#003399;color:#fff;font-size:8px;padding:1px 3px;margin-right:6px;
                 border-radius:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">NL</span>
    ${esc(String(plate).toUpperCase())}
  </span>`;
}

function noteWithPlate(note, showPlate) {
  if (!note) return "";
  if (!showPlate) return esc(note);
  const plate = extractPlate(note);
  if (!plate) return esc(note);
  const idx = note.lastIndexOf(plate);
  return `${esc(note.slice(0, idx))}${plateHtml(plate)}`;
}

/* Absolute URL for a settings.logo_url that may be:
   - "/api/settings/logo-file?path=..."  (Emergent Object Storage — now public)
   - "https://..."                        (external URL)
   - "/logo-shawish.png"                  (bundled asset) */
function absoluteLogo(logoUrl) {
  if (!logoUrl) return "";
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  const base = process.env.REACT_APP_BACKEND_URL || "";
  return `${base}${logoUrl}`;
}

/* Preload the logo as a base64 data URI so html2canvas / print never miss it
   (works even if the object-storage host has odd CORS). */
async function logoAsDataUrl(logoUrl) {
  if (!logoUrl) return "";
  try {
    const url = absoluteLogo(logoUrl);
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return url; // fall back to plain <img src>
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(url);
      r.readAsDataURL(blob);
    });
  } catch {
    return absoluteLogo(logoUrl);
  }
}

/* SEPA EPC "GiroCode" QR payload (EPC069-12).  Line separator is LF. */
function sepaPayload({ iban, bic, name, amount, reference }) {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const cleanIban = String(iban || "").replace(/\s+/g, "").toUpperCase();
  const amt = Math.max(0, Number(amount) || 0).toFixed(2);
  return [
    "BCD", "002", "1", "SCT",
    clean(bic).toUpperCase(),
    clean(name).slice(0, 70),
    cleanIban,
    `EUR${amt}`,
    "",       // Purpose (optional)
    "",       // Structured Reference (optional)
    clean(reference).slice(0, 140),   // Unstructured Remittance
    "",       // Beneficiary-to-originator information
  ].join("\n");
}

async function sepaQrDataUrl(inv, settings) {
  const iban = String(settings?.iban || "").replace(/\s+/g, "");
  if (!iban || !(settings?.invoice_show_qr ?? true) || !inv?.total) return "";
  try {
    const payload = sepaPayload({
      iban,
      bic: settings?.bic,
      name: settings?.name || "Garage",
      amount: inv.total,
      reference: inv.invoice_number,
    });
    return await QRCode.toDataURL(payload, {
      margin: 1,
      width: 180,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return "";
  }
}

/* ------------------------- main renderer ------------------------- */
/* Per-template style bundle: colors, borders and header layout. */
function templateStyles(name, accent) {
  switch (name) {
    case "minimal":
      return {
        bodyCss: `padding:36px;color:#111;max-width:720px;margin:0 auto;background:#fff;
          font-family:'Helvetica Neue',Arial,sans-serif;font-weight:300;-webkit-print-color-adjust:exact;print-color-adjust:exact`,
        headerCss: `border-bottom:1px solid #eaeaea;padding-bottom:14px`,
        h1Css: `font-size:18px;margin:0;font-weight:400;letter-spacing:.02em`,
        thBg: "#fafafa", thColor: "#666",
        badgeCss: `background:transparent;color:${accent};border:1px solid ${accent};font-weight:600`,
        accentRule: `border-top:1px solid ${accent};margin:14px 0`,
        totalHighlight: "",
        bankBlockBg: "#fbfbfb",
      };
    case "bold":
      return {
        bodyCss: `padding:0;color:#111;max-width:720px;margin:0 auto;background:#fff;
          font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact`,
        headerCss: `background:${accent};color:#fff;padding:26px 32px;margin-bottom:0`,
        h1Css: `font-size:26px;margin:0;font-weight:900;letter-spacing:-.01em;color:#fff`,
        thBg: `${accent}22`, thColor: "#333",
        badgeCss: `background:#fff;color:${accent};font-weight:800`,
        accentRule: `height:6px;background:${accent};border:none;margin:0`,
        totalHighlight: `background:${accent}12;padding:10px 14px;border-radius:6px;display:inline-block;margin-top:6px`,
        bankBlockBg: `${accent}0d`,
        wrapPadding: "0 32px 32px",
      };
    case "classic":
    default:
      return {
        bodyCss: `padding:32px;color:#111;max-width:720px;margin:0 auto;background:#fff;
          font-family:-apple-system,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact`,
        headerCss: ``,
        h1Css: `font-size:20px;margin:0`,
        thBg: "#f5f5f5", thColor: "#111",
        badgeCss: `background:${accent};color:#fff`,
        accentRule: `border:none;border-top:2px solid ${accent};margin:16px 0`,
        totalHighlight: "",
        bankBlockBg: "#fafafa",
      };
  }
}

/**
 * @returns {Promise<string>} full HTML document ready to open in a new window
 *   or feed into html2canvas.
 */
export async function renderInvoiceHtml(inv, settings) {
  const s = settings || {};
  const accent = s.invoice_accent_color || "#0EA5E9";
  const tpl = templateStyles(s.invoice_template || "classic", accent);
  const showPlate = s.show_plate_badge !== false;
  const showQr = s.invoice_show_qr !== false;
  const headerAlign = s.invoice_header_align || "left";
  const [logoData, qrData] = await Promise.all([
    logoAsDataUrl(s.logo_url),
    showQr ? sepaQrDataUrl(inv, s) : Promise.resolve(""),
  ]);

  const rows = (inv.lines || []).map((l) => `
    <tr>
      <td>${esc(l.name)}<div style="font-size:10px;color:#888">${esc(l.sku || "")}</div></td>
      <td class="right">${l.quantity}</td>
      <td class="right">${fmtMoney(l.unit_price, s)}</td>
      <td class="right">${fmtMoney(l.total, s)}</td>
    </tr>`).join("");

  const paidBadge = inv.status === "paid" ? "paid" : "";
  const paidLabel = inv.status === "paid" ? "PAID" : "INVOICE";

  const bankBlock = (s.iban || s.bank_name || s.bic) ? `
    <div style="margin-top:14px;padding:10px 12px;border:1px solid #eee;border-radius:6px;background:${tpl.bankBlockBg};
                display:flex;justify-content:space-between;gap:16px;align-items:center;">
      <div style="font-size:11px;color:#333;line-height:1.5">
        <div style="font-size:9px;color:#888;letter-spacing:.1em;text-transform:uppercase">Payment details</div>
        ${s.bank_name ? `<div><strong>${esc(s.bank_name)}</strong></div>` : ""}
        ${s.iban ? `<div style="font-family:monospace">IBAN&nbsp;${esc(s.iban)}</div>` : ""}
        ${s.bic ? `<div style="font-family:monospace">BIC&nbsp;${esc(s.bic)}</div>` : ""}
        <div style="color:#666;margin-top:2px">Reference: <strong>${esc(inv.invoice_number)}</strong></div>
      </div>
      ${qrData ? `<div style="text-align:center;flex-shrink:0">
        <img src="${qrData}" alt="SEPA QR" style="width:96px;height:96px;display:block"/>
        <div style="font-size:8px;color:#888;letter-spacing:.1em;margin-top:2px;text-transform:uppercase">Scan to pay</div>
      </div>` : ""}
    </div>` : "";

  const headerRight = `
    <div style="text-align:right">
      <span class="badge ${paidBadge}">${paidLabel}</span>
      <div style="font-size:14px;margin-top:6px;font-weight:700">${esc(inv.invoice_number)}</div>
      <div class="muted">${new Date(inv.created_at).toLocaleDateString("en-GB")}</div>
    </div>`;

  const headerLeft = `
    <div style="display:flex;gap:12px;align-items:flex-start">
      ${logoData ? `<img src="${logoData}" alt="logo" style="height:52px;width:auto;object-fit:contain"/>` : ""}
      <div>
        <h1 class="doc-h1">${esc(s.name || "Garage")}</h1>
        <div class="muted">${esc(s.address || "").replace(/\n/g, "<br/>")}</div>
        <div class="muted">${esc(s.phone || "")}${s.email ? " · " + esc(s.email) : ""}</div>
        ${s.tax_id ? `<div class="muted">BTW: ${esc(s.tax_id)}</div>` : ""}
        ${s.kvk_number ? `<div class="muted">KvK: ${esc(s.kvk_number)}</div>` : ""}
      </div>
    </div>`;

  const alignJustify =
    headerAlign === "center" ? "center" :
    headerAlign === "right" ? "flex-end" : "space-between";
  const headerInner = headerAlign === "left"
    ? `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">${headerLeft}${headerRight}</div>`
    : `<div style="display:flex;flex-direction:column;align-items:${headerAlign === "center" ? "center" : "flex-end"};gap:10px;text-align:${headerAlign}">${headerLeft}${headerRight}</div>`;
  const headerBlock = `<div class="doc-header">${headerInner}</div>`;
  const wrapOpen = tpl.wrapPadding ? `<div style="padding:${tpl.wrapPadding}">` : "";
  const wrapClose = tpl.wrapPadding ? `</div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(inv.invoice_number)}</title>
    <style>
      body{${tpl.bodyCss}}
      .doc-header{${tpl.headerCss}}
      .doc-h1{${tpl.h1Css}}
      .muted{color:#666;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:13px;vertical-align:top}
      th{background:${tpl.thBg};color:${tpl.thColor}}
      .right{text-align:right}
      .badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:10px;letter-spacing:.1em;${tpl.badgeCss};
             -webkit-print-color-adjust:exact;print-color-adjust:exact}
      .badge.paid{background:#22c55e;color:#fff}
      .totrow{font-size:15px;font-weight:700}
      hr.accent{${tpl.accentRule}}
      .terms{margin-top:16px;font-size:10px;color:#666;white-space:pre-line;border-top:1px solid #eee;padding-top:8px}
      @media print{*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}}
    </style></head><body>
    ${headerBlock}
    <hr class="accent"/>
    ${wrapOpen}
    <div class="muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:10px">Bill to</div>
    <div style="font-size:15px;font-weight:600;margin-top:4px">${esc(inv.customer_name || "Walk-in customer")}</div>
    <table><thead><tr>
      <th>Item</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="margin-top:16px;text-align:right">
      <div class="muted">Subtotal: ${fmtMoney(inv.subtotal, s)}</div>
      ${inv.tax ? `<div class="muted">BTW: ${fmtMoney(inv.tax, s)}</div>` : ""}
      <div class="totrow" style="margin-top:4px"><span style="${tpl.totalHighlight}">Total: ${fmtMoney(inv.total, s)}</span></div>
    </div>
    ${inv.note ? `<p class="muted" style="margin-top:20px">${noteWithPlate(inv.note, showPlate)}</p>` : ""}
    ${bankBlock}
    <p class="muted" style="margin-top:8px">Payment due within ${s.payment_terms_days || 14} days${inv.due_date ? ` (by ${esc(inv.due_date)})` : ""}.</p>
    ${s.invoice_terms ? `<div class="terms">${esc(s.invoice_terms)}</div>` : ""}
    <p class="muted" style="margin-top:24px;text-align:center">${esc(s.footer_note || "Thank you!")}</p>
    ${wrapClose}
    </body></html>`;
}
