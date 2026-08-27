import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, formatEUR } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Boxes, Loader2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

const EMPTY = { name: "", name_ar: "", sku: "", barcode: "", cost_price: 0, selling_price: 0, quantity: 0, reorder_point: 5, unit: "pcs" };

/**
 * Manage variants (sub-items) of a master inventory item.  Owner picks a row
 * on the Inventory page → this dialog lists every child linked via
 * `parent_id`, and offers an inline "+ variant" form that inherits category /
 * supplier from the master.  Each row can be edited inline via the pencil
 * button — full CRUD without re-opening a dedicated form.
 */
export default function VariantsManagerDialog({ open, onOpenChange, master }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY);
  const [savingEdit, setSavingEdit] = useState(false);
  const masterId = master?.id;

  const { data: variants = [], refetch, isFetching } = useQuery({
    queryKey: ["variants", masterId],
    queryFn: () => api.get(`/inventory/${masterId}/variants`).then((r) => r.data),
    enabled: !!masterId && !!open,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setEdit = (k, v) => setEditDraft((d) => ({ ...d, [k]: v }));

  const add = async (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return toast.error("Naam is verplicht");
    setBusy(true);
    try {
      await api.post(`/inventory/${masterId}/variants`, {
        ...draft,
        cost_price: Number(draft.cost_price) || 0,
        selling_price: Number(draft.selling_price) || 0,
        quantity: Number(draft.quantity) || 0,
        reorder_point: Number(draft.reorder_point) || 0,
      });
      toast.success(`Sub-artikel toegevoegd`);
      setDraft(EMPTY);
      await refetch();
      qc.invalidateQueries({ queryKey: ["inv"] });
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  const startEdit = (v) => {
    setEditingId(v.id);
    setEditDraft({
      name: v.name || "",
      name_ar: v.name_ar || "",
      sku: v.sku || "",
      barcode: v.barcode || "",
      cost_price: v.cost_price ?? 0,
      selling_price: v.selling_price ?? 0,
      quantity: v.quantity ?? 0,
      reorder_point: v.reorder_point ?? 5,
      unit: v.unit || "pcs",
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditDraft(EMPTY); };

  const saveEdit = async () => {
    if (!editDraft.name.trim()) return toast.error("Naam is verplicht");
    setSavingEdit(true);
    try {
      await api.put(`/inventory/${editingId}`, {
        name: editDraft.name,
        name_ar: editDraft.name_ar,
        barcode: editDraft.barcode,
        unit: editDraft.unit,
        cost_price: Number(editDraft.cost_price) || 0,
        selling_price: Number(editDraft.selling_price) || 0,
        quantity: Number(editDraft.quantity) || 0,
        reorder_point: Number(editDraft.reorder_point) || 0,
      });
      toast.success("Sub-artikel bijgewerkt");
      cancelEdit();
      await refetch();
      qc.invalidateQueries({ queryKey: ["inv"] });
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSavingEdit(false); }
  };

  const del = async (v) => {
    if (!window.confirm(`Sub-artikel "${v.name}" verwijderen?`)) return;
    try {
      await api.delete(`/inventory/${v.id}`);
      toast.success("Verwijderd");
      if (editingId === v.id) cancelEdit();
      await refetch();
      qc.invalidateQueries({ queryKey: ["inv"] });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="variants-manager-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" /> Sub-artikelen · {master?.name}
          </DialogTitle>
          <DialogDescription>
            Groepeer variaties (bv. 1L / 4L / 5L, of Bosch / Mann) onder één hoofd-streepjescode. Bij scannen krijg je een keuzelijst.
          </DialogDescription>
        </DialogHeader>

        {/* ── EXISTING VARIANTS ── */}
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead className="font-mono text-[10px]">Barcode</TableHead>
                <TableHead className="text-right">Prijs</TableHead>
                <TableHead className="text-right">Voorraad</TableHead>
                <TableHead className="w-24 text-right">Acties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching && !variants.length && (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Laden…
                </TableCell></TableRow>
              )}
              {variants.map((v) => {
                const isEditing = editingId === v.id;
                if (isEditing) {
                  return (
                    <TableRow key={v.id} data-testid={`variant-row-${v.sku}-edit`} className="bg-primary/5">
                      <TableCell className="align-top py-3">
                        <div className="space-y-1.5">
                          <Input
                            value={editDraft.name}
                            onChange={(e) => setEdit("name", e.target.value)}
                            placeholder="Naam *"
                            className="h-8 text-sm"
                            data-testid={`variant-edit-name-${v.sku}`}
                          />
                          <Input
                            value={editDraft.name_ar}
                            onChange={(e) => setEdit("name_ar", e.target.value)}
                            placeholder="الاسم بالعربية"
                            dir="rtl"
                            className="h-8 text-xs"
                            data-testid={`variant-edit-name-ar-${v.sku}`}
                          />
                          <Input
                            value={editDraft.unit}
                            onChange={(e) => setEdit("unit", e.target.value)}
                            placeholder="pcs / L / kg"
                            className="h-7 text-[11px]"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="align-top py-3">
                        <Input
                          value={editDraft.barcode}
                          onChange={(e) => setEdit("barcode", e.target.value)}
                          className="h-8 text-xs font-mono"
                          data-testid={`variant-edit-barcode-${v.sku}`}
                        />
                      </TableCell>
                      <TableCell className="align-top py-3">
                        <div className="space-y-1.5">
                          <div>
                            <Label className="text-[9px] uppercase tracking-widest text-muted-foreground">Inkoop</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={editDraft.cost_price}
                              onChange={(e) => setEdit("cost_price", e.target.value)}
                              className="h-7 text-xs text-right font-mono"
                              data-testid={`variant-edit-cost-${v.sku}`}
                            />
                          </div>
                          <div>
                            <Label className="text-[9px] uppercase tracking-widest text-muted-foreground">Verkoop</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={editDraft.selling_price}
                              onChange={(e) => setEdit("selling_price", e.target.value)}
                              className="h-7 text-xs text-right font-mono"
                              data-testid={`variant-edit-price-${v.sku}`}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top py-3">
                        <div className="space-y-1.5">
                          <div>
                            <Label className="text-[9px] uppercase tracking-widest text-muted-foreground">Voorraad</Label>
                            <Input
                              type="number"
                              value={editDraft.quantity}
                              onChange={(e) => setEdit("quantity", e.target.value)}
                              className="h-7 text-xs text-right"
                              data-testid={`variant-edit-qty-${v.sku}`}
                            />
                          </div>
                          <div>
                            <Label className="text-[9px] uppercase tracking-widest text-muted-foreground">Herbestelpunt</Label>
                            <Input
                              type="number"
                              value={editDraft.reorder_point}
                              onChange={(e) => setEdit("reorder_point", e.target.value)}
                              className="h-7 text-xs text-right"
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={saveEdit}
                            disabled={savingEdit}
                            className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                            data-testid={`variant-save-${v.sku}`}
                            title="Opslaan"
                          >
                            {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={cancelEdit}
                            disabled={savingEdit}
                            className="h-8 w-8"
                            data-testid={`variant-cancel-${v.sku}`}
                            title="Annuleren"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }
                return (
                  <TableRow key={v.id} data-testid={`variant-row-${v.sku}`}>
                    <TableCell>
                      <div className="font-medium">{v.name}</div>
                      {v.name_ar && <div className="text-xs text-muted-foreground" dir="rtl">{v.name_ar}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">{v.barcode}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEUR(v.selling_price || 0)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={`text-xs ${v.quantity <= 0 ? "border-rose-500/40 text-rose-600 bg-rose-500/10" : ""}`}>
                        {v.quantity} {v.unit || "pcs"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => startEdit(v)}
                          className="h-8 w-8 text-primary hover:bg-primary/10"
                          data-testid={`variant-edit-${v.sku}`}
                          title="Bewerken"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => del(v)}
                          className="h-8 w-8"
                          data-testid={`variant-del-${v.sku}`}
                          title="Verwijderen"
                        >
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isFetching && !variants.length && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                  Nog geen sub-artikelen. Voeg de eerste hieronder toe.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* ── ADD NEW VARIANT ── */}
        <form onSubmit={add} className="rounded-md border-2 border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="text-xs font-mono uppercase tracking-widest text-primary flex items-center gap-2">
            <Plus className="h-3.5 w-3.5" /> Nieuw sub-artikel
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Naam *</Label>
              <Input required value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="bv. 4 Liter" data-testid="variant-name-input" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Arabische naam <span className="text-muted-foreground">(optioneel)</span></Label>
              <Input value={draft.name_ar} onChange={(e) => set("name_ar", e.target.value)} placeholder="4 لتر" dir="rtl" data-testid="variant-name-ar-input" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Barcode <span className="text-muted-foreground">(auto)</span></Label>
              <Input value={draft.barcode} onChange={(e) => set("barcode", e.target.value)} data-testid="variant-barcode-input" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Eenheid</Label>
              <Input value={draft.unit} onChange={(e) => set("unit", e.target.value)} placeholder="pcs / L / kg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Inkoopprijs (€)</Label>
              <Input type="number" step="0.01" value={draft.cost_price} onChange={(e) => set("cost_price", e.target.value)} data-testid="variant-cost-input" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Verkoopprijs (€)</Label>
              <Input type="number" step="0.01" value={draft.selling_price} onChange={(e) => set("selling_price", e.target.value)} data-testid="variant-price-input" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Voorraad</Label>
              <Input type="number" value={draft.quantity} onChange={(e) => set("quantity", e.target.value)} data-testid="variant-qty-input" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Herbestelpunt</Label>
              <Input type="number" value={draft.reorder_point} onChange={(e) => set("reorder_point", e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" className="rounded-full bg-primary hover:bg-primary/90" disabled={busy} data-testid="variant-add-button">
              <Plus className="h-4 w-4 mr-2" /> {busy ? "Bezig…" : "Toevoegen"}
            </Button>
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Klaar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
