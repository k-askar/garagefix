import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Save, Upload, Palette, Image as ImageIcon, AlertTriangle, QrCode, Building2, FileText, Wallet, Sparkles, AlignLeft, AlignCenter, AlignRight, Check, Gift } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { useLang } from "@/i18n";
import BackupPanel from "@/components/BackupPanel";

/* Small live SEPA/iDEAL QR preview so the owner can see what will be printed. */
function SepaQrPreview({ iban, bic, name, amount = 121, reference = "INV-DEMO" }) {
  const [dataUrl, setDataUrl] = useState("");
  const cleanIban = String(iban || "").replace(/\s+/g, "").toUpperCase();
  useEffect(() => {
    let cancelled = false;
    if (!cleanIban) { setDataUrl(""); return; }
    const payload = [
      "BCD", "002", "1", "SCT",
      String(bic || "").toUpperCase().trim(),
      String(name || "Garage").slice(0, 70),
      cleanIban,
      `EUR${Number(amount || 0).toFixed(2)}`,
      "", "",
      String(reference || "").slice(0, 140),
      "",
    ].join("\n");
    QRCode.toDataURL(payload, { margin: 1, width: 180, errorCorrectionLevel: "M" })
      .then((u) => { if (!cancelled) setDataUrl(u); })
      .catch(() => { if (!cancelled) setDataUrl(""); });
    return () => { cancelled = true; };
  }, [cleanIban, bic, name, amount, reference]);
  if (!dataUrl) return null;
  return (
    <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="sepa-qr-preview">
      <img src={dataUrl} alt="SEPA QR preview" className="w-20 h-20 rounded bg-white p-1 border border-border" />
      <div className="text-[11px] text-muted-foreground leading-relaxed">
        <div className="font-semibold text-foreground">iDEAL / SEPA GiroCode</div>
        <div>يمسحه العميل بأي تطبيق مصرفي (ING · ABN · Rabobank …)</div>
        <div className="font-mono mt-1">IBAN {cleanIban.match(/.{1,4}/g)?.join(" ")}</div>
      </div>
    </div>
  );
}

const DEFAULT_FORM = {
  name: "", address: "", phone: "", email: "", tax_id: "",
  footer_note: "Thank you for choosing us!",
  logo_url: "/logo-shawish.png",
  labor_rate: 45, default_tax_rate: 21,
  invoice_accent_color: "#0EA5E9", invoice_prefix: "INV",
  payment_terms_days: 14,
  iban: "", kvk_number: "", invoice_terms: "",
  show_plate_badge: true,
  bank_name: "", bic: "",
  invoice_show_qr: true,
  invoice_header_align: "left",
  invoice_currency_symbol_pos: "suffix",
  invoice_template: "classic",
  loyalty_enabled: true, loyalty_threshold: 5, loyalty_discount_eur: 25,
  default_language: "nl",
};

/* Curated colour presets — one-click swap, dynamic accent everywhere. */
const COLOR_PRESETS = [
  { name: "Ocean",    value: "#0EA5E9" },
  { name: "Emerald",  value: "#10B981" },
  { name: "Sunset",   value: "#F59E0B" },
  { name: "Rose",     value: "#F43F5E" },
  { name: "Violet",   value: "#8B5CF6" },
  { name: "Midnight", value: "#0F172A" },
  { name: "Graphite", value: "#374151" },
  { name: "Crimson",  value: "#DC2626" },
];

/* Invoice template variants — each maps to invoice_template + a rough preview. */
const TEMPLATES = [
  { id: "classic", label: "Classic", desc: "Solid accent header · full colour band" },
  { id: "minimal", label: "Minimal", desc: "Thin rule · lots of white-space" },
  { id: "bold",    label: "Bold",    desc: "Heavy display type · dark totals" },
];

/* Alignments for the header + logo row. */
const ALIGNMENTS = [
  { id: "left",   Icon: AlignLeft   },
  { id: "center", Icon: AlignCenter },
  { id: "right",  Icon: AlignRight  },
];

/* Live invoice preview — mirrors invoice-render.js so every settings toggle
   (accent, template, alignment, currency, prefix, QR, plate) shows up here
   BEFORE the owner even hits Save. */
function InvoicePreview({ form }) {
  const accent = form.invoice_accent_color || "#0EA5E9";
  const logo = form.logo_url;
  const logoSrc = logo?.startsWith("/api/") ? `${process.env.REACT_APP_BACKEND_URL}${logo}` : logo;
  const template = form.invoice_template || "classic";
  const align = form.invoice_header_align || "left";
  const alignClass = align === "center" ? "items-center text-center" : align === "right" ? "items-end text-right" : "items-start text-left";
  const flexDir = align === "right" ? "flex-row-reverse" : "flex-row";
  const currencyPos = form.invoice_currency_symbol_pos || "suffix";
  const fmt = (n) => currencyPos === "prefix"
    ? `€ ${Number(n).toFixed(2)}`
    : `${Number(n).toFixed(2).replace(".", ",")} €`;
  const taxRate = form.default_tax_rate || 21;
  const subtotal = 100;
  const tax = (subtotal * taxRate) / 100;
  const total = subtotal + tax;

  return (
    <div className="p-6 bg-white text-black rounded-md border border-border shadow-sm text-sm relative overflow-hidden" data-testid="invoice-preview">
      {/* Template-specific top band */}
      {template === "classic" && <div style={{ height: 6, background: accent, marginTop: -24, marginLeft: -24, marginRight: -24, marginBottom: 18 }} />}
      {template === "bold"    && <div style={{ height: 3, background: "#000", marginTop: -24, marginLeft: -24, marginRight: -24, marginBottom: 18 }} />}

      {/* Header row — alignment dynamic, mirrors invoice-render.js layout */}
      <div className={`flex ${align === "right" ? "flex-row-reverse" : "flex-row"} items-start justify-between gap-3 ${align === "center" ? "!flex-col " + alignClass : ""}`}>
        <div className={`flex ${align === "center" ? "flex-col items-center" : "items-center"} gap-3 min-w-0`}>
          {logoSrc && <img src={logoSrc} alt="logo" className="h-12 w-auto object-contain shrink-0" style={{ maxWidth: 130 }} />}
          <div className={align === "center" ? "text-center" : ""}>
            <div className={template === "bold" ? "font-black text-xl leading-tight" : "font-bold text-lg leading-tight"}>{form.name || "Garage"}</div>
            <div className="text-[11px] text-gray-500 whitespace-pre-line">{form.address}</div>
            <div className="text-[11px] text-gray-500">{form.phone}{form.email ? " · " + form.email : ""}</div>
            {form.tax_id && <div className="text-[11px] text-gray-500">BTW: {form.tax_id}</div>}
            {form.kvk_number && <div className="text-[11px] text-gray-500">KvK: {form.kvk_number}</div>}
          </div>
        </div>
        <div className={align === "center" ? "text-center" : "text-right"}>
          <span
            className={`inline-block ${template === "bold" ? "px-4 py-1 rounded-none" : "px-3 py-0.5 rounded-full"} text-[10px] tracking-widest text-white font-bold`}
            style={{ background: accent }}
          >INVOICE</span>
          <div className="font-mono font-bold mt-1 whitespace-nowrap">{form.invoice_prefix || "INV"}-260821-DEMO</div>
          <div className="text-[11px] text-gray-500">21/08/2026</div>
        </div>
      </div>

      {/* Divider — template-specific */}
      {template === "classic" && <hr className="my-4" style={{ borderColor: accent, borderWidth: "0 0 2px 0" }} />}
      {template === "minimal" && <hr className="my-4" style={{ borderColor: accent, borderWidth: "0 0 1px 0" }} />}
      {template === "bold"    && <hr className="my-4" style={{ borderColor: "#000", borderWidth: "0 0 3px 0" }} />}

      {/* Bill to */}
      <div className={`${template === "classic" ? "rounded p-2 -mx-2" : ""}`} style={template === "classic" ? { background: `${accent}15`, borderLeft: `3px solid ${accent}` } : {}}>
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Bill to</div>
        <div className="font-semibold">Ahmed Al-Farsi</div>
      </div>

      {/* Items table */}
      <table className="w-full mt-3 border-collapse text-[12px]">
        <thead>
          <tr style={template === "bold" ? { background: "#000", color: "#fff" } : { background: "#f5f5f5" }}>
            <th className="text-left p-2 border-b">Item</th>
            <th className="text-right p-2 border-b">Qty</th>
            <th className="text-right p-2 border-b">Price</th>
            <th className="text-right p-2 border-b">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr><td className="p-2 border-b">Brake pads front set</td><td className="text-right p-2 border-b">1</td><td className="text-right p-2 border-b font-mono">{fmt(45)}</td><td className="text-right p-2 border-b font-mono">{fmt(45)}</td></tr>
          <tr><td className="p-2 border-b">Labor</td><td className="text-right p-2 border-b">1</td><td className="text-right p-2 border-b font-mono">{fmt(55)}</td><td className="text-right p-2 border-b font-mono">{fmt(55)}</td></tr>
        </tbody>
      </table>

      {/* Totals */}
      <div className="text-right mt-3 text-[12px] space-y-0.5">
        <div className="text-gray-500 font-mono">Subtotal: {fmt(subtotal)}</div>
        <div className="text-gray-500 font-mono">BTW ({taxRate}%): {fmt(tax)}</div>
        <div className="font-mono pt-1 mt-1 border-t" style={template === "bold"
          ? { fontSize: 16, fontWeight: 900, color: "#000", borderColor: "#000" }
          : { fontSize: 15, fontWeight: 800, color: accent, borderColor: "#ddd" }}>
          Total: {fmt(total)}
        </div>
      </div>

      {/* Plate badge — matches the job card / PlateBadge component */}
      {form.show_plate_badge && (
        <div className="mt-4 text-[11px] text-gray-600 flex items-center gap-2 flex-wrap">
          <span>Repair JOB-260821-DEMO ·</span>
          <span
            className="inline-block relative align-middle"
            style={{
              background: "#FFCB05", color: "#000",
              border: "2px solid #000", borderRadius: 4,
              padding: "3px 10px 3px 30px",
              fontFamily: "'Arial Black',Impact,'Helvetica Neue',sans-serif",
              fontWeight: 900, fontSize: 13, letterSpacing: "0.14em", lineHeight: 1.15,
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                position: "absolute", left: 0, top: 0, bottom: 0, width: 24,
                background: "#003399", color: "#fff", fontSize: 9,
                letterSpacing: "0.06em", display: "flex", alignItems: "center",
                justifyContent: "center", fontWeight: 900,
                borderTopLeftRadius: 2, borderBottomLeftRadius: 2,
                borderRight: "1px solid rgba(0,0,0,.15)",
              }}
            >NL</span>
            KK-555-D
          </span>
        </div>
      )}

      {/* SEPA QR placeholder */}
      {form.invoice_show_qr && form.iban && (
        <div
          className="mt-4 p-3 rounded flex items-center gap-3"
          style={{ border: `2px solid ${accent}`, background: "#fff" }}
        >
          <div className="w-16 h-16 shrink-0 grid place-items-center bg-black/5 rounded font-mono text-[9px] text-gray-500">QR</div>
          <div className="text-[10px] text-gray-600 leading-tight">
            <div className="font-bold text-black">Betaal met iDEAL / SEPA</div>
            <div className="font-mono">IBAN {String(form.iban).replace(/\s+/g, "").toUpperCase().match(/.{1,4}/g)?.join(" ")}</div>
            <div>Reference: <strong>{form.invoice_prefix || "INV"}-260821-DEMO</strong></div>
          </div>
        </div>
      )}

      {form.invoice_terms && (
        <div className="mt-4 text-[10px] text-gray-500 whitespace-pre-line border-t pt-2">{form.invoice_terms}</div>
      )}
      {form.iban && !form.invoice_show_qr && <div className="mt-2 text-[11px] text-gray-500">IBAN: <span className="font-mono">{form.iban}</span></div>}
      <div className="mt-1 text-[11px] text-gray-500">Payment due within {form.payment_terms_days || 14} days.</div>
      <p className="text-center text-[11px] text-gray-500 mt-4">{form.footer_note}</p>
    </div>
  );
}

export default function Settings() {
  const { t } = useLang();
  const qc = useQueryClient();
  const { data, refetch } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then((r) => r.data) });
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoRef = useRef(null);

  useEffect(() => { if (data) setForm({ ...DEFAULT_FORM, ...data }); }, [data]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: saved } = await api.put("/settings", form);
      // Push the fresh settings into every other page's React-Query cache
      // (Invoices / Repairs / Party / …) so the new template, colour and
      // toggles apply immediately without a browser reload.
      qc.setQueryData(["settings"], saved || form);
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Garage details saved · تم تطبيق التصميم على كل الفواتير");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  const uploadLogo = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    if (f.size > 3 * 1024 * 1024) return toast.error("Max 3 MB");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await api.post("/settings/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm(fr => ({ ...fr, logo_url: res.data.logo_url }));
      refetch();
      toast.success("Logo updated");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setUploading(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const logoSrc = form.logo_url?.startsWith("/api/")
    ? `${process.env.REACT_APP_BACKEND_URL}${form.logo_url}`
    : form.logo_url;

  return (
    <div className="space-y-8 max-w-6xl" data-testid="settings-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Business</div>
        <h1 className="font-display text-4xl font-black tracking-tight">Garage settings</h1>
        <p className="text-muted-foreground mt-2">Details on every receipt, and how your invoices look.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_460px] gap-8">
        <form onSubmit={submit} className="space-y-6">
          {/* ═══════════════ SECTION 1 · BRANDING ═══════════════ */}
          <Card className="p-6 border-border">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center"><Building2 className="h-4 w-4 text-primary" /></div>
              <div>
                <h3 className="font-display text-base font-bold leading-tight">Branding</h3>
                <p className="text-[11px] text-muted-foreground">Naam · logo · contactgegevens</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t("garageName")}</Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="settings-name" />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Logo</Label>
                <div className="flex items-center gap-3">
                  {form.logo_url && (
                    <div className="p-3 rounded-md bg-black/90 border border-border shrink-0">
                      <img src={logoSrc} alt="logo preview" className="h-14 w-auto object-contain" />
                    </div>
                  )}
                  <div className="flex flex-col gap-2 flex-1">
                    <Button type="button" variant="outline" onClick={() => logoRef.current?.click()} disabled={uploading} className="rounded-full" data-testid="settings-logo-upload">
                      <Upload className="h-4 w-4 mr-2" /> {uploading ? "Uploading..." : "Upload new logo"}
                    </Button>
                    <input ref={logoRef} hidden type="file" accept="image/*" onChange={uploadLogo} data-testid="settings-logo-file" />
                    <Input value={form.logo_url || ""} onChange={(e) => set("logo_url", e.target.value)} placeholder="or paste URL / path" className="text-xs font-mono" data-testid="settings-logo-url" />
                    <p className="text-[11px] text-muted-foreground">PNG, JPG, WebP or SVG · up to 3 MB.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5"><Label>Address</Label><Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} data-testid="settings-address" /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} data-testid="settings-phone" /></div>
                <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
                <div className="space-y-1.5"><Label>VAT / BTW nr</Label><Input value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} data-testid="settings-tax-id" /></div>
                <div className="space-y-1.5"><Label>KvK nr</Label><Input value={form.kvk_number} onChange={(e) => set("kvk_number", e.target.value)} data-testid="settings-kvk" /></div>
                <div className="space-y-1.5"><Label>Labor rate (€ / h)</Label><Input type="number" step="0.5" min="0" value={form.labor_rate} onChange={(e) => set("labor_rate", Number(e.target.value))} data-testid="settings-labor-rate" /></div>
                <div className="space-y-1.5"><Label>Default BTW (%)</Label><Input type="number" step="0.1" min="0" max="100" value={form.default_tax_rate} onChange={(e) => set("default_tax_rate", Number(e.target.value))} data-testid="settings-tax-rate" /></div>
              </div>
            </div>
          </Card>

          {/* ═══════════════ SECTION 2 · INVOICE LOOK & FEEL ═══════════════ */}
          <Card className="p-6 border-border">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center"><Sparkles className="h-4 w-4 text-primary" /></div>
              <div>
                <h3 className="font-display text-base font-bold leading-tight">Invoice look & feel</h3>
                <p className="text-[11px] text-muted-foreground">اختر لون التمييز، القالب، والمحاذاة — كل شيء يظهر مباشرة في المعاينة</p>
              </div>
            </div>

            {/* Colour palette chips + custom picker */}
            <div className="space-y-2 mb-5">
              <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Palette className="h-3 w-3" /> Accent color</Label>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {COLOR_PRESETS.map(p => {
                  const active = form.invoice_accent_color?.toLowerCase() === p.value.toLowerCase();
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => set("invoice_accent_color", p.value)}
                      className={`group aspect-square rounded-lg border-2 transition-all relative ${active ? "border-foreground shadow-md scale-105" : "border-border hover:scale-105"}`}
                      style={{ background: p.value }}
                      title={p.name}
                      data-testid={`color-preset-${p.name.toLowerCase()}`}
                    >
                      {active && <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input type="color" value={form.invoice_accent_color || "#0EA5E9"} onChange={(e) => set("invoice_accent_color", e.target.value)} className="h-9 w-12 rounded-md border border-border cursor-pointer bg-transparent" data-testid="settings-accent-color" />
                <Input value={form.invoice_accent_color || ""} onChange={(e) => set("invoice_accent_color", e.target.value)} className="font-mono uppercase h-9 max-w-[140px]" placeholder="#0EA5E9" />
                <span className="text-[10px] text-muted-foreground">أو اختر لوناً مخصصاً</span>
              </div>
            </div>

            {/* Invoice template visual cards */}
            <div className="space-y-2 mb-5">
              <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Invoice template</Label>
              <div className="grid grid-cols-3 gap-2">
                {TEMPLATES.map(tp => {
                  const active = (form.invoice_template || "classic") === tp.id;
                  return (
                    <button
                      key={tp.id}
                      type="button"
                      onClick={() => set("invoice_template", tp.id)}
                      className={`text-left rounded-lg border p-3 transition-all ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40"}`}
                      data-testid={`template-${tp.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{tp.label}</span>
                        {active && <Check className="h-3.5 w-3.5 text-primary" />}
                      </div>
                      {/* Miniature preview strip */}
                      <div className="mt-2 h-14 rounded overflow-hidden bg-white relative" style={{ border: "1px solid #eee" }}>
                        {tp.id === "classic" && (
                          <>
                            <div style={{ height: 14, background: form.invoice_accent_color || "#0EA5E9" }} />
                            <div className="p-1 space-y-0.5">
                              <div className="h-1 w-1/3 bg-gray-300 rounded" />
                              <div className="h-1 w-1/2 bg-gray-200 rounded" />
                              <div className="h-1 w-2/5 bg-gray-200 rounded" />
                            </div>
                          </>
                        )}
                        {tp.id === "minimal" && (
                          <div className="p-1.5 space-y-1">
                            <div className="h-1.5 w-1/3 bg-gray-800 rounded" />
                            <div className="h-[1px]" style={{ background: form.invoice_accent_color || "#0EA5E9" }} />
                            <div className="h-1 w-1/2 bg-gray-200 rounded" />
                            <div className="h-1 w-2/5 bg-gray-200 rounded" />
                          </div>
                        )}
                        {tp.id === "bold" && (
                          <div className="p-1.5 space-y-1">
                            <div className="h-2.5 w-2/5 rounded" style={{ background: form.invoice_accent_color || "#0EA5E9" }} />
                            <div className="h-1 w-1/2 bg-gray-300 rounded" />
                            <div className="h-1.5 w-3/5 bg-black rounded" />
                          </div>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1.5 leading-tight">{tp.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Header alignment + currency */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <div className="space-y-2">
                <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Header alignment</Label>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-full border border-border bg-muted/40">
                  {ALIGNMENTS.map(({ id, Icon }) => {
                    const active = (form.invoice_header_align || "left") === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => set("invoice_header_align", id)}
                        className={`h-9 rounded-full flex items-center justify-center transition-colors ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid={`align-${id}`}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Currency symbol</Label>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-full border border-border bg-muted/40">
                  {[["suffix", "12,50 €"], ["prefix", "€ 12.50"]].map(([id, label]) => {
                    const active = (form.invoice_currency_symbol_pos || "suffix") === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => set("invoice_currency_symbol_pos", id)}
                        className={`h-9 rounded-full text-xs font-mono transition-colors ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                        data-testid={`currency-${id}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Invoice numbering + payment term */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <div className="space-y-1.5">
                <Label>Invoice number prefix</Label>
                <Input value={form.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value)} placeholder="INV" className="font-mono" data-testid="settings-invoice-prefix" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment term</Label>
                <Select value={String(form.payment_terms_days || 14)} onValueChange={(v) => set("payment_terms_days", Number(v))}>
                  <SelectTrigger data-testid="settings-payment-terms"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="21">21 days</SelectItem>
                    <SelectItem value="30">30 days (1 month)</SelectItem>
                    <SelectItem value="45">45 days</SelectItem>
                    <SelectItem value="60">60 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Toggle rows — dynamic customisation */}
            <div className="space-y-2">
              <ToggleRow
                icon={<QrCode className="h-4 w-4 text-primary" />}
                title="iDEAL / SEPA QR code"
                desc="يضيف رمز QR على كل فاتورة — يمسحه العميل من تطبيق مصرفي هولندي ليدفع بضغطة واحدة."
                checked={!!form.invoice_show_qr}
                onCheck={(v) => set("invoice_show_qr", v)}
                testId="settings-show-qr"
                accent
              />
              <ToggleRow
                icon={<span className="text-lg leading-none">🇪🇺</span>}
                title={t("plateBadgeToggle") || "لوحة السيارة الرسمية (متعددة الدول)"}
                desc={t("plateBadgeToggleDesc") || "يعرض رقم اللوحة بتصميم رسمي حسب الدولة — أصفر NL هولندي، أبيض D ألماني، أزرق F فرنسي، …"}
                checked={!!form.show_plate_badge}
                onCheck={(v) => set("show_plate_badge", v)}
                testId="settings-plate-badge"
              />
            </div>

            {/* Terms + footer */}
            <div className="grid grid-cols-1 gap-4 mt-5">
              <div className="space-y-1.5">
                <Label>Payment & warranty terms</Label>
                <Textarea rows={3} value={form.invoice_terms} onChange={(e) => set("invoice_terms", e.target.value)} placeholder="Payment within 14 days.  6 months warranty on parts and labor.  Complaints must be filed within 7 days." data-testid="settings-terms" />
              </div>
              <div className="space-y-1.5">
                <Label>Receipt footer</Label>
                <Input value={form.footer_note} onChange={(e) => set("footer_note", e.target.value)} placeholder="Thank you for choosing us!" data-testid="settings-footer" />
              </div>
            </div>
          </Card>

          {/* ═══════════════ SECTION 3 · PAYMENT / BANK ═══════════════ */}
          <Card className="p-6 border-border">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-md bg-emerald-500/15 flex items-center justify-center"><Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /></div>
              <div>
                <h3 className="font-display text-base font-bold leading-tight">Payment details</h3>
                <p className="text-[11px] text-muted-foreground">IBAN لتفعيل QR الدفع على كل فاتورة</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>IBAN (bank account)</Label>
                <Input value={form.iban} onChange={(e) => set("iban", e.target.value.toUpperCase())} placeholder="NL91 ABNA 0417 1643 00" className="font-mono uppercase" data-testid="settings-iban" />
                {!form.iban && form.invoice_show_qr && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-300" data-testid="iban-missing-warning">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>أدخل رقم IBAN لتظهر رمزية الدفع iDEAL / SEPA على الفواتير.</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Bank name</Label><Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} placeholder="ABN AMRO / ING / …" data-testid="settings-bank-name" /></div>
                <div className="space-y-1.5"><Label>BIC / SWIFT</Label><Input value={form.bic} onChange={(e) => set("bic", e.target.value.toUpperCase())} placeholder="ABNANL2A" className="font-mono uppercase" data-testid="settings-bic" /></div>
              </div>
              {form.iban && form.invoice_show_qr && (<SepaQrPreview iban={form.iban} bic={form.bic} name={form.name} />)}
            </div>
          </Card>

          {/* ═══════════════ SECTION 4 · LOYALTY ═══════════════ */}
          <Card className="p-6 border-border">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-md bg-rose-500/15 flex items-center justify-center"><Gift className="h-4 w-4 text-rose-600 dark:text-rose-400" /></div>
              <div>
                <h3 className="font-display text-base font-bold leading-tight">Loyalty rewards</h3>
                <p className="text-[11px] text-muted-foreground">مكافأة تلقائية للزبائن العائدين</p>
              </div>
            </div>
            <ToggleRow
              icon={<Gift className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
              title="Give returning customers an automatic € discount"
              desc="Every N paid invoices they earn a reward that is auto-applied as a line item on their next invoice."
              checked={!!form.loyalty_enabled}
              onCheck={(v) => set("loyalty_enabled", v)}
              testId="settings-loyalty-enabled"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
              <div className="space-y-1.5">
                <Label>Reward every N paid invoices</Label>
                <Input type="number" min="1" max="50" value={form.loyalty_threshold} onChange={(e) => set("loyalty_threshold", Math.max(1, Number(e.target.value) || 1))} disabled={!form.loyalty_enabled} data-testid="settings-loyalty-threshold" />
              </div>
              <div className="space-y-1.5">
                <Label>Discount amount (€)</Label>
                <Input type="number" step="0.5" min="0" value={form.loyalty_discount_eur} onChange={(e) => set("loyalty_discount_eur", Number(e.target.value) || 0)} disabled={!form.loyalty_enabled} data-testid="settings-loyalty-amount" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">Example — every {form.loyalty_threshold || 5} paid invoices, {formatEUR(form.loyalty_discount_eur || 25)} is deducted from the customer's next invoice.</p>
          </Card>

          {/* Sticky save */}
          <div className="sticky bottom-4 z-10 flex justify-end">
            <Button type="submit" disabled={saving} className="rounded-full bg-primary hover:bg-primary/90 shadow-lg h-11 px-6" data-testid="settings-save">
              <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save all changes"}
            </Button>
          </div>
        </form>

        {/* Live preview — sticky */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="text-[11px] font-mono uppercase tracking-widest text-primary">Live preview</div>
          <InvoicePreview form={form} />
        </div>
      </div>

      <BackupPanel />
    </div>
  );
}

/* Reusable toggle row used across all sections — consistent visual language. */
function ToggleRow({ icon, title, desc, checked, onCheck, testId, accent = false }) {
  return (
    <div className={`flex items-center justify-between rounded-md border p-3 gap-3 ${accent ? "border-primary/30 bg-primary/5" : "border-border"}`}>
      <div className="flex items-start gap-2 min-w-0">
        <div className="shrink-0 mt-0.5">{icon}</div>
        <div className="min-w-0">
          <Label className="cursor-pointer">{title}</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheck} data-testid={testId} />
    </div>
  );
}
