import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Render HTML content to a downloadable PDF file.
 * Works with Arabic / RTL text because we snapshot the rendered HTML via html2canvas
 * — the browser handles Arabic shaping and direction, and the result is embedded as an image.
 */
export async function downloadHtmlAsPdf(html, filename, options = {}) {
  // Mount hidden container
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "800px";
  container.style.background = "#fff";
  container.style.color = "#000";
  container.style.padding = "24px";
  container.style.fontFamily = "system-ui, -apple-system, 'Cairo', 'Amiri', 'Segoe UI', sans-serif";
  if (options.dir) container.setAttribute("dir", options.dir);
  container.innerHTML = html;
  document.body.appendChild(container);

  // Give browser one frame to lay out
  await new Promise((r) => setTimeout(r, 60));

  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW - 40; // 20pt margin each side
    const imgH = (canvas.height * imgW) / canvas.width;
    let heightLeft = imgH;
    let position = 20;
    pdf.addImage(img, "PNG", 20, position, imgW, imgH, undefined, "FAST");
    heightLeft -= pageH - 40;
    while (heightLeft > 0) {
      position = 20 - (imgH - heightLeft);
      pdf.addPage();
      pdf.addImage(img, "PNG", 20, position, imgW, imgH, undefined, "FAST");
      heightLeft -= pageH - 40;
    }
    pdf.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Print the given HTML fragment via the browser print dialog
 * (native way to print to physical printer OR save as PDF).
 */
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
    </head><body>${html}<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`);
  w.document.close();
}
