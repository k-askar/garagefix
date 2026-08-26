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

/* Dutch/EU-style yellow plate badge for the printed invoice — mirrors the
   look of the <PlateBadge> React component used on the Job Cards page so the
   plate feels consistent everywhere the customer sees it. */
function plateHtml(plate, country = "NL") {
  if (!plate) return "";
  const code = String(country || "NL").toUpperCase();
  const isNL = code === "NL";
  const bg = isNL ? "#FFCB05" : "#ffffff";
  const stripBg = { NL: "#003399", DE: "#003399", FR: "#003399", BE: "#003399",
                    IT: "#003399", ES: "#003399", PL: "#003399", GB: "#012169",
                    TR: "#e30a17", MA: "#c1272d", DZ: "#006233", SA: "#006c35",
                    AE: "#00732f", EG: "#ce1126", SY: "#000000", LB: "#ed1c24",
                    JO: "#000000", IQ: "#ce1126" }[code] || "#111";
  const stripLbl = { NL: "NL", DE: "D", FR: "F", BE: "B", IT: "I", ES: "E",
                     PL: "PL", GB: "GB", TR: "TR", MA: "MA", DZ: "DZ",
                     SA: "KSA", AE: "UAE", EG: "ET", SY: "SYR", LB: "RL",
                     JO: "JOR", IQ: "IRQ" }[code] || code.slice(0, 3);
  return `<span style="display:inline-block;position:relative;vertical-align:middle;
    background:${bg};color:#000;border:2px solid #000;border-radius:5px;
    padding:5px 14px 5px 38px;
    font-family:'Arial Black',Impact,'Helvetica Neue',sans-serif;font-weight:900;
    font-size:16px;letter-spacing:0.14em;line-height:1.15;white-space:nowrap;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <span style="position:absolute;left:0;top:0;bottom:0;width:30px;
                 background:${stripBg};color:#fff;font-size:11px;letter-spacing:0.06em;
                 display:flex;align-items:center;justify-content:center;font-weight:900;
                 border-top-left-radius:3px;border-bottom-left-radius:3px;
                 border-right:1px solid rgba(0,0,0,.15);
                 -webkit-print-color-adjust:exact;print-color-adjust:exact;">${stripLbl}</span>
    ${esc(String(plate).toUpperCase())}
  </span>`;
}

function noteWithPlate(note, showPlate, country = "NL") {
  if (!note) return "";
  if (!showPlate) return esc(note);
  const plate = extractPlate(note);
  if (!plate) return esc(note);
  const idx = note.lastIndexOf(plate);
  return `${esc(note.slice(0, idx))}${plateHtml(plate, country)}`;
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
      width: 260,
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

/* All the strings the printed / downloaded invoice needs.  Keep them next to
   the renderer so the same file that decides layout also decides wording. */
const I18N = {
  en: {
    paid: "PAID", invoice: "INVOICE",
    billTo: "Bill to",
    walkIn: "Walk-in customer",
    item: "Item", qty: "Qty", unit: "Unit", total: "Total",
    subtotal: "Subtotal", grandTotal: "Total",
    reference: "Reference", amount: "Amount", bank: "Bank",
    paymentDetails: "Payment details",
    paymentDue: "Payment due within {days} days",
    paymentDueBy: " (by {date})",
    payWithIdeal: "Pay with iDEAL / SEPA · Scan & pay",
    scanWithApp: "Scan with your banking app",
    thankYou: "Thank you!",
    dateLocale: "en-GB",
  },
  nl: {
    paid: "BETAALD", invoice: "FACTUUR",
    billTo: "Aan",
    walkIn: "Balieklant",
    item: "Artikel", qty: "Aantal", unit: "Prijs", total: "Totaal",
    subtotal: "Subtotaal", grandTotal: "Totaal",
    reference: "Kenmerk", amount: "Bedrag", bank: "Bank",
    paymentDetails: "Betaalgegevens",
    paymentDue: "Te voldoen binnen {days} dagen",
    paymentDueBy: " (uiterlijk {date})",
    payWithIdeal: "Betaal met iDEAL / SEPA · Scan & betaal",
    scanWithApp: "Scan met uw bank-app",
    thankYou: "Bedankt voor uw vertrouwen!",
    dateLocale: "nl-NL",
  },
  ar: {
    paid: "مدفوعة", invoice: "فاتورة",
    billTo: "إلى",
    walkIn: "عميل زائر",
    item: "الصنف", qty: "الكمية", unit: "السعر", total: "الإجمالي",
    subtotal: "المجموع الفرعي", grandTotal: "الإجمالي",
    reference: "المرجع", amount: "المبلغ", bank: "البنك",
    paymentDetails: "بيانات الدفع",
    paymentDue: "الدفع خلال {days} يوم",
    paymentDueBy: " (بحلول {date})",
    payWithIdeal: "ادفع عبر iDEAL / SEPA · امسح وادفع",
    scanWithApp: "امسح بتطبيق البنك",
    thankYou: "شكراً لثقتكم!",
    dateLocale: "ar",
  },
};

/**
 * @param {object} inv       invoice document
 * @param {object} settings  garage settings
 * @param {object} [opts]    { lang: "en"|"nl"|"ar" } — defaults to Dutch since
 *                           the app's primary audience is NL workshops.
 * @returns {Promise<string>} full HTML document ready to open in a new window
 *   or feed into html2canvas.
 */
export async function renderInvoiceHtml(inv, settings, opts = {}) {
  const lang = (opts.lang || settings?.language || "nl").toLowerCase();
  const L = I18N[lang] || I18N.nl;
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

  const rows = (inv.lines || []).map((l, idx) => `
    <tr${idx % 2 ? ' style="background:#fafafa"' : ''}>
      <td style="padding-left:14px">
        <div style="font-weight:600;color:#111">${esc(l.name)}</div>
        ${l.sku ? `<div style="font-size:10px;color:#999;font-family:monospace;margin-top:2px">${esc(l.sku)}</div>` : ""}
      </td>
      <td class="right">${l.quantity}</td>
      <td class="right">${fmtMoney(l.unit_price, s)}</td>
      <td class="right" style="font-weight:600;padding-right:14px">${fmtMoney(l.total, s)}</td>
    </tr>`).join("");

  const paidBadge = inv.status === "paid" ? "paid" : "";
  const paidLabel = inv.status === "paid" ? L.paid : L.invoice;

  /* Prominent payment block — SEPA/iDEAL QR left, bank details right.
     Shown whenever the QR toggle is on so the customer always sees how to pay.
     Falls back to a clear notice when the owner hasn't configured an IBAN yet. */
  const bankBlock = showQr ? (
    qrData ? `
    <div style="margin-top:22px;border:2px solid ${accent};border-radius:10px;overflow:hidden;
                page-break-inside:avoid;break-inside:avoid;-webkit-column-break-inside:avoid;
                -webkit-print-color-adjust:exact;print-color-adjust:exact;">
      <div style="background:${accent};color:#fff;padding:8px 14px;font-size:11px;
                  letter-spacing:.14em;text-transform:uppercase;font-weight:700;
                  -webkit-print-color-adjust:exact;print-color-adjust:exact;">
        ${esc(L.payWithIdeal)}
      </div>
      <table style="width:100%;border-collapse:collapse;background:#fff">
        <tr>
          <td style="width:150px;padding:16px;text-align:center;vertical-align:middle">
            <img src="${qrData}" alt="SEPA payment QR" style="width:130px;height:130px;display:block;border:1px solid #eee;padding:4px;background:#fff"/>
            <div style="font-size:8px;color:#888;letter-spacing:.14em;margin-top:4px;text-transform:uppercase">${esc(L.scanWithApp)}</div>
          </td>
          <td style="padding:16px 16px 16px 4px;font-size:12px;color:#222;line-height:1.7;vertical-align:middle">
            ${s.bank_name ? `<div><span style="color:#888;font-size:10px;letter-spacing:.1em;text-transform:uppercase">${esc(L.bank)}</span><br/><strong>${esc(s.bank_name)}</strong></div>` : ""}
            <div style="margin-top:6px"><span style="color:#888;font-size:10px;letter-spacing:.1em;text-transform:uppercase">IBAN</span><br/>
              <span style="font-family:monospace;font-size:13px;letter-spacing:.05em">${esc(String(s.iban).replace(/\s+/g,"").toUpperCase().match(/.{1,4}/g)?.join(" ") || String(s.iban).toUpperCase())}</span></div>
            ${s.bic ? `<div style="margin-top:6px"><span style="color:#888;font-size:10px;letter-spacing:.1em;text-transform:uppercase">BIC</span><br/><span style="font-family:monospace">${esc(String(s.bic).toUpperCase())}</span></div>` : ""}
            <div style="margin-top:6px"><span style="color:#888;font-size:10px;letter-spacing:.1em;text-transform:uppercase">${esc(L.reference)}</span><br/>
              <strong style="font-family:monospace">${esc(inv.invoice_number)}</strong></div>
            <div style="margin-top:6px"><span style="color:#888;font-size:10px;letter-spacing:.1em;text-transform:uppercase">${esc(L.amount)}</span><br/>
              <strong style="font-size:15px;color:${accent}">${fmtMoney(inv.total, s)}</strong></div>
          </td>
        </tr>
      </table>
    </div>` : (s.iban || s.bank_name || s.bic) ? `
    <div style="margin-top:22px;padding:14px 16px;border:1px solid #eee;border-radius:8px;background:#fbfbfb;
                page-break-inside:avoid;break-inside:avoid;-webkit-column-break-inside:avoid">
      <div style="font-size:10px;color:#888;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:6px">${esc(L.paymentDetails)}</div>
      <div style="font-size:12px;line-height:1.7">
        ${s.bank_name ? `<div><strong>${esc(s.bank_name)}</strong></div>` : ""}
        ${s.iban ? `<div style="font-family:monospace">IBAN&nbsp;${esc(s.iban)}</div>` : ""}
        ${s.bic ? `<div style="font-family:monospace">BIC&nbsp;${esc(s.bic)}</div>` : ""}
        <div style="color:#666;margin-top:2px">${esc(L.reference)}: <strong>${esc(inv.invoice_number)}</strong></div>
      </div>
    </div>` : ""
  ) : "";

  const headerRight = `
    <div style="text-align:right">
      <span class="badge ${paidBadge}">${paidLabel}</span>
      <div style="font-size:14px;margin-top:6px;font-weight:700">${esc(inv.invoice_number)}</div>
      <div class="muted">${new Date(inv.created_at).toLocaleDateString(L.dateLocale)}</div>
    </div>`;

  const headerLeft = `
    <div style="display:flex;gap:12px;align-items:center">
      ${logoData ? `<img src="${logoData}" alt="logo" style="height:52px;max-width:160px;width:auto;object-fit:contain;flex-shrink:0"/>` : ""}
      <div style="min-width:0">
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
      table.items{width:100%;border-collapse:separate;border-spacing:0;margin-top:18px;
                  border:1px solid #eaeaea;border-radius:8px;overflow:hidden}
      table.items th,table.items td{padding:10px 8px;text-align:left;font-size:13px;vertical-align:top;border-bottom:1px solid #eee}
      table.items tbody tr:last-child td{border-bottom:none}
      table.items th{background:${tpl.thBg};color:${tpl.thColor};font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}
      .right{text-align:right}
      .badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;${tpl.badgeCss};
             -webkit-print-color-adjust:exact;print-color-adjust:exact}
      .badge.paid{background:#22c55e;color:#fff}
      .totrow{font-size:18px;font-weight:800;color:${accent}}
      hr.accent{${tpl.accentRule}}
      .terms{margin-top:18px;font-size:10px;color:#666;white-space:pre-line;border-top:1px solid #eee;padding-top:10px}
      .customer-block{margin-top:14px;padding:10px 14px;background:#fafafa;border-left:3px solid ${accent};border-radius:4px}
      @media print{*{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}}
    </style></head><body>
    ${headerBlock}
    <hr class="accent"/>
    ${wrapOpen}
    <div class="customer-block">
      <div class="muted" style="text-transform:uppercase;letter-spacing:.14em;font-size:9px;font-weight:700">${esc(L.billTo)}</div>
      <div style="font-size:16px;font-weight:700;margin-top:3px;color:#111">${esc(inv.customer_name || L.walkIn)}</div>
    </div>
    <table class="items"><thead><tr>
      <th style="padding-left:14px">${esc(L.item)}</th><th class="right">${esc(L.qty)}</th><th class="right">${esc(L.unit)}</th><th class="right" style="padding-right:14px">${esc(L.total)}</th>
    </tr></thead>
    <tbody>${rows}</tbody></table>
    <table style="margin-top:18px;margin-left:auto;margin-right:0;background:#fafafa;border:1px solid #eee;border-radius:8px;border-collapse:collapse;min-width:260px">
      <tr>
        <td style="padding:6px 24px 6px 14px;color:#666;font-size:12px;text-align:left;white-space:nowrap">${esc(L.subtotal)}</td>
        <td style="padding:6px 14px 6px 12px;color:#666;font-size:12px;text-align:right;font-family:monospace;white-space:nowrap">${fmtMoney(inv.subtotal, s)}</td>
      </tr>
      ${inv.tax ? `<tr>
        <td style="padding:4px 24px 4px 14px;color:#666;font-size:12px;text-align:left;white-space:nowrap">BTW${inv.tax_rate ? " " + inv.tax_rate + "%" : ""}</td>
        <td style="padding:4px 14px 4px 12px;color:#666;font-size:12px;text-align:right;font-family:monospace;white-space:nowrap">${fmtMoney(inv.tax, s)}</td>
      </tr>` : ""}
      <tr>
        <td style="padding:10px 24px 12px 14px;border-top:1px solid #ddd;font-size:11px;color:#888;letter-spacing:.1em;text-transform:uppercase;font-weight:700;text-align:left;white-space:nowrap">${esc(L.grandTotal)}</td>
        <td style="padding:10px 14px 12px 12px;border-top:1px solid #ddd;text-align:right;font-family:monospace;font-size:18px;font-weight:800;color:${accent};white-space:nowrap">${fmtMoney(inv.total, s)}</td>
      </tr>
    </table>
    ${inv.note ? `<p class="muted" style="margin-top:20px">${noteWithPlate(inv.note, showPlate, inv.car_country || "NL")}</p>` : ""}
    ${bankBlock}
    <p class="muted" style="margin-top:14px">${esc(L.paymentDue.replace("{days}", String(s.payment_terms_days || 14)))}${inv.due_date ? esc(L.paymentDueBy.replace("{date}", inv.due_date)) : ""}.</p>
    ${s.invoice_terms ? `<div class="terms">${esc(s.invoice_terms)}</div>` : ""}
    <p class="muted" style="margin-top:24px;text-align:center">${esc(s.footer_note || L.thankYou)}</p>
    ${wrapClose}
    </body></html>`;
}
