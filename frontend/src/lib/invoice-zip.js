import JSZip from "jszip";
import { saveAs } from "file-saver";
import { formatEUR } from "@/lib/api";

// Match Dutch plate patterns in a free-text note (skip JOB-... card numbers)
function extractPlate(note) {
  if (!note) return null;
  const matches = String(note).match(/\b[A-Z0-9]+(?:-[A-Z0-9]+){1,3}\b/gi) || [];
  const candidates = matches.filter(m => !/^JOB-/i.test(m));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function plateHtml(plate) {
  if (!plate) return "";
  return `<span style="display:inline-block;padding:6px 18px;background:#FFCB05;color:#000;border:2px solid #000;border-radius:6px;font-family:'Arial Black',Impact,'Helvetica Neue',sans-serif;font-weight:900;font-size:22px;letter-spacing:.15em;line-height:1;text-align:center;vertical-align:middle;-webkit-print-color-adjust:exact;print-color-adjust:exact;box-shadow:inset 0 -2px 0 rgba(0,0,0,0.08)">${String(plate).toUpperCase()}</span>`;
}

function noteWithPlate(note) {
  const plate = extractPlate(note);
  if (!plate) return note ? escapeHtml(note) : "";
  const idx = note.lastIndexOf(plate);
  return `${escapeHtml(note.slice(0, idx))}${plateHtml(plate)}`;
}

/**
 * Build a lightweight HTML invoice string suitable for printing/saving as PDF.
 * Keeps parity with the on-screen printInvoice() output but as a portable file.
 */
export function invoiceToHtml(inv, settings) {
  const accent = settings?.invoice_accent_color || "#0EA5E9";
  const showPlate = settings?.show_plate_badge !== false;
  const rows = (inv.lines || []).map(l => `
    <tr>
      <td>${escapeHtml(l.name)}<div style="font-size:10px;color:#888">${escapeHtml(l.sku || "")}</div></td>
      <td class="right">${l.quantity}</td>
      <td class="right">${formatEUR(l.unit_price)}</td>
      <td class="right">${formatEUR(l.total)}</td>
    </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(inv.invoice_number)}</title>
    <style>
      body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:32px;color:#111;max-width:720px;margin:0 auto;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      h1{font-size:22px;margin:0}
      .muted{color:#666;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:13px}
      th{background:#f5f5f5}
      .right{text-align:right}
      .badge{display:inline-block;padding:2px 10px;border-radius:999px;background:${accent};color:#fff;font-size:10px;letter-spacing:.1em;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .paid{background:#22c55e}
      .totrow{font-size:15px;font-weight:700}
      hr.accent{border:none;border-top:2px solid ${accent};margin:16px 0}
      .terms{margin-top:20px;font-size:10px;color:#666;white-space:pre-line;border-top:1px solid #eee;padding-top:8px}
      @media print{*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}}
    </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div>
        <h1>${escapeHtml(settings?.name || "Garage")}</h1>
        <div class="muted">${escapeHtml(settings?.address || "").replace(/\n/g, "<br/>")}</div>
        <div class="muted">${escapeHtml(settings?.phone || "")}${settings?.email ? " · " + escapeHtml(settings.email) : ""}</div>
        ${settings?.tax_id ? `<div class="muted">BTW: ${escapeHtml(settings.tax_id)}</div>` : ""}
        ${settings?.kvk_number ? `<div class="muted">KvK: ${escapeHtml(settings.kvk_number)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <span class="badge ${inv.status === "paid" ? "paid" : ""}">${inv.status === "paid" ? "PAID" : "INVOICE"}</span>
        <div style="font-size:14px;margin-top:6px;font-weight:700">${escapeHtml(inv.invoice_number)}</div>
        <div class="muted">${new Date(inv.created_at).toLocaleDateString("en-GB")}</div>
      </div>
    </div>
    <hr class="accent"/>
    <div class="muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:10px">Bill to</div>
    <div style="font-size:15px;font-weight:600;margin-top:4px">${escapeHtml(inv.customer_name || "Walk-in customer")}</div>
    <table><thead><tr>
      <th>Item</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="margin-top:16px;text-align:right">
      <div class="muted">Subtotal: ${formatEUR(inv.subtotal)}</div>
      ${inv.tax ? `<div class="muted">BTW: ${formatEUR(inv.tax)}</div>` : ""}
      <div class="totrow" style="margin-top:4px">Total: ${formatEUR(inv.total)}</div>
    </div>
    ${inv.note ? `<p class="muted" style="margin-top:24px">${showPlate ? noteWithPlate(inv.note) : escapeHtml(inv.note)}</p>` : ""}
    ${settings?.iban ? `<p class="muted" style="margin-top:8px">Payment to IBAN: <span style="font-family:monospace">${escapeHtml(settings.iban)}</span></p>` : ""}
    <p class="muted" style="margin-top:4px">Payment due within ${settings?.payment_terms_days || 14} days${inv.due_date ? ` (by ${escapeHtml(inv.due_date)})` : ""}.</p>
    ${settings?.invoice_terms ? `<div class="terms">${escapeHtml(settings.invoice_terms)}</div>` : ""}
    <p class="muted" style="margin-top:24px;text-align:center">${escapeHtml(settings?.footer_note || "Thank you!")}</p>
    </body></html>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Build a ZIP archive with one HTML file per invoice.  HTML files open natively
 * in any browser and can be saved as PDF via Ctrl+P.
 */
export async function downloadInvoicesZip(invoices, settings, filename = "invoices.zip") {
  const zip = new JSZip();
  const folder = zip.folder(filename.replace(/\.zip$/, ""));
  for (const inv of invoices) {
    const html = invoiceToHtml(inv, settings);
    const safe = inv.invoice_number.replace(/[^A-Za-z0-9._-]/g, "_");
    folder.file(`${safe}.html`, html);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  saveAs(blob, filename);
}
