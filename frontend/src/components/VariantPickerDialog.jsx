import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Boxes, ArrowRight, PackageX } from "lucide-react";
import { formatEUR } from "@/lib/api";

/**
 * Fires when the user scans a "master" barcode that groups several sub-items
 * (e.g. an oil-brand master with 1L / 4L / 5L variants).  Shows every variant
 * with its remaining stock + price and lets the user tap to pick the one that
 * will actually be withdrawn.
 */
export default function VariantPickerDialog({ open, onOpenChange, master, variants = [], onPick }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" data-testid="variant-picker-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Boxes className="h-5 w-5 text-primary" />
            {master?.name}
            {master?.name_ar && (
              <span className="text-sm text-muted-foreground font-normal" dir="rtl">· {master.name_ar}</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {variants.length} sub-artikelen — kies welke je uitboekt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {variants.map((v) => {
            const out = (v.quantity || 0) <= 0;
            return (
              <button
                key={v.id}
                type="button"
                disabled={out}
                onClick={() => { if (!out) { onPick(v); onOpenChange(false); } }}
                data-testid={`variant-pick-${v.sku}`}
                className={`w-full flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
                  out
                    ? "border-border bg-muted/30 cursor-not-allowed opacity-60"
                    : "border-border hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{v.name}</div>
                  {v.name_ar && (
                    <div className="text-xs text-muted-foreground truncate" dir="rtl">{v.name_ar}</div>
                  )}
                  <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
                    {v.sku} · {v.barcode}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-mono font-bold">{formatEUR(v.selling_price || 0)}</div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] mt-0.5 ${
                      out
                        ? "border-rose-500/40 text-rose-600 bg-rose-500/10"
                        : (v.quantity <= (v.reorder_point || 0))
                          ? "border-amber-500/40 text-amber-700 bg-amber-500/10"
                          : "border-emerald-500/40 text-emerald-700 bg-emerald-500/10"
                    }`}
                  >
                    {out
                      ? <><PackageX className="h-3 w-3 mr-1" />0</>
                      : `${v.quantity} ${v.unit || "pcs"}`}
                  </Badge>
                </div>
                {!out && <ArrowRight className="h-4 w-4 text-primary shrink-0" />}
              </button>
            );
          })}
          {!variants.length && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nog geen sub-artikelen gekoppeld.
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Sluiten</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
