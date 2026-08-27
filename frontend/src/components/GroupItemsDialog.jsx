import React, { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, formatEUR } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Boxes, Combine, Loader2, Package, Plus, ChevronRight } from "lucide-react";
import { toast } from "sonner";

/**
 * "Groepeer als variantengroep" — bulk-merge N standalone inventory rows into
 * one master + N variants without deleting anything.
 *
 * Two flows are supported, mirrored from the backend `/inventory/group`:
 *   • "existing" — the owner picks one of the selected items to become the
 *     master; the others get `parent_id` pointing at it.  Handy when they
 *     just scanned a factuur that gave every oil variant its own row and
 *     want to promote "Olie 4L" (the most common one) to master.
 *   • "new"      — creates a brand-new master ("Olie", "Remschijven", …) so
 *     the family name stays generic while every scanned line becomes a
 *     variant beneath it.
 */
export default function GroupItemsDialog({ open, onOpenChange, selectedItems }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState("new");
  const [masterId, setMasterId] = useState(selectedItems?.[0]?.id || "");
  const [busy, setBusy] = useState(false);

  // Best-guess master name from the longest COMMON PREFIX of every selected
  // item.  "Olie 1L" + "Olie 4L" + "Olie 5L" → "Olie".  Falls back to the
  // first item's name so the field is never empty.
  const suggestedName = useMemo(() => {
    if (!selectedItems?.length) return "";
    const names = selectedItems.map(i => (i.name || "").trim()).filter(Boolean);
    if (!names.length) return "";
    let prefix = names[0];
    for (const n of names.slice(1)) {
      let i = 0;
      while (i < prefix.length && i < n.length && prefix[i].toLowerCase() === n[i].toLowerCase()) i++;
      prefix = prefix.slice(0, i);
    }
    prefix = prefix.replace(/[\s\-·:_]+$/, "").trim();
    return prefix || names[0].split(/\s+/)[0];
  }, [selectedItems]);

  const [newName, setNewName] = useState("");
  const [newNameAr, setNewNameAr] = useState("");
  const [newBarcode, setNewBarcode] = useState("");

  // Reset every time the dialog is opened so a fresh selection wipes the
  // previous draft (would otherwise carry a stale name from a prior open).
  React.useEffect(() => {
    if (open) {
      setMode("new");
      setNewName(suggestedName);
      setNewNameAr("");
      // Leave barcode EMPTY — the backend must mint a fresh EAN-13 for the
      // master.  Pre-filling with the first selected item's barcode would
      // collide with the SKU/barcode uniqueness constraint on the row we
      // are about to demote to variant.
      setNewBarcode("");
      setMasterId(selectedItems?.[0]?.id || "");
    }
  }, [open, suggestedName, selectedItems]);

  if (!selectedItems || selectedItems.length < 2) return null;

  // Guard rails: if any of the selected items is already a variant or a
  // master itself, /group will 400 — surface it BEFORE the API call.
  const blocked = selectedItems.filter(i => i.parent_id);
  const alreadyMasters = selectedItems.filter(i => i._variant_count > 0);

  const submit = async () => {
    if (blocked.length) return toast.error(`${blocked[0].name} is al een variant`);
    if (alreadyMasters.length) return toast.error(`${alreadyMasters[0].name} is al een groep met varianten`);
    setBusy(true);
    try {
      const body = { item_ids: selectedItems.map(i => i.id), mode };
      if (mode === "existing") {
        if (!masterId) { setBusy(false); return toast.error("Kies een hoofd-onderdeel"); }
        body.master_id = masterId;
      } else {
        if (!newName.trim()) { setBusy(false); return toast.error("Naam is verplicht"); }
        body.master = {
          name: newName.trim(),
          name_ar: newNameAr.trim(),
          barcode: newBarcode.trim(),
        };
      }
      await api.post("/inventory/group", body);
      toast.success(`${selectedItems.length} onderdelen samengevoegd tot één groep`);
      qc.invalidateQueries({ queryKey: ["inv"] });
      onOpenChange(false);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="group-items-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Combine className="h-5 w-5 text-primary" /> Groepeer als variantengroep
          </DialogTitle>
          <DialogDescription>
            Voeg <strong>{selectedItems.length} onderdelen</strong> samen onder één hoofd-streepjescode. Bij het scannen van de hoofd-code krijg je een keuzelijst met alle sub-artikelen.
          </DialogDescription>
        </DialogHeader>

        {/* Selected items preview */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 max-h-40 overflow-y-auto">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Geselecteerd</div>
          {selectedItems.map(i => (
            <div key={i.id} className="flex items-center gap-2 text-sm">
              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{i.name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {i.barcode || "—"} · {i.quantity} {i.unit || "pcs"} · {formatEUR(i.selling_price || 0)}
                </div>
              </div>
              {i.parent_id && <Badge variant="outline" className="text-[9px] text-rose-600 border-rose-500/40">Al variant</Badge>}
              {i._variant_count > 0 && <Badge variant="outline" className="text-[9px] text-rose-600 border-rose-500/40">Al master</Badge>}
            </div>
          ))}
        </div>

        {/* Mode picker */}
        <RadioGroup value={mode} onValueChange={setMode} className="grid grid-cols-2 gap-2">
          <label className={`rounded-xl border-2 p-3 cursor-pointer transition ${mode === "new" ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40"}`} data-testid="group-mode-new">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="new" className="mt-1" />
              <div>
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 text-primary" /> Nieuw hoofd-onderdeel
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Maak een generieke masterschap (bv. "Olie") — alle geselecteerde worden varianten.
                </div>
              </div>
            </div>
          </label>
          <label className={`rounded-xl border-2 p-3 cursor-pointer transition ${mode === "existing" ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40"}`} data-testid="group-mode-existing">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="existing" className="mt-1" />
              <div>
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-primary" /> Gebruik één als master
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  Kies een bestaand item als master — de rest wordt zijn variant.
                </div>
              </div>
            </div>
          </label>
        </RadioGroup>

        {/* Mode content */}
        {mode === "new" ? (
          <div className="space-y-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary flex items-center gap-1.5">
              <Boxes className="h-3 w-3" /> Nieuwe master aanmaken
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Naam <span className="text-rose-600">*</span></Label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="bv. Olie / Remschijven / Filters"
                data-testid="group-master-name"
              />
              {suggestedName && suggestedName !== newName && (
                <button
                  type="button"
                  onClick={() => setNewName(suggestedName)}
                  className="text-[10px] font-mono uppercase tracking-widest text-primary hover:underline"
                  data-testid="group-suggest-btn"
                >
                  Voorstel: "{suggestedName}"
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Arabische naam <span className="text-muted-foreground">(optioneel)</span></Label>
                <Input value={newNameAr} onChange={(e) => setNewNameAr(e.target.value)} dir="rtl" placeholder="زيت" data-testid="group-master-name-ar" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hoofd-barcode <span className="text-muted-foreground">(auto)</span></Label>
                <Input
                  value={newBarcode}
                  onChange={(e) => setNewBarcode(e.target.value.replace(/[^0-9]/g, ""))}
                  className="font-mono"
                  placeholder="EAN-13 of leeg voor auto"
                  data-testid="group-master-barcode"
                />
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              💡 Categorie / eenheid / leverancier worden overgenomen van het eerste geselecteerde onderdeel.
            </div>
          </div>
        ) : (
          <div className="space-y-2 p-4 rounded-xl border border-primary/20 bg-primary/5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3" /> Kies het hoofd-onderdeel
            </div>
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {selectedItems.map(i => (
                <label
                  key={i.id}
                  className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer transition ${masterId === i.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}
                  data-testid={`group-pick-master-${i.sku}`}
                >
                  <input
                    type="radio"
                    name="master-id"
                    value={i.id}
                    checked={masterId === i.id}
                    onChange={() => setMasterId(i.id)}
                    className="accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{i.name}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{i.barcode || i.sku}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Annuleren</Button>
          <Button
            onClick={submit}
            disabled={busy}
            className="rounded-full bg-primary hover:bg-primary/90"
            data-testid="group-confirm-button"
          >
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Combine className="h-4 w-4 mr-2" />}
            {busy ? "Bezig…" : `Voeg ${selectedItems.length} samen`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
