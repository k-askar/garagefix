import { formatEUR } from "@/lib/api";

const I18N = {
  en: { receipt: "RECEIPT", date: "Date", customer: "Customer", note: "Note",
        part: "Part", qty: "Qty", price: "Price", total: "Total",
        taxId: "Tax ID", thanks: "Thank you!", locale: "en-GB" },
  nl: { receipt: "KASSABON", date: "Datum", customer: "Klant", note: "Opmerking",
        part: "Artikel", qty: "Aantal", price: "Prijs", total: "Totaal",
        taxId: "BTW-nummer", thanks: "Bedankt voor uw vertrouwen!", locale: "nl-NL" },
  ar: { receipt: "إيصال", date: "التاريخ", customer: "العميل", note: "ملاحظة",
        part: "الصنف", qty: "الكمية", price: "السعر", total: "الإجمالي",
        taxId: "الرقم الضريبي", thanks: "شكراً لثقتكم!", locale: "ar" },
};

export function printReceipt({ txn, item, settings, lang }) {
  const L = I18N[(lang || settings?.language || "nl").toLowerCase()] || I18N.nl;
  const w = window.open("", "_blank", "width=420,height=640");
  if (!w) return;
  const date = new Date(txn.created_at).toLocaleString(L.locale);
  const html = `
<!doctype html><html><head><title>${L.receipt} ${txn.id.slice(0, 8)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 24px; color: #111; max-width: 360px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
  .muted { color: #666; font-size: 12px; text-align: center; margin: 0; }
  hr { border: none; border-top: 1px dashed #999; margin: 14px 0; }
  .row { display: flex; justify-content: space-between; font-size: 13px; margin: 4px 0; }
  .row.small { font-size: 11px; color: #666; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 0; border-bottom: 1px solid #eee; }
  th:last-child, td:last-child { text-align: right; }
  .total { font-size: 16px; font-weight: 700; }
  .footer { margin-top: 16px; text-align: center; font-size: 11px; color: #666; }
  .badge { display:inline-block; padding: 2px 8px; border-radius: 999px; background: #111; color: #fff; font-size: 10px; letter-spacing: 0.1em; }
</style></head><body>
  <h1>${settings.name || "Garage"}</h1>
  ${settings.address ? `<p class="muted">${settings.address}</p>` : ""}
  ${settings.phone ? `<p class="muted">${settings.phone}${settings.email ? " · " + settings.email : ""}</p>` : ""}
  ${settings.tax_id ? `<p class="muted">${L.taxId}: ${settings.tax_id}</p>` : ""}
  <hr />
  <div class="row"><span><span class="badge">${L.receipt}</span></span><span class="muted">#${txn.id.slice(0, 8).toUpperCase()}</span></div>
  <div class="row small"><span>${L.date}</span><span>${date}</span></div>
  ${txn.customer_name ? `<div class="row small"><span>${L.customer}</span><span>${txn.customer_name}</span></div>` : ""}
  <hr />
  <table>
    <thead><tr><th>${L.part}</th><th>${L.qty}</th><th>${L.price}</th><th>${L.total}</th></tr></thead>
    <tbody>
      <tr>
        <td>${txn.item_name}<div style="font-size:10px;color:#888">${txn.item_sku}</div></td>
        <td>${txn.quantity}</td>
        <td>${formatEUR(txn.unit_price)}</td>
        <td>${formatEUR(txn.total)}</td>
      </tr>
    </tbody>
  </table>
  <hr />
  <div class="row total"><span>${L.total}</span><span>${formatEUR(txn.total)}</span></div>
  ${txn.note ? `<p class="muted" style="text-align:left;margin-top:12px">${L.note}: ${txn.note}</p>` : ""}
  <p class="footer">${settings.footer_note || L.thanks}</p>
</body></html>`;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300);
}
