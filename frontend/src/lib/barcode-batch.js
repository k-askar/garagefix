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
      <div class="name">${i.name}</div>
      <div class="meta">${i.sku} · €${Number(i.selling_price).toFixed(2)}</div>
      ${generateBarcodeSvg(i.barcode || i.sku)}
    </div>`).join("");
  w.document.write(`<!doctype html><html><head><title>Labels · ${items.length} parts</title>
    <style>
      @page { margin: 8mm; }
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; padding: 8px; color: #111; background: #fff; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .label { border: 1px dashed #999; border-radius: 6px; padding: 8px; text-align: center; page-break-inside: avoid; }
      .label .name { font-size: 11px; font-weight: 700; margin-bottom: 2px; line-height: 1.2; min-height: 26px; }
      .label .meta { font-size: 10px; color: #444; margin-bottom: 4px; }
      .label svg { max-width: 100%; height: auto; }
      @media print { .no-print { display: none; } }
    </style>
    </head><body>
    <div class="no-print" style="text-align:center;margin-bottom:8px">
      <button onclick="window.print()">Print ${items.length} labels</button>
    </div>
    <div class="grid">${cards}</div>
    </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}
