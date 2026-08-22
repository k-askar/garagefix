import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Render HTML content to a downloadable PDF file — WITHOUT causing the parent
 * page to visibly shrink/scroll.  We use a same-origin sandboxed iframe so
 * html2canvas can rasterise an isolated document.
 */
async function renderHtmlToCanvas(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("sandbox", "allow-same-origin");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "820px",
    height: "1200px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
    // very important: DO NOT set display:none — html2canvas needs a rendered layout
  });
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("Cannot open sandbox document");
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for images (logo, QR) to load inside the iframe.
    await new Promise((resolve) => {
      const done = () => resolve();
      if (doc.readyState === "complete") { setTimeout(done, 50); return; }
      doc.addEventListener("DOMContentLoaded", () => setTimeout(done, 50), { once: true });
      window.setTimeout(done, 1500); // hard cap
    });
    const imgs = Array.from(doc.images || []);
    await Promise.all(imgs.map((im) => im.complete
      ? Promise.resolve()
      : new Promise((r) => { im.onload = im.onerror = r; })
    ));

    // Give layout one final frame
    await new Promise((r) => setTimeout(r, 40));

    const target = doc.body;
    // ensure body has natural size so html2canvas doesn't try to expand
    const height = Math.max(target.scrollHeight, target.offsetHeight, 400);
    return await html2canvas(target, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      allowTaint: true,
      logging: false,
      width: target.scrollWidth,
      height,
      windowWidth: target.scrollWidth,
      windowHeight: height,
      scrollX: 0,
      scrollY: 0,
    });
  } finally {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }
}

/** Turn a rasterised canvas into a jsPDF instance (A4 portrait, multi-page). */
function canvasToPdf(canvas) {
  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const marginX = 20;
  const imgW = pageW - marginX * 2;
  const imgH = (canvas.height * imgW) / canvas.width;
  const img = canvas.toDataURL("image/png");
  let position = 20;
  let heightLeft = imgH;
  pdf.addImage(img, "PNG", marginX, position, imgW, imgH, undefined, "FAST");
  heightLeft -= pageH - 40;
  while (heightLeft > 0) {
    position = 20 - (imgH - heightLeft);
    pdf.addPage();
    pdf.addImage(img, "PNG", marginX, position, imgW, imgH, undefined, "FAST");
    heightLeft -= pageH - 40;
  }
  return pdf;
}

/** Public: download the given HTML as a PDF file. */
export async function downloadHtmlAsPdf(html, filename) {
  const canvas = await renderHtmlToCanvas(html);
  const pdf = canvasToPdf(canvas);
  pdf.save(filename);
}

/** Public: render the HTML to a PDF Blob (used for bulk ZIP-of-PDFs). */
export async function htmlToPdfBlob(html) {
  const canvas = await renderHtmlToCanvas(html);
  const pdf = canvasToPdf(canvas);
  return pdf.output("blob");
}

/** Print an HTML fragment via a new tab / OS print dialog. */
export function printHtml(html, options = {}) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const dir = options.dir === "rtl" ? "rtl" : "ltr";
  const bodyFont = options.dir === "rtl"
    ? "'Cairo', 'Amiri', system-ui, sans-serif"
    : "'IBM Plex Sans', -apple-system, sans-serif";
  w.document.write(`<!doctype html><html dir="${dir}" lang="${options.lang || 'en'}"><head><meta charset="utf-8"/>
    <title>${options.title || "Print"}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Amiri:wght@400;700&display=swap" rel="stylesheet"/>
    <style>body{font-family:${bodyFont};color:#111;background:#fff;margin:0;padding:24px}</style>
    </head><body>${html}<script>window.onload=function(){setTimeout(function(){window.print()},350)}</script></body></html>`);
  w.document.close();
}
