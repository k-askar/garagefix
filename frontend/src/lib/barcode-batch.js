import JsBarcode from "jsbarcode";

export function generateBarcodeSvg(value) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  try {
    JsBarcode(svg, value, { format: "CODE128", width: 1.6, height: 44, fontSize: 11, margin: 4, displayValue: true });
    return svg.outerHTML;
  } catch (e) { return `<div>${value}</div>`; }
}

export function printLabels(items) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const cards = items.map((i) => `
    <div class="label">
      <div class="name" title="${(i.name || "").replace(/"/g, '&quot;')}">${i.name || ""}</div>
      ${i.name_ar ? `<div class="name_ar" dir="rtl">${i.name_ar}</div>` : ""}
      ${generateBarcodeSvg(i.barcode || i.sku)}
      <div class="meta">${i.sku || ""}${(i.location ? ` · ${i.location}` : "")} · €${Number(i.selling_price || 0).toFixed(2)}</div>
    </div>`).join("");
  w.document.write(`<!doctype html><html><head><title>Labels · ${items.length} parts</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700&display=swap" rel="stylesheet">
    <style>
      @page { margin: 6mm; size: A4; }
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; padding: 6px; color: #111; background: #fff; }
      .toolbar { text-align:center; margin-bottom: 8px; }
      .toolbar button { padding:6px 14px; font-size:12px; border:1px solid #333; background:#fff; border-radius:4px; cursor:pointer; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .label { border: 1px dashed #999; border-radius: 6px; padding: 6px; text-align: center; page-break-inside: avoid; }
      .label .name { font-size: 11px; font-weight: 700; margin-bottom: 2px; line-height: 1.2; min-height: 26px; overflow:hidden; }
      .label .name_ar { font-family: 'Cairo', 'Amiri', 'Traditional Arabic', sans-serif; font-size: 12px; font-weight: 700; color: #222; margin-bottom: 3px; direction: rtl; }
      .label .meta { font-size: 9px; color: #444; margin-top: 3px; font-family: monospace; }
      .label svg { max-width: 100%; height: auto; }
      @media print { .no-print { display: none; } }
    </style>
    </head><body>
    <div class="toolbar no-print">
      <span style="font-family:monospace;font-size:11px;color:#666;margin-right:12px">${items.length} labels · A4</span>
      <button onclick="window.print()">🖨 Print</button>
    </div>
    <div class="grid">${cards}</div>
    </body></html>`);
  w.document.close();
  // Give the Cairo webfont a beat to load so Arabic glyphs render properly.
  setTimeout(() => w.print(), 600);
}
