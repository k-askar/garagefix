import { downloadHtmlAsPdf, printHtml } from "@/lib/pdf";
import { formatEUR } from "@/lib/api";

/**
 * Build a styled HTML report for a tabular list (inventory / customers / suppliers / repairs).
 * @param {object} opts
 *   title       string  - Big report title
 *   subtitle    string? - subtitle line
 *   headers     string[]
 *   rows        (string|number)[][]   - already-formatted cell values
 *   settings    { name?, address?, phone?, email?, tax_id? }
 *   lang        "en"|"nl"|"ar"
 *   dir         "ltr"|"rtl"
 *   footerNote  string?
 *   summary     { label: string, value: string }[]
 */
export function buildListReportHtml({ title, subtitle = "", headers, rows, settings = {}, dir = "ltr", footerNote = "", summary = [] }) {
  const align = dir === "rtl" ? "right" : "left";
  const bodyFont = dir === "rtl" ? "'Cairo','Amiri',system-ui,sans-serif" : "-apple-system,Helvetica,Arial,sans-serif";
  const th = headers.map((h) => `<th style="text-align:${align}">${h}</th>`).join("");
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i === 0 ? align : (dir === 'rtl' ? 'left' : 'right')}">${c ?? ""}</td>`).join("")}</tr>`).join("");
  const summaryHtml = summary.length
    ? `<div class="summary">${summary.map((s) => `<div class="stat"><div class="lbl">${s.label}</div><div class="val">${s.value}</div></div>`).join("")}</div>`
    : "";
  return `<div class="report" style="font-family:${bodyFont};color:#111;background:#fff;direction:${dir}">
    <style>
      .report { padding: 8px; }
      .report h1 { font-size: 22px; margin: 0; }
      .report .muted { color: #666; font-size: 12px; margin: 2px 0; }
      .report .row1 { display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px; }
      .report .badge { display:inline-block;padding:2px 10px;border-radius:999px;background:#111;color:#fff;font-size:10px;letter-spacing:.1em; }
      .report hr { border: none; border-top: 1px solid #e5e5e5; margin: 12px 0 16px; }
      .report table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .report th { background: #f5f5f5; padding: 8px; border-bottom: 2px solid #ddd; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #444; }
      .report td { padding: 7px 8px; border-bottom: 1px solid #eee; }
      .report tr:nth-child(2n) td { background: #fafafa; }
      .report .summary { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
      .report .stat { flex: 1; min-width: 120px; border: 1px solid #eee; border-radius: 6px; padding: 10px 12px; background: #fafafa; }
      .report .stat .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #666; }
      .report .stat .val { font-size: 16px; font-weight: 700; margin-top: 2px; }
      .report .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #eee; text-align: center; color: #888; font-size: 11px; }
    </style>
    <div class="row1">
      <div>
        <h1>${settings.name || "Garage"}</h1>
        ${settings.address ? `<div class="muted">${settings.address}</div>` : ""}
        ${settings.phone ? `<div class="muted">${settings.phone}${settings.email ? " · " + settings.email : ""}</div>` : ""}
        ${settings.tax_id ? `<div class="muted">${settings.tax_id}</div>` : ""}
      </div>
      <div style="text-align:${dir === 'rtl' ? 'left' : 'right'}">
        <span class="badge">REPORT</span>
        <div style="font-size:18px;font-weight:700;margin-top:6px">${title}</div>
        ${subtitle ? `<div class="muted">${subtitle}</div>` : ""}
        <div class="muted">${new Date().toLocaleDateString(dir === 'rtl' ? 'ar-EG' : 'en-GB')}</div>
      </div>
    </div>
    <hr />
    <table><thead><tr>${th}</tr></thead><tbody>${tr || `<tr><td colspan="${headers.length}" style="text-align:center;color:#888;padding:24px">—</td></tr>`}</tbody></table>
    ${summaryHtml}
    ${footerNote ? `<p class="footer">${footerNote}</p>` : ""}
  </div>`;
}

export async function downloadListReportPdf(args) {
  const html = buildListReportHtml(args);
  const safe = (args.title || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await downloadHtmlAsPdf(html, `${safe}-${new Date().toISOString().slice(0, 10)}.pdf`, { dir: args.dir });
}

export function printListReport(args) {
  const html = buildListReportHtml(args);
  printHtml(html, { title: args.title, dir: args.dir, lang: args.lang });
}

/**
 * Repair card single-page report.
 */
export function buildRepairCardHtml({ card, settings = {}, dir = "ltr", labels = {} }) {
  const l = {
    jobCard: "JOB CARD", customer: "Customer", vehicle: "Vehicle",
    mechanic: "Mechanic", status: "Status", complaint: "Customer complaint",
    diagnosis: "Diagnosis", workDone: "Work performed", part: "Part",
    qty: "Qty", unitPrice: "Unit price", total: "Total", noParts: "No parts",
    partsTotal: "Parts total", labor: "Labor", grandTotal: "Grand total",
    plate: "Plate", km: "km", ...labels,
  };
  const rows = (card.parts_used || []).map(p =>
    `<tr><td>${p.name}<div style="font-size:10px;color:#888;direction:ltr">${p.sku}</div></td><td class="right">${p.quantity}</td><td class="right">${formatEUR(p.unit_price)}</td><td class="right">${formatEUR(p.total)}</td></tr>`).join("");
  const bodyFont = dir === "rtl" ? "'Cairo','Amiri',system-ui,sans-serif" : "-apple-system,Helvetica,Arial,sans-serif";
  const alignEnd = dir === "rtl" ? "left" : "right";
  const logo = settings.logo_url || "/logo-shawish.png";
  const logoAbs = logo.startsWith("http") ? logo : (window.location.origin + logo);
  return `<div style="font-family:${bodyFont};color:#111;background:#fff;padding:8px;direction:${dir}">
    <style>
      .jc { max-width: 720px; }
      .jc h1 { font-size: 22px; margin: 0; }
      .jc .muted { color: #666; font-size: 12px; }
      .jc .logo-band { background:#0a0a0a; border-radius:10px; padding:14px 18px; margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
      .jc .logo-band img { max-height: 64px; width: auto; object-fit: contain; }
      .jc .logo-band .badge { background:#d4af37; color:#0a0a0a; padding:3px 12px; border-radius:999px; font-size:10px; letter-spacing:.15em; font-weight:700; }
      .jc .logo-band .num { color:#d4af37; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size:12px; margin-top:4px; direction:ltr; }
      .jc .logo-band .date { color:#999; font-size:11px; }
      .jc .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
      .jc .box { border: 1px solid #eee; border-radius: 8px; padding: 12px; background: #fafafa; }
      .jc .lbl { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #666; }
      .jc .val { font-size: 14px; font-weight: 600; margin-top: 2px; }
      .jc table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      .jc th, .jc td { padding: 8px; border-bottom: 1px solid #eee; font-size: 13px; text-align:${dir === 'rtl' ? 'right' : 'left'}; }
      .jc th { background: #f5f5f5; }
      .jc .right { text-align: ${alignEnd}; }
    </style>
    <div class="jc">
      <div class="logo-band">
        <img src="${logoAbs}" alt="logo" crossorigin="anonymous" />
        <div style="text-align:${alignEnd}">
          <span class="badge">${l.jobCard}</span>
          <div class="num">${card.card_number}</div>
          <div class="date">${new Date(card.created_at).toLocaleDateString(dir === 'rtl' ? 'ar-EG' : 'en-GB')}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div><h1>${settings.name || "Garage"}</h1><div class="muted">${settings.address || ""}</div><div class="muted">${settings.phone || ""}${settings.email ? " · " + settings.email : ""}</div></div>
      </div>
      <div class="grid">
        <div class="box"><div class="lbl">${l.customer}</div><div class="val">${card.customer_name || "—"}</div><div class="muted" style="direction:ltr">${card.customer_phone || ""}</div></div>
        <div class="box"><div class="lbl">${l.vehicle}</div><div class="val">${[card.car_make, card.car_model, card.car_year].filter(Boolean).join(" ")}</div><div class="muted">${l.plate}: ${card.car_plate || "—"} · ${card.car_color || ""} · ${card.car_km ? card.car_km + " " + l.km : ""}</div></div>
        <div class="box"><div class="lbl">${l.mechanic}</div><div class="val">${card.mechanic_name || "—"}</div></div>
        <div class="box"><div class="lbl">${l.status}</div><div class="val">${card.status}</div></div>
      </div>
      ${card.complaint ? `<div style="margin-top:16px"><div class="lbl">${l.complaint}</div><p>${card.complaint}</p></div>` : ""}
      ${card.diagnosis ? `<div style="margin-top:8px"><div class="lbl">${l.diagnosis}</div><p>${card.diagnosis}</p></div>` : ""}
      ${card.work_done ? `<div style="margin-top:8px"><div class="lbl">${l.workDone}</div><p>${card.work_done}</p></div>` : ""}
      <table><thead><tr><th>${l.part}</th><th class="right">${l.qty}</th><th class="right">${l.unitPrice}</th><th class="right">${l.total}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" style="text-align:center;color:#888;padding:16px">${l.noParts}</td></tr>`}</tbody></table>
      <div style="margin-top:16px;text-align:${alignEnd}">
        <div class="muted">${l.partsTotal}: ${formatEUR(card.parts_total)}</div>
        <div class="muted">${l.labor}: ${formatEUR(card.labor_charge)}</div>
        <div style="font-size:16px;font-weight:700;margin-top:4px">${l.grandTotal}: ${formatEUR(card.grand_total)}</div>
      </div>
    </div>
  </div>`;
}

export async function downloadRepairCardPdf(card, settings, dir = "ltr", labels = {}) {
  const html = buildRepairCardHtml({ card, settings, dir, labels });
  await downloadHtmlAsPdf(html, `${card.card_number}.pdf`, { dir });
}

export function printRepairCard(card, settings, dir = "ltr", labels = {}) {
  const html = buildRepairCardHtml({ card, settings, dir, labels });
  printHtml(html, { title: card.card_number, dir, lang: dir === "rtl" ? "ar" : "en" });
}
