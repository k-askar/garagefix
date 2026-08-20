import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";

export default function Settings() {
  const { t } = useLang();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then((r) => r.data) });
  const [form, setForm] = useState({ name: "", address: "", phone: "", email: "", tax_id: "", footer_note: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/settings", form);
      toast.success("Garage details saved");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-8 max-w-3xl" data-testid="settings-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Business</div>
        <h1 className="font-display text-4xl font-black tracking-tight">Garage settings</h1>
        <p className="text-muted-foreground mt-2">These details appear on every customer receipt.</p>
      </div>
      <Card className="p-8 border-border">
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-1.5">
            <Label>{t("garageName")}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="settings-name" />
          </div>
          <div className="space-y-1.5">
            <Label>Logo URL</Label>
            <Input value={form.logo_url || ""} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="/logo-shawish.png or https://..." data-testid="settings-logo-url" />
            {form.logo_url && (
              <div className="mt-2 p-3 rounded-md bg-black/90 border border-border inline-block">
                <img src={form.logo_url} alt="logo preview" className="h-12 w-auto object-contain" />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="settings-address" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="settings-phone" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Tax ID / VAT</Label>
            <Input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Labor rate (€ / hour)</Label>
            <Input type="number" step="0.5" min="0" value={form.labor_rate ?? 45} onChange={(e) => setForm({ ...form, labor_rate: Number(e.target.value) })} data-testid="settings-labor-rate" />
            <p className="text-[11px] text-muted-foreground">Used by the labor time clock on repair cards to auto-fill the labor charge.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Receipt footer note</Label>
            <Input value={form.footer_note} onChange={(e) => setForm({ ...form, footer_note: e.target.value })} placeholder="Thank you for choosing us!" />
          </div>
          <Button type="submit" disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="settings-save">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Saving..." : "Save details"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
