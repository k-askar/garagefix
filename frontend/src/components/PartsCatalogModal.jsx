import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import SearchableSelect from "@/components/SearchableSelect";

/**
 * Modal for maintaining a reusable list of special-order parts (name + prices).
 * Owner opens it from the SpecialPartsPanel; each catalog row can then be
 * inserted into any repair card with a single click.
 */
export default function PartsCatalogModal({ open, onClose, onPick }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // row being edited (or blank obj)
  const { data: rows = [] } = useQuery({
    queryKey: ["parts-catalog"],
    queryFn: () => api.get("/parts-catalog").then(r => r.data),
    enabled: open,
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => api.get("/suppliers").then(r => r.data),
    enabled: open,
  });

  const blank = { name: "", part_number: "", unit_price: "", unit_cost: "", tax_exempt: false, supplier_id: "", note: "" };
  const startNew = () => setEditing({ ...blank, _new: true });
  const startEdit = (r) => setEditing({ ...r });
  const cancel = () => setEditing(null);

  const save = async () => {
    if (!editing.name.trim()) return toast.error("Name required");
    const payload = {
      name: editing.name.trim(),
      part_number: (editing.part_number || "").trim(),
      unit_price: Number(editing.unit_price) || 0,
      unit_cost: Number(editing.unit_cost) || 0,
      tax_exempt: !!editing.tax_exempt,
      supplier_id: editing.supplier_id || null,
      note: (editing.note || "").trim(),
    };
    try {
      if (editing._new) {
        await api.post("/parts-catalog", payload);
        toast.success("Added to catalog");
      } else {
        await api.patch(`/parts-catalog/${editing.id}`, payload);
        toast.success("Updated");
      }
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["parts-catalog"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (r) => {
    if (!window.confirm(`Delete "${r.name}" from catalog?`)) return;
    try {
      await api.delete(`/parts-catalog/${r.id}`);
      qc.invalidateQueries({ queryKey: ["parts-catalog"] });
      toast.success("Deleted");
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="parts-catalog-modal">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Parts catalog</DialogTitle>
          <p className="text-xs text-muted-foreground">Reusable part names + prices. Pick one to insert into the current repair card.</p>
        </DialogHeader>

        {editing ? (
          <div className="rounded-md border border-primary/40 p-4 space-y-3 bg-primary/5" data-testid="catalog-editor">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Name *</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} data-testid="catalog-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Part #</Label>
                <Input value={editing.part_number || ""} onChange={(e) => setEditing({ ...editing, part_number: e.target.value })} data-testid="catalog-partno" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Sell € / unit</Label>
                <Input type="number" step="0.01" min="0" value={editing.unit_price} onChange={(e) => setEditing({ ...editing, unit_price: e.target.value })} data-testid="catalog-price" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Cost € / unit</Label>
                <Input type="number" step="0.01" min="0" value={editing.unit_cost} onChange={(e) => setEditing({ ...editing, unit_cost: e.target.value })} data-testid="catalog-cost" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Default supplier</Label>
                <SearchableSelect
                  value={editing.supplier_id || ""}
                  onChange={(v) => setEditing({ ...editing, supplier_id: v })}
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                  emptyLabel="— none —"
                  searchPlaceholder="Search"
                  placeholder="Pick supplier"
                  testId="catalog-supplier"
                />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2 pl-3">
                <div>
                  <Label className="cursor-pointer">No BTW (used part)</Label>
                  <p className="text-[10px] text-muted-foreground">Skip tax on this part by default (2nd-hand items).</p>
                </div>
                <Switch checked={!!editing.tax_exempt} onCheckedChange={(v) => setEditing({ ...editing, tax_exempt: v })} data-testid="catalog-tax-exempt" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Note</Label>
                <Input value={editing.note || ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} data-testid="catalog-note" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={cancel} className="rounded-full"><X className="h-4 w-4 mr-1" /> Cancel</Button>
              <Button onClick={save} className="rounded-full bg-primary hover:bg-primary/90" data-testid="catalog-save"><Save className="h-4 w-4 mr-1" /> Save</Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button onClick={startNew} className="rounded-full bg-primary hover:bg-primary/90" data-testid="catalog-new"><Plus className="h-4 w-4 mr-1" /> New part</Button>
          </div>
        )}

        <div className="space-y-2 mt-2">
          {rows.length === 0 && !editing && (
            <div className="p-6 border border-dashed border-border rounded-md text-center text-sm text-muted-foreground">
              Your catalog is empty. Add your first frequently-used special part above.
            </div>
          )}
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-border gap-3" data-testid={`catalog-row-${r.id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{r.name}</span>
                  {r.part_number && <span className="text-[10px] font-mono px-1.5 py-[1px] rounded bg-secondary text-muted-foreground">{r.part_number}</span>}
                  {r.tax_exempt && <span className="text-[10px] font-mono px-1.5 py-[1px] rounded bg-amber-500/20 text-amber-700 dark:text-amber-400">No BTW</span>}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                  <span>Sell {formatEUR(r.unit_price)}</span>
                  {r.unit_cost > 0 && <span>Cost {formatEUR(r.unit_cost)}</span>}
                  {r.supplier_name && <span>· {r.supplier_name}</span>}
                  {r.times_used > 0 && <span>· used {r.times_used}×</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {onPick && (
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => onPick(r)} data-testid={`catalog-pick-${r.id}`}>
                    Use
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => startEdit(r)} data-testid={`catalog-edit-${r.id}`}>
                  <Save className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => del(r)} data-testid={`catalog-delete-${r.id}`}>
                  <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
