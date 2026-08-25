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

/**
 * Return true when the horizontal band [top, bottom) of the source canvas
 * contains ANY non-white pixel — used to decide whether a would-be page
 * actually has content worth printing.  Reads the region in 300-row chunks
 * to stay memory-friendly on tall docs.
 */
function bandHasInk(canvas, top, bottom) {
  const w = canvas.width;
  const t = Math.max(0, Math.floor(top));
  const b = Math.min(canvas.height, Math.ceil(bottom));
  if (b <= t) return false;
  // Require a meaningful amount of ink (not just anti-aliasing tails).
  // 0.05% of the band's area, minimum 40 dark pixels — anything less is
  // considered "empty enough to skip".
  const bandArea = w * (b - t);
  const inkNeeded = Math.max(40, Math.round(bandArea * 0.0005));
  try {
    const ctx = canvas.getContext("2d");
    const chunk = 300;
    let dark = 0;
    for (let y0 = t; y0 < b; y0 += chunk) {
      const y1 = Math.min(b, y0 + chunk);
      const data = ctx.getImageData(0, y0, w, y1 - y0).data;
      for (let i = 0; i < data.length; i += 4) {
        // Real ink is reasonably dark — threshold 215 catches text, borders,
        // coloured headers, QR codes, plate strips, etc., while filtering
        // out light anti-aliasing tails on white backgrounds.
        if (data[i] < 215 || data[i + 1] < 215 || data[i + 2] < 215) {
          dark++;
          if (dark >= inkNeeded) return true;
        }
      }
    }
  } catch (_) {
    // If we can't inspect the canvas, err on the side of keeping the page.
    return true;
  }
  return false;
}

/**
 * Scan the source canvas from the bottom upwards and return the Y where the
 * last non-white pixel lives.  Used to trim trailing whitespace so we don't
 * create an empty page 2 just because <body> was reported taller than its
 * actual content.
 */
function findLastContentRow(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  try {
    const ctx = canvas.getContext("2d");
    const chunk = 400;
    let bottom = h;
    while (bottom > 0) {
      const top = Math.max(0, bottom - chunk);
      const data = ctx.getImageData(0, top, w, bottom - top).data;
      for (let y = bottom - top - 1; y >= 0; y--) {
        const rowStart = y * w * 4;
        let hasInk = false;
        for (let x = 0; x < w; x += 3) {
          const idx = rowStart + x * 4;
          if (data[idx] < 235 || data[idx + 1] < 235 || data[idx + 2] < 235) {
            hasInk = true;
            break;
          }
        }
        if (hasInk) return top + y;
      }
      bottom = top;
    }
  } catch (_) {
    /* CORS or memory issue — return original height. */
  }
  return h;
}

/**
 * Search backwards from `targetY` within `searchBack` px for the nearest
 * horizontal row that is (almost) entirely white — that's a safe place to
 * cut the canvas without slicing through text or coloured blocks.
 * Returns `targetY` when no suitable blank row is found.
 */
function findNearestBlankRow(canvas, targetY, searchBack) {
  const w = canvas.width;
  const startY = Math.min(canvas.height - 1, Math.max(0, targetY));
  const endY = Math.max(0, startY - searchBack);
  if (endY >= startY) return targetY;
  try {
    const ctx = canvas.getContext("2d");
    const stripe = ctx.getImageData(0, endY, w, startY - endY).data;
    // Walk from the intended cut upward — the first blank row is the best cut.
    for (let y = startY - endY - 1; y >= 0; y--) {
      let whiteCount = 0;
      const rowStart = y * w * 4;
      for (let x = 0; x < w; x++) {
        const idx = rowStart + x * 4;
        const r = stripe[idx];
        const g = stripe[idx + 1];
        const b = stripe[idx + 2];
        // Treat near-white as blank (JPEG/anti-aliasing tolerant).
        if (r > 245 && g > 245 && b > 245) whiteCount++;
      }
      if (whiteCount / w > 0.995) return endY + y;
    }
  } catch (_) {
    /* CORS-tainted canvas or huge image — fall through to naive slice. */
  }
  return targetY;
}

/**
 * Turn a rasterised canvas into a jsPDF instance (A4 portrait, multi-page).
 * Each page is a *clipped* slice of the source canvas so no content crosses
 * a page boundary — no more duplicated footer / half-cut text.
 */
function canvasToPdf(canvas) {
  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const marginX = 20;
  const marginY = 20;
  const imgW = pageW - marginX * 2;
  const contentH = pageH - marginY * 2;

  // Canvas pixels → PDF points scale (both dimensions share it).
  const scale = imgW / canvas.width;
  const fullPageCanvasPx = contentH / scale;
  // How far above the naive cut we allow the algorithm to look for whitespace.
  const searchBack = Math.round(fullPageCanvasPx * 0.18);
  // Trim trailing whitespace so a small extra body-padding never becomes an
  // empty page 2.  Add a tiny breathing gap after the last row of ink.
  const lastRow = findLastContentRow(canvas);
  const totalCanvasH = Math.min(canvas.height, lastRow + 6);

  // Fast-path: when the whole document is only slightly taller than an A4
  // (up to 10 %), squeeze the whole thing onto one page instead of breaking
  // through a text line and leaving descenders on a ghost page 2.  A tiny
  // vertical compression is invisible in an invoice and completely fixes
  // the "Thank you for choosing us! duplicated across pages" bug.
  if (totalCanvasH > fullPageCanvasPx && totalCanvasH <= fullPageCanvasPx * 1.1) {
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = totalCanvasH;
    const ctx = sliceCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, totalCanvasH);
    ctx.drawImage(canvas, 0, 0);
    pdf.addImage(
      sliceCanvas.toDataURL("image/png"),
      "PNG",
      marginX,
      marginY,
      imgW,
      contentH, // fit exactly into the page's content area
      undefined,
      "FAST"
    );
    return pdf;
  }

  let renderedH = 0;
  let pageNum = 0;
  while (renderedH < totalCanvasH) {
    const remaining = totalCanvasH - renderedH;
    // Ignore a sub-pixel tail that would create a nearly-empty extra page.
    if (pageNum > 0 && remaining < 6) break;

    let sliceH;
    if (remaining <= fullPageCanvasPx) {
      sliceH = remaining; // last page — take the rest.
    } else {
      const naiveCut = renderedH + fullPageCanvasPx;
      const smartCut = findNearestBlankRow(canvas, naiveCut, searchBack);
      // Guard: never advance by less than 60% of a page, otherwise we'd
      // create an absurd number of tiny pages on dense docs.
      sliceH = Math.max(smartCut - renderedH, Math.round(fullPageCanvasPx * 0.6));
      sliceH = Math.min(sliceH, remaining);
    }

    // Skip any would-be page that is essentially whitespace — protects against
    // subpixel artifacts / trailing body padding creating ghost pages.
    if (pageNum > 0 && !bandHasInk(canvas, renderedH, renderedH + sliceH)) {
      renderedH += sliceH;
      continue;
    }

    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceH;
    const ctx = sliceCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, sliceH);
    ctx.drawImage(canvas, 0, -renderedH);

    if (pageNum > 0) pdf.addPage();
    pdf.addImage(
      sliceCanvas.toDataURL("image/png"),
      "PNG",
      marginX,
      marginY,
      imgW,
      sliceH * scale,
      undefined,
      "FAST"
    );

    renderedH += sliceH;
    pageNum++;
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
