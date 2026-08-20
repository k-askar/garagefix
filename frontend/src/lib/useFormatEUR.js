import { useLang } from "@/i18n";
import { formatEUR as _fmt } from "@/lib/api";

export function useFormatEUR() {
  const { meta } = useLang();
  return (v) => _fmt(v, meta?.locale || "de-DE");
}
