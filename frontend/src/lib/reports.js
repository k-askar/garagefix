import { downloadHtmlAsPdf, printHtml } from "@/lib/pdf";
import { formatEUR } from "@/lib/api";
import { partyVehicleBlock, INVOICE_I18N } from "@/lib/invoice-render";

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
 * Renders a small inline license-plate badge for use inside PDF/print HTML.
 * Mirrors the PlateBadge React component but as static HTML for html2pdf.
 */
function plateHtml(plate, country = "NL", size = "sm") {
  if (!plate) return "—";
  const NL_YELLOW = "#FFCB05";
  const STRIP = {
    NL: { bg: "#003399", label: "NL" }, DE: { bg: "#003399", label: "D" },
    FR: { bg: "#003399", label: "F" }, BE: { bg: "#003399", label: "B" },
    IT: { bg: "#003399", label: "I" }, ES: { bg: "#003399", label: "E" },
    PL: { bg: "#003399", label: "PL" }, GB: { bg: "#012169", label: "GB" },
    TR: { bg: "#e30a17", label: "TR" }, MA: { bg: "#c1272d", label: "MA" },
    DZ: { bg: "#006233", label: "DZ" }, SA: { bg: "#006c35", label: "KSA" },
    AE: { bg: "#00732f", label: "UAE" }, EG: { bg: "#ce1126", label: "ET" },
    SY: { bg: "#000000", label: "SYR" }, LB: { bg: "#ed1c24", label: "RL" },
    JO: { bg: "#000000", label: "JOR" }, IQ: { bg: "#ce1126", label: "IRQ" },
    US: { bg: "#3c3b6e", label: "US" },
  };
  const code = String(country || "NL").toUpperCase();
  const strip = STRIP[code] || { bg: "#111", label: code.slice(0, 3) };
  const isNL = code === "NL";
  const D = size === "lg"
    ? { text: 20, stripSize: 11, padPill: "6px 14px 6px 44px", stripW: 34, radius: 6 }
    : { text: 14, stripSize: 9,  padPill: "4px 10px 4px 34px", stripW: 28, radius: 5 };
  return `<span style="
      display:inline-block;position:relative;vertical-align:middle;
      background:${isNL ? NL_YELLOW : "#ffffff"};color:#000;border:2px solid #000;
      border-radius:${D.radius}px;padding:${D.padPill};
      font-family:'Arial Black',Impact,Helvetica,sans-serif;font-weight:900;
      font-size:${D.text}px;letter-spacing:.14em;line-height:1.15;text-align:center;
      -webkit-print-color-adjust:exact;print-color-adjust:exact;white-space:nowrap;direction:ltr;">
    <span style="position:absolute;left:0;top:0;bottom:0;width:${D.stripW}px;
        background:${strip.bg};color:#fff;font-size:${D.stripSize}px;letter-spacing:.06em;
        display:flex;align-items:center;justify-content:center;font-weight:900;
        border-top-left-radius:${D.radius - 2}px;border-bottom-left-radius:${D.radius - 2}px;
        border-right:1px solid rgba(0,0,0,.15);
        -webkit-print-color-adjust:exact;print-color-adjust:exact;">${strip.label}</span>
    ${String(plate).toUpperCase()}
  </span>`;
}

/**
 * Repair card single-page report.
 */
export function buildRepairCardHtml({ card, settings = {}, dir = "ltr", labels = {}, customer, vehicle }) {
  const l = {
    jobCard: "JOB CARD", customer: "Customer", vehicle: "Vehicle",
    mechanic: "Mechanic", status: "Status", complaint: "Customer complaint",
    diagnosis: "Diagnosis", workDone: "Work performed", part: "Part",
    qty: "Qty", unitPrice: "Unit price", total: "Total", noParts: "No parts", special: "SPECIAL",
    partsTotal: "Parts total", labor: "Labor", grandTotal: "Grand total",
    plate: "Plate", km: "km",
    timeClock: "Labor time clock", startedAt: "Started", stopped: "Stopped", duration: "Duration",
    returned: "RETURNED",
    ...labels,
  };
  // Localised strings for the reusable party/vehicle block — pick nl for Dutch
  // dir=ltr (settings.pdf_lang=nl default), ar for RTL, else English.
  const lang = dir === "rtl" ? "ar" : (settings.pdf_lang || "nl");
  const L = INVOICE_I18N[lang] || INVOICE_I18N.nl;
  const stockRows = (card.parts_used || []).map(p => {
    const isRet = !!p.returned;
    const rowStyle = isRet ? "background:#fef2f2;color:#b91c1c;" : "";
    const tdBase = `padding:8px;border-bottom:1px solid #eee;font-size:13px;text-align:${dir === 'rtl' ? 'right' : 'left'};${rowStyle}`;
    const strike = isRet ? "text-decoration:line-through;" : "";
    const badge = isRet
      ? `<span style="display:inline-block;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;padding:1px 6px;border-radius:6px;font-size:9px;letter-spacing:.1em;font-weight:800;margin-inline-start:6px;text-decoration:none;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${l.returned}</span>`
      : "";
    const reason = isRet && p.return_reason
      ? `<div style="font-size:10px;color:#b91c1c;margin-top:2px;text-decoration:none">· ${p.return_reason}</div>` : "";
    return `<tr style="${rowStyle}">
      <td style="${tdBase}"><span style="${strike}">${p.name}</span>${badge}<div style="font-size:10px;color:#888;direction:ltr;text-decoration:none">${p.sku || ""}</div>${reason}</td>
      <td style="${tdBase};text-align:${dir === 'rtl' ? 'left' : 'right'};${strike}">${p.quantity}</td>
      <td style="${tdBase};text-align:${dir === 'rtl' ? 'left' : 'right'};${strike}">${formatEUR(p.unit_price)}</td>
      <td style="${tdBase};text-align:${dir === 'rtl' ? 'left' : 'right'};${strike}">${formatEUR(p.total)}</td>
    </tr>`;
  }).join("");
  const specialRows = (card.special_parts || []).map(p => {
    const isRet = !!p.returned;
    const rowStyle = isRet ? "background:#fef2f2;color:#b91c1c;" : "";
    const tdBase = `padding:8px;border-bottom:1px solid #eef2f7;font-size:13px;text-align:${dir === 'rtl' ? 'right' : 'left'};${rowStyle}`;
    const strike = isRet ? "text-decoration:line-through;" : "";
    const badge = isRet
      ? `<span style="display:inline-block;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;padding:1px 6px;border-radius:6px;font-size:9px;letter-spacing:.1em;font-weight:800;margin-inline-start:6px;text-decoration:none;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${l.returned}</span>`
      : `<span style="font-size:9px;background:#f5e7c5;color:#8a6d1a;padding:1px 6px;border-radius:6px;margin-inline-start:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${l.special || 'SPECIAL'}</span>`;
    const reason = isRet && p.return_reason
      ? `<div style="font-size:10px;color:#b91c1c;margin-top:2px;text-decoration:none">· ${p.return_reason}</div>` : "";
    return `<tr style="${rowStyle}">
      <td style="${tdBase}"><span style="${strike}">${p.name}</span>${badge}<div style="font-size:10px;color:#888;direction:ltr;text-decoration:none">${p.part_number || ""}${p.supplier_name ? " · " + p.supplier_name : ""}</div>${reason}</td>
      <td style="${tdBase};text-align:${dir === 'rtl' ? 'left' : 'right'};${strike}">${p.quantity}</td>
      <td style="${tdBase};text-align:${dir === 'rtl' ? 'left' : 'right'};${strike}">${formatEUR(p.unit_price)}</td>
      <td style="${tdBase};text-align:${dir === 'rtl' ? 'left' : 'right'};${strike}">${formatEUR(p.total)}</td>
    </tr>`;
  }).join("");
  const rows = stockRows + specialRows;
  const bodyFont = dir === "rtl" ? "'Cairo','Amiri',system-ui,sans-serif" : "-apple-system,Helvetica,Arial,sans-serif";
  const alignEnd = dir === "rtl" ? "left" : "right";
  const logo = settings.logo_url || "/logo-shawish.png";
  const logoAbs = logo.startsWith("http") ? logo : (window.location.origin + logo);
  const statusColors = {
    open: { bg: "#dbeafe", fg: "#1d4ed8" },
    in_progress: { bg: "#fef3c7", fg: "#92400e" },
    completed: { bg: "#d1fae5", fg: "#065f46" },
  }[card.status] || { bg: "#e5e7eb", fg: "#374151" };
  // Parts count excludes ALL returned parts (stock + special).
  const partsUsedCount = (card.parts_used || []).filter(p => !p.returned).length
                       + (card.special_parts || []).filter(p => !p.returned).length;
  const returnedCount = (card.parts_used || []).filter(p => p.returned).length
                      + (card.special_parts || []).filter(p => p.returned).length;
  const discountAmount = Number(card.discount_amount || 0);
  return `<div style="font-family:${bodyFont};color:#0f172a;background:#fff;padding:8px;direction:${dir}">
    <link rel="preconnect" href="https://fonts.googleapis.com"/>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap" rel="stylesheet"/>
    <style>
      .jc { max-width: 760px; }
      .jc h1 { font-size: 26px; margin: 0; color:#0f172a; font-weight: 800; letter-spacing:-.01em; }
      .jc .muted { color: #64748b; font-size: 12px; }
      .jc .top { display:flex; align-items:center; justify-content:space-between; gap:24px; padding:6px 2px 18px; margin-bottom:20px; border-bottom:1px solid #e2e8f0; position:relative; }
      .jc .top::after { content:""; position:absolute; ${dir === 'rtl' ? 'right' : 'left'}:0; bottom:-1px; width:64px; height:2px; background:#1d4ed8; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .jc .top img { max-height: 64px; width: auto; object-fit: contain; }
      .jc .top .meta { text-align:${alignEnd}; display:flex; flex-direction:column; align-items:${dir === 'rtl' ? 'flex-start' : 'flex-end'}; gap:6px; }
      .jc .top .num { color:#0f172a; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size:16px; font-weight:800; direction:ltr; letter-spacing:.08em; }
      .jc .top .doc-label { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size:9.5px; letter-spacing:.32em; color:#94a3b8; text-transform:uppercase; font-weight:700; }
      .jc .top .date { color:#94a3b8; font-size:10.5px; font-family:'JetBrains Mono',ui-monospace,monospace; }
      .jc .status { display:inline-block; background:${statusColors.bg}; color:${statusColors.fg}; padding:4px 12px; border-radius:999px; font-family:'JetBrains Mono',ui-monospace,monospace; font-size:10px; letter-spacing:.14em; font-weight:800; text-transform:uppercase; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .jc .head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:6px; padding-bottom:12px; border-bottom:1px solid #e2e8f0; }
      .jc .quote { border-inline-start:3px solid #dbeafe; padding: 8px 14px; color:#334155; font-size:12.5px; font-style:italic; background:#f8fafc; border-radius:0 6px 6px 0; margin-top:14px; }
      .jc h3 { font-family:'JetBrains Mono',ui-monospace,monospace; font-size:10px; text-transform:uppercase; letter-spacing:.14em; color:#64748b; font-weight:800; margin: 18px 0 6px; display:flex; align-items:center; gap:6px; }
      .jc h3::before { content:""; width:6px; height:6px; background:#1d4ed8; border-radius:50%; display:inline-block; }
      .jc table { width: 100%; border-collapse: separate; border-spacing:0; margin-top: 4px; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
      .jc th, .jc td { padding: 8px 10px; border-bottom: 1px solid #eef2f7; font-size: 13px; text-align:${dir === 'rtl' ? 'right' : 'left'}; }
      .jc tbody tr:last-child td { border-bottom:none; }
      .jc th { background: #f8fafc; color:#64748b; font-family:'JetBrains Mono',ui-monospace,monospace; font-size:9.5px; text-transform:uppercase; letter-spacing:.12em; font-weight:800; }
      .jc .right { text-align: ${alignEnd}; font-family:'JetBrains Mono',ui-monospace,monospace; }
      .jc .totals { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-top:20px; padding:14px 16px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc; }
      .jc .totals .lbl { font-family:'JetBrains Mono',ui-monospace,monospace; font-size:9.5px; text-transform:uppercase; letter-spacing:.14em; color:#64748b; font-weight:800; }
      .jc .totals .parts-count { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size:16px; color:#0f172a; font-weight:800; margin-top:2px; }
      .jc .totals .ret-note { font-family:'JetBrains Mono',ui-monospace,monospace; font-size:10px; color:#b91c1c; margin-top:2px; }
      .jc .totals .total-big { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size:28px; color:#1d4ed8; font-weight:800; tabular-nums:1; margin-top:2px; letter-spacing:-.01em; }
      .jc .foot { text-align:center; color:#94a3b8; font-size:11px; margin-top:24px; padding-top:12px; border-top:1px dashed #e2e8f0; font-family:'JetBrains Mono',ui-monospace,monospace; letter-spacing:.06em; }
    </style>
    <div class="jc">
      <div class="top">
        <img src="${logoAbs}" alt="logo" crossorigin="anonymous" />
        <div class="meta">
          <div class="doc-label">${l.jobCard}</div>
          <div class="num">${card.card_number}</div>
          <span class="status">${l["status_" + card.status] || card.status}</span>
          <div class="date">${new Date(card.created_at).toLocaleDateString(dir === 'rtl' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
        </div>
      </div>

      ${partyVehicleBlock({
        customer: customer || { name: card.customer_name, phone: card.customer_phone },
        vehicle: vehicle || {
          make: card.car_make, model: card.car_model, year: card.car_year,
          plate: card.car_plate, color: card.car_color, km: card.car_km,
          country: card.car_country, apk_expiry: card.car_apk_expiry,
        },
        fallbackPlate: card.car_plate,
        fallbackCountry: card.car_country,
        accent: "#1d4ed8",
        L,
      })}

      ${card.complaint ? `<div class="quote">"${card.complaint}"</div>` : ""}
      ${card.diagnosis ? `<h3>${l.diagnosis}</h3><p style="margin:2px 0;font-size:12.5px;color:#334155">${card.diagnosis}</p>` : ""}
      ${card.work_done ? `<h3>${l.workDone}</h3><p style="margin:2px 0;font-size:12.5px;color:#334155">${card.work_done}</p>` : ""}

      ${(card.time_logs && card.time_logs.length) ? `<h3>${l.timeClock || 'Labor time clock'}</h3>
        <table><thead><tr><th>${l.mechanic}</th><th>${l.startedAt || 'Start'}</th><th>${l.stopped || 'Stop'}</th><th class="right">${l.duration || 'Duration'}</th></tr></thead><tbody>
        ${card.time_logs.map(tl => `<tr><td>${tl.mechanic_name || '—'}</td><td style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11.5px">${new Date(tl.started_at).toLocaleString(dir === 'rtl' ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11.5px">${tl.stopped_at ? new Date(tl.stopped_at).toLocaleString(dir === 'rtl' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td class="right">${Math.round(Number(tl.minutes) || 0)} min</td></tr>`).join('')}
        </tbody></table>` : ""}

      ${(card.parts_used || []).length || (card.special_parts || []).length ? `
      <h3>${l.part}</h3>
      <table><thead><tr><th>${l.part}</th><th class="right">${l.qty}</th><th class="right">${l.unitPrice}</th><th class="right">${l.total}</th></tr></thead>
      <tbody>${rows}</tbody></table>` : ""}

      <div class="totals">
        <div>
          <div class="lbl">${l.partsTotal}</div>
          <div class="parts-count">${partsUsedCount}</div>
          ${returnedCount ? `<div class="ret-note">· ${returnedCount} ${(l.returned || 'returned').toLowerCase()}</div>` : ""}
        </div>
        <div style="text-align:${alignEnd}">
          ${discountAmount > 0 ? `<div style="font-size:11px;color:#059669;margin-bottom:4px;font-family:'JetBrains Mono',ui-monospace,monospace">${l.discountApplied || 'Discount'}: −${formatEUR(discountAmount)}</div>` : ""}
          <div class="lbl">${l.grandTotal}</div>
          <div class="total-big">${formatEUR(card.total_with_tax || card.grand_total)}</div>
        </div>
      </div>

      ${settings.name ? `<p class="foot">${settings.name}${settings.phone ? " · " + settings.phone : ""}${settings.email ? " · " + settings.email : ""}</p>` : ""}
    </div>
  </div>`;
}

export async function downloadRepairCardPdf(card, settings, dir = "ltr", labels = {}, extras = {}) {
  const html = buildRepairCardHtml({ card, settings, dir, labels, customer: extras.customer, vehicle: extras.vehicle });
  await downloadHtmlAsPdf(html, `${card.card_number}.pdf`, { dir });
}

export function printRepairCard(card, settings, dir = "ltr", labels = {}, extras = {}) {
  const html = buildRepairCardHtml({ card, settings, dir, labels, customer: extras.customer, vehicle: extras.vehicle });
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
      .cr .rpt-head { display:flex; align-items:center; justify-content:space-between; gap:24px; padding:6px 2px 18px; margin-bottom:20px; border-bottom:1px solid #ececec; position:relative; }
      .cr .rpt-head::after { content:""; position:absolute; ${dir === 'rtl' ? 'right' : 'left'}:0; bottom:-1px; width:64px; height:2px; background:#d4af37; }
      .cr .rpt-head img { max-height: 72px; width: auto; object-fit: contain; }
      .cr .rpt-head .meta { text-align:${alignEnd}; }
      .cr .rpt-head .kicker { font-size:10px; letter-spacing:.32em; font-weight:700; color:#9a9a9a; text-transform:uppercase; margin-bottom:6px; }
      .cr .rpt-head .who { font-size:15px; font-weight:700; color:#111; letter-spacing:.01em; }
      .cr .rpt-head .when { color:#8a8a8a; font-size:11px; margin-top:2px; font-family:'IBM Plex Mono', ui-monospace, monospace; }
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
      <div class="rpt-head">
        <img src="${logoAbs}" alt="logo" crossorigin="anonymous" />
        <div class="meta">
          <div class="kicker">${l.customerReport}</div>
          <div class="who">${c.name || ""}</div>
          <div class="when">${new Date().toLocaleDateString(dateLocale)}</div>
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
