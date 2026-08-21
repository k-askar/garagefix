import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Truck, Plus, X, PackageCheck, CheckCheck, PackageX, Clock } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";
import SearchableSelect from "@/components/SearchableSelect";

const STATUS_META = {
  ordered:   { label: "Ordered",   icon: Clock,       cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40" },
  arrived:   { label: "Arrived",   icon: PackageCheck,cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40" },
  installed: { label: "Installed", icon: CheckCheck,  cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40" },
};

const STATUS_ORDER = ["ordered", "arrived", "installed"];

function StatusBadge({ status, onClick, testId }) {
  const m = STATUS_META[status] || STATUS_META.ordered;
  const Icon = m.icon;
  return (
    <button type="button" onClick={onClick} data-testid={testId} title="Cycle status" className="focus:outline-none">
      <Badge className={`${m.cls} hover:opacity-80 cursor-pointer`}><Icon className="h-3 w-3 mr-1" />{m.label}</Badge>
    </button>
  );
}

export default function SpecialPartsPanel({ card, setCard }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", quantity: 1, unit_price: "", unit_cost: "", supplier_id: "", part_number: "", expected_date: "", note: "" });
  const [busy, setBusy] = useState(false);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => api.get("/suppliers").then(r => r.data),
  });

  const parts = card.special_parts || [];
  const total = parts.reduce((s, p) => s + (p.total || 0), 0);

  const add = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const { data: updated } = await api.post(`/repairs/${card.id}/special-parts`, {
        name: form.name.trim(),
        quantity: Number(form.quantity) || 1,
        unit_price: Number(form.unit_price) || 0,
        unit_cost: Number(form.unit_cost) || 0,
        supplier_id: form.supplier_id || null,
        part_number: form.part_number.trim(),
        expected_date: form.expected_date || null,
        note: form.note.trim(),
      });
      setCard(updated);
      setForm({ name: "", quantity: 1, unit_price: "", unit_cost: "", supplier_id: "", part_number: "", expected_date: "", note: "" });
      qc.invalidateQueries({ queryKey: ["repairs"] });
      toast.success("Special part added");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const cycle = async (p) => {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(p.status) + 1) % STATUS_ORDER.length];
    try {
      const { data: updated } = await api.patch(`/repairs/${card.id}/special-parts/${p.id}`, { status: next });
      setCard(updated); qc.invalidateQueries({ queryKey: ["repairs"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const remove = async (p) => {
    if (!window.confirm("Remove this special-order part?")) return;
    try {
      const { data: updated } = await api.delete(`/repairs/${card.id}/special-parts/${p.id}`);
      setCard(updated); qc.invalidateQueries({ queryKey: ["repairs"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Card className="p-5 border-primary/20 bg-primary/[0.02]" data-testid="special-parts-panel">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-primary" />
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("specialParts") || "Special-order parts"}</div>
        </div>
        <div className="font-mono text-sm">{parts.length} {t("lines") || "lines"} · {formatEUR(total)}</div>
      </div>

      <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4">
        <div className="md:col-span-2 space-y-1">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{t("partName") || "Part name"}</Label>
          <Input required value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Turbocharger BorgWarner K03" data-testid="sp-name" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{t("partNumber") || "Part #"}</Label>
          <Input value={form.part_number} onChange={(e) => setForm(f => ({ ...f, part_number: e.target.value }))} placeholder="OEM / SKU" data-testid="sp-partno" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Supplier</Label>
          <SearchableSelect
            value={form.supplier_id}
            onChange={(v) => setForm(f => ({ ...f, supplier_id: v }))}
            options={suppliers.map(s => ({ value: s.id, label: s.name, secondary: s.phone }))}
            emptyLabel="— none —"
            searchPlaceholder="Search supplier"
            placeholder="Pick supplier"
            testId="sp-supplier"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Qty</Label>
          <Input type="number" step="0.5" min="0" value={form.quantity} onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))} data-testid="sp-qty" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Sell € / u</Label>
          <Input type="number" step="0.01" min="0" value={form.unit_price} onChange={(e) => setForm(f => ({ ...f, unit_price: e.target.value }))} data-testid="sp-price" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Cost € / u</Label>
          <Input type="number" step="0.01" min="0" value={form.unit_cost} onChange={(e) => setForm(f => ({ ...f, unit_cost: e.target.value }))} data-testid="sp-cost" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Expected date</Label>
          <Input type="date" value={form.expected_date} onChange={(e) => setForm(f => ({ ...f, expected_date: e.target.value }))} data-testid="sp-expected" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Note</Label>
          <Input value={form.note} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} data-testid="sp-note" />
        </div>
        <div className="flex items-end md:col-span-1">
          <Button type="submit" disabled={busy} className="rounded-full w-full bg-primary hover:bg-primary/90" data-testid="sp-add">
            <Plus className="h-4 w-4 mr-1" /> {t("add")}
          </Button>
        </div>
      </form>

      <div className="space-y-2">
        {parts.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground border border-dashed border-border rounded-md">
            No special-order parts. Add anything you had to order for this job.
          </div>
        )}
        {parts.map(p => (
          <div key={p.id} className="flex items-start justify-between p-3 rounded-md bg-muted/40 border border-border gap-3" data-testid={`sp-row-${p.id}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{p.name}</span>
                {p.part_number && <span className="text-[10px] font-mono px-1.5 py-[1px] rounded bg-secondary text-muted-foreground">{p.part_number}</span>}
                <StatusBadge status={p.status} onClick={() => cycle(p)} testId={`sp-status-${p.id}`} />
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                {p.supplier_name && <span>{p.supplier_name}</span>}
                {p.expected_date && <span>ETA {p.expected_date}</span>}
                {p.note && <span className="italic">{p.note}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <div className="text-sm font-mono">{p.quantity} × {formatEUR(p.unit_price)}</div>
                <div className="text-xs font-mono font-bold">{formatEUR(p.total)}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => remove(p)} data-testid={`sp-remove-${p.id}`}>
                <X className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
