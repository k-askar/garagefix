import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Save, Upload, Palette, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";
import BackupPanel from "@/components/BackupPanel";

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
};

// Same yellow-plate mock used in printInvoice; here for the preview only.
function InvoicePreview({ form }) {
  const accent = form.invoice_accent_color || "#0EA5E9";
  const logo = form.logo_url;
  const logoSrc = logo?.startsWith("/api/") ? `${process.env.REACT_APP_BACKEND_URL}${logo}` : logo;
  return (
    <div className="p-6 bg-white text-black rounded-md border border-border shadow-sm text-sm" data-testid="invoice-preview">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          {logoSrc && <img src={logoSrc} alt="logo" className="h-12 w-auto object-contain" />}
          <div>
            <div className="font-bold text-lg">{form.name || "Garage"}</div>
            <div className="text-[11px] text-gray-500 whitespace-pre-line">{form.address}</div>
            <div className="text-[11px] text-gray-500">{form.phone}{form.email ? " · " + form.email : ""}</div>
            {form.tax_id && <div className="text-[11px] text-gray-500">VAT / BTW: {form.tax_id}</div>}
            {form.kvk_number && <div className="text-[11px] text-gray-500">KvK: {form.kvk_number}</div>}
          </div>
        </div>
        <div className="text-right">
          <span
            className="inline-block px-3 py-0.5 rounded-full text-[10px] tracking-widest text-white font-bold"
            style={{ background: accent }}
          >INVOICE</span>
          <div className="font-mono font-bold mt-1">{form.invoice_prefix || "INV"}-260821-DEMO</div>
          <div className="text-[11px] text-gray-500">21/08/2026</div>
        </div>
      </div>
      <hr className="my-4" style={{ borderColor: accent, borderWidth: "0 0 2px 0" }} />
      <div className="text-[10px] uppercase tracking-widest text-gray-500">Bill to</div>
      <div className="font-semibold">Ahmed Al-Farsi</div>
      <table className="w-full mt-3 border-collapse text-[12px]">
        <thead>
          <tr style={{ background: "#f5f5f5" }}>
            <th className="text-left p-2 border-b">Item</th>
            <th className="text-right p-2 border-b">Qty</th>
            <th className="text-right p-2 border-b">Price</th>
            <th className="text-right p-2 border-b">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr><td className="p-2 border-b">Brake pads front set</td><td className="text-right p-2 border-b">1</td><td className="text-right p-2 border-b">45,00 €</td><td className="text-right p-2 border-b">45,00 €</td></tr>
          <tr><td className="p-2 border-b">Labor</td><td className="text-right p-2 border-b">1</td><td className="text-right p-2 border-b">55,00 €</td><td className="text-right p-2 border-b">55,00 €</td></tr>
        </tbody>
      </table>
      <div className="text-right mt-2 text-[12px]">
        <div className="text-gray-500">Subtotal: 100,00 €</div>
        <div className="text-gray-500">BTW ({form.default_tax_rate || 21}%): {((100 * (form.default_tax_rate || 21)) / 100).toFixed(2)} €</div>
        <div className="font-bold mt-1">Total: {(100 + (100 * (form.default_tax_rate || 21)) / 100).toFixed(2)} €</div>
      </div>
      {form.show_plate_badge && (
        <div className="mt-4 text-[11px] text-gray-500">
          Repair JOB-260821-DEMO ·{" "}
          <span
            className="inline-flex items-center gap-1 px-2 py-[3px] rounded font-mono font-bold border border-black/40"
            style={{ background: "#FFC900", color: "#000", letterSpacing: "0.08em", fontSize: "11px" }}
          >
            <span style={{ background: "#003399", color: "#fff", fontSize: "7px", padding: "1px 4px", borderRadius: "2px" }}>NL</span>
            NL-COR-02
          </span>
        </div>
      )}
      {form.invoice_terms && (
        <div className="mt-4 text-[10px] text-gray-500 whitespace-pre-line border-t pt-2">{form.invoice_terms}</div>
      )}
      {form.iban && <div className="mt-2 text-[11px] text-gray-500">IBAN: <span className="font-mono">{form.iban}</span></div>}
      <div className="mt-1 text-[11px] text-gray-500">Payment due within {form.payment_terms_days || 14} days.</div>
      <p className="text-center text-[11px] text-gray-500 mt-4">{form.footer_note}</p>
    </div>
  );
}

export default function Settings() {
  const { t } = useLang();
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
      await api.put("/settings", form);
      toast.success("Garage details saved");
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
        <Card className="p-8 border-border">
          <form onSubmit={submit} className="space-y-6">
            {/* --- Business details --- */}
            <section className="space-y-4">
              <h3 className="font-display text-lg font-bold border-b border-border pb-2">Business</h3>
              <div className="space-y-1.5">
                <Label>{t("garageName")}</Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="settings-name" />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Logo</Label>
                <div className="flex items-center gap-3">
                  {form.logo_url && (
                    <div className="p-3 rounded-md bg-black/90 border border-border">
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

              <div className="space-y-1.5">
                <Label>Address</Label>
                <Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} data-testid="settings-address" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} data-testid="settings-phone" /></div>
                <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>VAT / BTW nr</Label><Input value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} data-testid="settings-tax-id" /></div>
                <div className="space-y-1.5"><Label>KvK nr</Label><Input value={form.kvk_number} onChange={(e) => set("kvk_number", e.target.value)} data-testid="settings-kvk" /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Labor rate (€ / h)</Label>
                  <Input type="number" step="0.5" min="0" value={form.labor_rate} onChange={(e) => set("labor_rate", Number(e.target.value))} data-testid="settings-labor-rate" />
                </div>
                <div className="space-y-1.5">
                  <Label>Default BTW (%)</Label>
                  <Input type="number" step="0.1" min="0" max="100" value={form.default_tax_rate} onChange={(e) => set("default_tax_rate", Number(e.target.value))} data-testid="settings-tax-rate" />
                </div>
              </div>
            </section>

            {/* --- Invoice customization --- */}
            <section className="space-y-4 pt-2">
              <h3 className="font-display text-lg font-bold border-b border-border pb-2 flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" /> Invoice look & feel
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Accent color</Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={form.invoice_accent_color || "#0EA5E9"}
                      onChange={(e) => set("invoice_accent_color", e.target.value)}
                      className="h-10 w-14 rounded-md border border-border cursor-pointer bg-transparent"
                      data-testid="settings-accent-color"
                    />
                    <Input
                      value={form.invoice_accent_color || ""}
                      onChange={(e) => set("invoice_accent_color", e.target.value)}
                      className="font-mono uppercase"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Invoice number prefix</Label>
                  <Input value={form.invoice_prefix} onChange={(e) => set("invoice_prefix", e.target.value)} placeholder="INV" data-testid="settings-invoice-prefix" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>IBAN (bank account)</Label>
                <Input value={form.iban} onChange={(e) => set("iban", e.target.value)} placeholder="NL91 ABNA 0417 1643 00" className="font-mono" data-testid="settings-iban" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Bank name</Label>
                  <Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} placeholder="ABN AMRO / ING / ..." data-testid="settings-bank-name" />
                </div>
                <div className="space-y-1.5">
                  <Label>BIC / SWIFT</Label>
                  <Input value={form.bic} onChange={(e) => set("bic", e.target.value)} placeholder="ABNANL2A" className="font-mono uppercase" data-testid="settings-bic" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Header alignment</Label>
                  <Select value={form.invoice_header_align || "left"} onValueChange={(v) => set("invoice_header_align", v)}>
                    <SelectTrigger data-testid="settings-header-align"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left (default)</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Currency symbol position</Label>
                  <Select value={form.invoice_currency_symbol_pos || "suffix"} onValueChange={(v) => set("invoice_currency_symbol_pos", v)}>
                    <SelectTrigger data-testid="settings-currency-pos"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="suffix">Suffix — 12,50 €</SelectItem>
                      <SelectItem value="prefix">Prefix — € 12.50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label className="cursor-pointer">Show SEPA payment QR code</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Adds a scannable QR (IBAN + total + reference) so customers can pay in one tap with any banking app.</p>
                </div>
                <Switch checked={!!form.invoice_show_qr} onCheckedChange={(v) => set("invoice_show_qr", v)} data-testid="settings-show-qr" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment term</Label>
                <Select value={String(form.payment_terms_days || 14)} onValueChange={(v) => set("payment_terms_days", Number(v))}>
                  <SelectTrigger data-testid="settings-payment-terms"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="21">21 days</SelectItem>
                    <SelectItem value="30">30 days (1 month)</SelectItem>
                    <SelectItem value="45">45 days</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Invoices are due after this period. Overdue invoices are emailed automatically every morning.</p>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label className="cursor-pointer">Show yellow NL plate on invoice</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Highlight the linked vehicle plate as a Dutch registration plate.</p>
                </div>
                <Switch checked={!!form.show_plate_badge} onCheckedChange={(v) => set("show_plate_badge", v)} data-testid="settings-plate-badge" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment & warranty terms</Label>
                <Textarea rows={3} value={form.invoice_terms} onChange={(e) => set("invoice_terms", e.target.value)} placeholder="Payment within 14 days.  6 months warranty on parts and labor.  Complaints must be filed within 7 days." data-testid="settings-terms" />
              </div>
              <div className="space-y-1.5">
                <Label>Receipt footer</Label>
                <Input value={form.footer_note} onChange={(e) => set("footer_note", e.target.value)} placeholder="Thank you for choosing us!" data-testid="settings-footer" />
              </div>
            </section>

            <Button type="submit" disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="settings-save">
              <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save details"}
            </Button>
          </form>
        </Card>

        <div className="space-y-3">
          <div className="text-[11px] font-mono uppercase tracking-widest text-primary">Live preview</div>
          <InvoicePreview form={form} />
        </div>
      </div>

      <BackupPanel />
    </div>
  );
}
