import JSZip from "jszip";
import { saveAs } from "file-saver";
import { renderInvoiceHtml } from "@/lib/invoice-render";
import { htmlToPdfBlob } from "@/lib/pdf";

/* Re-export so existing imports keep working. */
export async function invoiceToHtml(inv, settings) {
  return await renderInvoiceHtml(inv, settings);
}

/**
 * Build a ZIP archive with one real PDF file per invoice.
 * `onProgress(done, total)` is optional and useful for UI feedback.
 */
export async function downloadInvoicesZip(invoices, settings, filename = "invoices.zip", onProgress) {
  const zip = new JSZip();
  const folder = zip.folder(filename.replace(/\.zip$/, ""));
  const total = invoices.length;
  for (let i = 0; i < total; i++) {
    const inv = invoices[i];
    try {
      const html = await renderInvoiceHtml(inv, settings);
      const blob = await htmlToPdfBlob(html);
      const safe = inv.invoice_number.replace(/[^A-Za-z0-9._-]/g, "_");
      folder.file(`${safe}.pdf`, blob);
    } catch {
      /* skip broken invoice, keep going */
    }
    if (typeof onProgress === "function") onProgress(i + 1, total);
  }
  const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  saveAs(zipBlob, filename);
}
