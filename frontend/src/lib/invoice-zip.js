import JSZip from "jszip";
import { saveAs } from "file-saver";
import { formatEUR } from "@/lib/api";

/**
 * Build a lightweight HTML invoice string suitable for printing/saving as PDF.
 * Keeps parity with the on-screen printInvoice() output but as a portable file.
 */
export function invoiceToHtml(inv, settings) {
  const rows = (inv.lines || []).map(l => `
    <tr>
      <td>${escapeHtml(l.name)}<div style="font-size:10px;color:#888">${escapeHtml(l.sku || "")}</div></td>
      <td class="right">${l.quantity}</td>
      <td class="right">${formatEUR(l.unit_price)}</td>
      <td class="right">${formatEUR(l.total)}</td>
    </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(inv.invoice_number)}</title>
    <style>
      body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:32px;color:#111;max-width:720px;margin:0 auto;background:#fff}
      h1{font-size:24px;margin:0}
      .muted{color:#666;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:13px}
      th{background:#f5f5f5}
      .right{text-align:right}
      .badge{display:inline-block;padding:2px 10px;border-radius:999px;background:#0ea5e9;color:#fff;font-size:10px;letter-spacing:.1em}
      .paid{background:#22c55e}
      .totrow{font-size:15px;font-weight:700}
    </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div>
        <h1>${escapeHtml(settings?.name || "Garage")}</h1>
        <div class="muted">${escapeHtml(settings?.address || "")}</div>
        <div class="muted">${escapeHtml(settings?.phone || "")}${settings?.email ? " · " + escapeHtml(settings.email) : ""}</div>
        ${settings?.tax_id ? `<div class="muted">VAT: ${escapeHtml(settings.tax_id)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <span class="badge ${inv.status === "paid" ? "paid" : ""}">${inv.status === "paid" ? "PAID" : "INVOICE"}</span>
        <div style="font-size:14px;margin-top:6px;font-weight:700">${escapeHtml(inv.invoice_number)}</div>
        <div class="muted">${new Date(inv.created_at).toLocaleDateString("en-GB")}</div>
      </div>
    </div>
    <hr style="margin:20px 0;border:none;border-top:1px solid #eee"/>
    <div class="muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:10px">Bill to</div>
    <div style="font-size:15px;font-weight:600;margin-top:4px">${escapeHtml(inv.customer_name || "Walk-in customer")}</div>
    <table><thead><tr>
      <th>Item</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="margin-top:16px;text-align:right">
      <div class="muted">Subtotal: ${formatEUR(inv.subtotal)}</div>
      ${inv.tax ? `<div class="muted">Tax (BTW): ${formatEUR(inv.tax)}</div>` : ""}
      <div class="totrow" style="margin-top:4px">Total: ${formatEUR(inv.total)}</div>
    </div>
    ${inv.note ? `<p class="muted" style="margin-top:24px">${escapeHtml(inv.note)}</p>` : ""}
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
