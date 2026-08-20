import { formatEUR } from "@/lib/api";

/** Build a wa.me link with a pre-filled message. Phone should include country code, digits only. */
export function whatsappShare({ phone, garageName = "Garage", header, lines = [], total, note, url }) {
  const clean = (phone || "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  const msg = [
    `*${garageName}*`,
    header ? `_${header}_` : "",
    "",
    ...lines,
    total ? `*Total: ${formatEUR(total)}*` : "",
    note ? `\n${note}` : "",
    url ? `\n${url}` : "",
    "",
    "Please attach the PDF you just downloaded 📎",
  ].filter(Boolean).join("\n");
  const link = clean
    ? `https://wa.me/${clean}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(link, "_blank", "noopener,noreferrer");
}
