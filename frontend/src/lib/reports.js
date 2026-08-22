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
    qty: "Qty", unitPrice: "Unit price", total: "Total", noParts: "No parts", special: "SPECIAL",
    partsTotal: "Parts total", labor: "Labor", grandTotal: "Grand total",
    plate: "Plate", km: "km",
    timeClock: "Labor time clock", startedAt: "Started", stopped: "Stopped", duration: "Duration",
    ...labels,
  };
  const stockRows = (card.parts_used || []).map(p =>
    `<tr><td>${p.name}<div style="font-size:10px;color:#888;direction:ltr">${p.sku || ""}</div></td><td class="right">${p.quantity}</td><td class="right">${formatEUR(p.unit_price)}</td><td class="right">${formatEUR(p.total)}</td></tr>`).join("");
  const specialRows = (card.special_parts || []).map(p =>
    `<tr><td>${p.name} <span style="font-size:9px;background:#f5e7c5;color:#8a6d1a;padding:1px 6px;border-radius:6px;margin-inline-start:4px">${l.special || 'SPECIAL'}</span><div style="font-size:10px;color:#888;direction:ltr">${p.part_number || ""}${p.supplier_name ? " · " + p.supplier_name : ""}</div></td><td class="right">${p.quantity}</td><td class="right">${formatEUR(p.unit_price)}</td><td class="right">${formatEUR(p.total)}</td></tr>`).join("");
  const rows = stockRows + specialRows;
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
      ${(card.time_logs && card.time_logs.length) ? `<div style="margin-top:12px"><div class="lbl">${l.timeClock || 'Labor time clock'}</div>
        <table style="margin-top:6px"><thead><tr><th>${l.mechanic}</th><th>${l.startedAt || 'Start'}</th><th>${l.stopped || 'Stop'}</th><th class="right">${l.duration || 'Duration'}</th></tr></thead><tbody>
        ${card.time_logs.map(tl => `<tr><td>${tl.mechanic_name || '—'}</td><td>${new Date(tl.started_at).toLocaleString(dir === 'rtl' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${tl.stopped_at ? new Date(tl.stopped_at).toLocaleString(dir === 'rtl' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td class="right">${Math.round(Number(tl.minutes) || 0)} min</td></tr>`).join('')}
        </tbody></table>
        <div class="muted" style="margin-top:6px;text-align:${alignEnd}">${l.duration || 'Duration'}: ${Math.round(Number(card.labor_minutes) || 0)} min</div>
      </div>` : ""}
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

/**
 * Full customer history report (all repairs + invoices + totals).
 */
export function buildCustomerHistoryHtml({ history, settings = {}, dir = "ltr", labels = {} }) {
  const l = {
    customerReport: "Customer report", customer: "Customer", phone: "Phone", email: "Email",
    address: "Address", vehicle: "Vehicle", firstVisit: "First visit", lastVisit: "Last visit",
    repairs: "Repairs", invoices: "Invoices", parts: "Parts", labor: "Labor",
    lifetimeSpend: "Lifetime spend", paid: "Paid", unpaid: "Unpaid",
    jobCard: "Job card", date: "Date", vehicleCol: "Vehicle", mechanic: "Mechanic",
    status: "Status", partsCol: "Parts (€)", laborCol: "Labor (€)", totalCol: "Total (€)",
    complaint: "Complaint", workDone: "Work done", partsUsed: "Parts used",
    minutes: "min", noRepairs: "No repairs on file.",
    invoiceNumber: "Invoice #", invoiceStatus: "Status", invoiceTotal: "Total",
    invoiceDate: "Created", paidAt: "Paid at", method: "Method",
    footerNote: "Complete customer history — generated by workshop system",
    ...labels,
  };
  const c = history.customer || {};
  const bodyFont = dir === "rtl" ? "'Cairo','Amiri',system-ui,sans-serif" : "-apple-system,Helvetica,Arial,sans-serif";
  const alignEnd = dir === "rtl" ? "left" : "right";
  const dateLocale = dir === "rtl" ? "ar-EG" : "en-GB";
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(dateLocale, { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(dateLocale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const logo = settings.logo_url || "/logo-shawish.png";
  const logoAbs = logo.startsWith("http") ? logo : (window.location.origin + logo);

  const repairRows = (history.repairs || []).map(r => "");
  const vehicleBlocks = (history.by_vehicle || []).map(g => {
    const v = g.vehicle || {};
    const title = [v.make, v.model, v.year].filter(Boolean).join(" ") || "—";
    const plate = v.plate ? ` · <span class="mono">${v.plate}</span>` : "";
    const meta = [v.color, v.vin ? "VIN " + v.vin : "", v.km ? v.km + " km" : ""].filter(Boolean).join(" · ");
    const rrows = (g.repairs || []).map(r => `
      <tr>
        <td class="mono">${r.card_number || ""}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td>${(r.complaint || "").replace(/</g, "&lt;")}</td>
        <td>${(r.work_done || "").replace(/</g, "&lt;")}</td>
        <td>${r.mechanic_name || "—"}</td>
        <td><span class="badge status-${r.status}">${r.status || ""}</span></td>
        <td class="right">${formatEUR(r.parts_total)}</td>
        <td class="right">${formatEUR(r.labor_charge)}${r.labor_minutes ? `<div class="muted">${Math.round(r.labor_minutes)} ${l.minutes}</div>` : ""}</td>
        <td class="right totcell">${formatEUR(r.grand_total)}</td>
      </tr>
      ${(r.parts_used || []).length ? `<tr class="detailrow"><td colspan="9"><div class="detail"><span class="lbl">${l.partsUsed}:</span> ${(r.parts_used || []).map(p => `${p.name} × ${p.quantity} (${formatEUR(p.total)})`).join(" · ")}</div></td></tr>` : ""}
    `).join("");
    return `<div class="veh">
      <div class="veh-head">
        <div>
          <div class="veh-title">${title}${plate}</div>
          <div class="muted">${meta || ""}</div>
          <div class="muted">${l.visits}: ${g.repair_count} · ${l.firstVisit}: ${fmtDate(g.first_visit)} · ${l.lastServiced}: ${fmtDate(g.last_visit)}</div>
        </div>
        <div class="veh-total"><span class="lbl">${l.lifetimeSpend}</span><div class="n">${formatEUR(g.total_spent)}</div></div>
      </div>
      ${g.repairs && g.repairs.length ? `<table>
        <thead><tr>
          <th>#</th><th>${l.date}</th><th>${l.complaint}</th><th>${l.workDone}</th>
          <th>${l.mechanic}</th><th>${l.status}</th>
          <th class="right">${l.partsCol}</th><th class="right">${l.laborCol}</th><th class="right">${l.totalCol}</th>
        </tr></thead>
        <tbody>${rrows}</tbody>
      </table>` : `<div class="empty">${l.noRepairs}</div>`}
    </div>`;
  }).join("");

  const invoiceRows = (history.invoices || []).map(i => `
    <tr>
      <td class="mono">${i.invoice_number || ""}</td>
      <td>${fmtDate(i.created_at)}</td>
      <td>${i.paid_at ? fmtDateTime(i.paid_at) : "—"}</td>
      <td>${i.payment_method_name || "—"}</td>
      <td><span class="badge status-${i.status}">${i.status || ""}</span></td>
      <td class="right totcell">${formatEUR(i.total)}</td>
    </tr>
  `).join("");

  return `<div style="font-family:${bodyFont};color:#111;background:#fff;padding:8px;direction:${dir}">
    <style>
      .cr { max-width: 780px; }
      .cr h1 { font-size: 22px; margin: 0; }
      .cr h3 { font-size: 14px; margin: 20px 0 8px; letter-spacing: .04em; text-transform: uppercase; color: #444; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; }
      .cr .muted { color: #777; font-size: 11px; }
      .cr .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11px; }
      .cr .logo-band { background:#0a0a0a; border-radius:10px; padding:14px 18px; margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
      .cr .logo-band img { max-height: 60px; width: auto; object-fit: contain; }
      .cr .logo-band .badge { background:#d4af37; color:#0a0a0a; padding:3px 12px; border-radius:999px; font-size:10px; letter-spacing:.15em; font-weight:700; }
      .cr .logo-band .num { color:#d4af37; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size:12px; margin-top:4px; direction:ltr; }
      .cr .logo-band .date { color:#999; font-size:11px; }
      .cr .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .cr .box { border: 1px solid #eee; border-radius: 8px; padding: 12px; background: #fafafa; }
      .cr .lbl { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #666; font-weight: 700; }
      .cr .val { font-size: 14px; font-weight: 600; margin-top: 2px; }
      .cr .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0; }
      .cr .stat { border: 1px solid #eee; border-radius: 8px; padding: 10px; background: #fafafa; text-align:${dir === 'rtl' ? 'right' : 'left'}; }
      .cr .stat .n { font-size: 18px; font-weight: 800; font-family: 'IBM Plex Mono', ui-monospace, monospace; }
      .cr .stat .p { color:#d4af37; }
      .cr table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .cr th { background: #f5f5f5; padding: 8px; border-bottom: 2px solid #ddd; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #444; text-align:${dir === 'rtl' ? 'right' : 'left'}; }
      .cr td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
      .cr .right { text-align: ${alignEnd}; }
      .cr .totcell { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-weight: 700; }
      .cr .badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:10px; letter-spacing:.06em; text-transform:uppercase; }
      .cr .badge.status-open { background:#dbeafe; color:#1d4ed8; }
      .cr .badge.status-in_progress { background:#fef3c7; color:#92400e; }
      .cr .badge.status-completed { background:#d1fae5; color:#065f46; }
      .cr .badge.status-paid { background:#d1fae5; color:#065f46; }
      .cr .badge.status-draft { background:#fef3c7; color:#92400e; }
      .cr .detailrow td { background:#fdfdf7; border-bottom: 1px solid #eee; padding: 4px 12px; }
      .cr .detail { font-size: 11px; color: #555; }
      .cr .detail .lbl { font-weight: 700; color: #444; margin-inline-end: 4px; }
      .cr .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #eee; text-align: center; color: #888; font-size: 11px; }
      .cr .empty { text-align: center; color: #999; padding: 16px; font-size: 12px; }
      .cr .veh { border: 1px solid #eee; border-radius: 8px; padding: 12px; margin-bottom: 12px; background: #fefefe; }
      .cr .veh-head { display:flex; justify-content:space-between; align-items:start; gap:12px; margin-bottom:8px; padding-bottom:8px; border-bottom:1px dashed #eee; }
      .cr .veh-title { font-size: 15px; font-weight: 800; color:#111; }
      .cr .veh-total { text-align:${dir === 'rtl' ? 'left' : 'right'}; }
      .cr .veh-total .n { font-family:'IBM Plex Mono', ui-monospace, monospace; font-weight:800; color:#d4af37; font-size:16px; }
    </style>
    <div class="cr">
      <div class="logo-band">
        <img src="${logoAbs}" alt="logo" crossorigin="anonymous" />
        <div style="text-align:${alignEnd}">
          <span class="badge">${l.customerReport}</span>
          <div class="num">${c.name || ""}</div>
          <div class="date">${new Date().toLocaleDateString(dateLocale)}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div><h1>${settings.name || "Garage"}</h1><div class="muted">${settings.address || ""}</div><div class="muted">${settings.phone || ""}${settings.email ? " · " + settings.email : ""}</div></div>
      </div>
      <div class="grid">
        <div class="box"><div class="lbl">${l.customer}</div><div class="val">${c.name || "—"}</div><div class="muted">${c.email || ""} ${c.email && c.phone ? "·" : ""} ${c.phone || ""}</div><div class="muted">${c.address || ""}</div></div>
        <div class="box"><div class="lbl">${l.vehicle}</div><div class="val">${c.vehicle || "—"}</div><div class="muted">${l.firstVisit}: ${fmtDate(history.first_visit)}</div><div class="muted">${l.lastVisit}: ${fmtDate(history.last_visit)}</div></div>
      </div>

      <div class="summary">
        <div class="stat"><div class="lbl">${l.repairs}</div><div class="n">${history.repair_count || 0}</div></div>
        <div class="stat"><div class="lbl">${l.invoices}</div><div class="n">${history.invoice_count || 0}</div></div>
        <div class="stat"><div class="lbl">${l.paid}</div><div class="n">${formatEUR(history.paid || 0)}</div></div>
        <div class="stat"><div class="lbl">${l.unpaid}</div><div class="n" style="color:${(history.unpaid || 0) > 0 ? '#b45309' : '#065f46'}">${formatEUR(history.unpaid || 0)}</div></div>
      </div>
      <div class="summary">
        <div class="stat"><div class="lbl">${l.parts}</div><div class="n">${formatEUR(history.total_parts || 0)}</div></div>
        <div class="stat"><div class="lbl">${l.labor}</div><div class="n">${formatEUR(history.total_labor || 0)}</div></div>
        <div class="stat" style="grid-column: span 2; background:#fff8e1; border-color:#f5d571"><div class="lbl p">${l.lifetimeSpend}</div><div class="n p">${formatEUR(history.total_spent || 0)}</div></div>
      </div>

      <h3>${l.repairs} — ${l.perVehicleTimeline || "By vehicle"}</h3>
      ${vehicleBlocks || `<div class="empty">${l.noRepairs}</div>`}

      <h3>${l.invoices}</h3>
      ${(history.invoices || []).length ? `<table>
        <thead><tr>
          <th>${l.invoiceNumber}</th><th>${l.invoiceDate}</th><th>${l.paidAt}</th><th>${l.method}</th><th>${l.invoiceStatus}</th><th class="right">${l.invoiceTotal}</th>
        </tr></thead>
        <tbody>${invoiceRows}</tbody>
      </table>` : `<div class="empty">—</div>`}

      <p class="footer">${l.footerNote}</p>
    </div>
  </div>`;
}

export async function downloadCustomerHistoryPdf(history, settings, dir = "ltr", labels = {}) {
  const html = buildCustomerHistoryHtml({ history, settings, dir, labels });
  const safe = (history?.customer?.name || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await downloadHtmlAsPdf(html, `${safe}-history-${new Date().toISOString().slice(0, 10)}.pdf`, { dir });
}

export function printCustomerHistory(history, settings, dir = "ltr", labels = {}) {
  const html = buildCustomerHistoryHtml({ history, settings, dir, labels });
  printHtml(html, { title: `Customer · ${history?.customer?.name || ""}`, dir, lang: dir === "rtl" ? "ar" : "en" });
}
