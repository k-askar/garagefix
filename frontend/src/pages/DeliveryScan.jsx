import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Camera, CameraOff, Truck, Search, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import SearchableSelect from "@/components/SearchableSelect";
import PlateBadge from "@/components/PlateBadge";

/**
 * Delivery-note scan flow:
 *  1. Mechanic aims the camera at the supplier's packing slip barcode.
 *  2. Backend tries to pull a licence-plate out of the scanned text.
 *  3. If a plate matches an OPEN card → we auto-open the "add special part" form for that card.
 *  4. If it doesn't match → we list all open cards so the mechanic can pick.
 */
export default function DeliveryScan() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const scannerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [manual, setManual] = useState("");
  const [detected, setDetected] = useState(null); // { detected_plate, matches | candidates, matched }
  const [targetCard, setTargetCard] = useState(null);
  const [form, setForm] = useState({ name: "", part_number: "", quantity: 1, unit_price: "", unit_cost: "", tax_exempt: false, supplier_id: "" });
  const [busy, setBusy] = useState(false);

  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/suppliers").then(r => r.data) });

  useEffect(() => {
    if (!scanning) return;
    const id = "delivery-scan-cam";
    scannerRef.current = new Html5Qrcode(id);
    scannerRef.current.start(
      { facingMode: "environment" }, { fps: 12, qrbox: { width: 260, height: 160 } },
      (text) => { setScanning(false); onScanned(text); },
      () => {}
    ).catch((e) => { setScanError(String(e?.message || e)); setScanning(false); });
    return () => { try { scannerRef.current?.stop().then(() => scannerRef.current?.clear()).catch(() => {}); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const onScanned = async (code) => {
    setBusy(true); setDetected(null); setTargetCard(null);
    try {
      const { data } = await api.post("/special-parts/scan-delivery", { code });
      setDetected(data);
      if (data.matched && data.matches.length === 1) {
        setTargetCard(data.matches[0]);
      } else if (data.matched && data.matches.length > 1) {
        toast("Multiple cards match this plate — pick one below");
      } else {
        toast(`No open card matches "${data.detected_plate || code}" — pick a card below`);
      }
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const manualLoad = () => {
    if (!manual.trim()) return;
    onScanned(manual.trim());
  };

  const addPart = async () => {
    if (!targetCard) return toast.error("Pick a card first");
    if (!form.name.trim()) return toast.error("Part name required");
    setBusy(true);
    try {
      const { data: updated } = await api.post(`/repairs/${targetCard.id}/special-parts`, {
        name: form.name.trim(),
        quantity: Number(form.quantity) || 1,
        unit_price: Number(form.unit_price) || 0,
        unit_cost: Number(form.unit_cost) || 0,
        tax_exempt: !!form.tax_exempt,
        supplier_id: form.supplier_id || null,
        part_number: form.part_number || "",
        status: "arrived",  // scanning the delivery note = it just arrived
      });
      toast.success(`Added to ${updated.card_number}`);
      qc.invalidateQueries();
      // reset for next scan
      setForm({ name: "", part_number: "", quantity: 1, unit_price: "", unit_cost: "", tax_exempt: false, supplier_id: "" });
      setTargetCard(null); setDetected(null); setManual("");
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const candidates = detected?.matched ? detected.matches : (detected?.candidates || []);
  const pickerLabel = detected?.matched ? "Matching cards" : "Open cards — pick one to add this part";

  return (
    <div className="space-y-6" data-testid="delivery-scan-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">SUPPLIER · DELIVERY</div>
        <h1 className="font-display text-4xl font-black tracking-tight">Scan delivery note</h1>
        <p className="text-muted-foreground mt-2">Point the camera at the supplier's packing-slip barcode — we'll match it to the correct job card.</p>
      </div>

      <Card className="p-6 border-border space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {!scanning ? (
            <Button className="rounded-full bg-primary" onClick={() => { setScanning(true); setScanError(""); }} data-testid="delivery-scan-open">
              <Camera className="h-4 w-4 mr-2" /> Start camera
            </Button>
          ) : (
            <Button variant="outline" className="rounded-full" onClick={() => setScanning(false)}>
              <CameraOff className="h-4 w-4 mr-2" /> Stop
            </Button>
          )}
          <div className="flex-1 min-w-[220px] flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="or type plate / packing-slip code" className="pl-9" data-testid="delivery-manual" onKeyDown={(e) => { if (e.key === "Enter") manualLoad(); }} />
            </div>
            <Button variant="outline" onClick={manualLoad} className="rounded-full" data-testid="delivery-manual-load">Load</Button>
          </div>
        </div>
        {scanning && (
          <div>
            <div id="delivery-scan-cam" style={{ width: "100%", minHeight: 240, background: "#000", borderRadius: 8 }} />
            <div className="text-[11px] font-mono text-muted-foreground mt-2">Aim the camera at the barcode or the plate printed on the delivery note.</div>
          </div>
        )}
        {scanError && <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2"><CameraOff className="h-4 w-4" /> {scanError}</div>}
      </Card>

      {detected && (
        <Card className="p-6 border-border space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Detected plate</div>
            <div className="font-display text-2xl font-bold">{detected.detected_plate || <span className="text-muted-foreground italic">— none —</span>}</div>
            {detected.matched
              ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40" data-testid="delivery-matched-badge">Matched</Badge>
              : <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40" data-testid="delivery-unmatched-badge">No auto-match</Badge>}
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">{pickerLabel}</div>
            {candidates.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">No open cards on file.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {candidates.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setTargetCard(c)}
                    className={`text-left rounded-md border p-3 transition-all ${targetCard?.id === c.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                    data-testid={`delivery-card-${c.card_number}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-mono text-[11px] text-muted-foreground">{c.card_number}</div>
                      {c.car_plate && <PlateBadge plate={c.car_plate} country="NL" size="xxs" />}
                    </div>
                    <div className="font-medium text-sm mt-1 truncate">{[c.car_make, c.car_model].filter(Boolean).join(" ") || "Vehicle"}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{c.customer_name || "Walk-in"}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {targetCard && (
        <Card className="p-6 border-border space-y-4" data-testid="delivery-add-form">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary">
            <Truck className="h-3.5 w-3.5" /> Add part to {targetCard.card_number}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">Part name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Brake pads BMW E90" data-testid="delivery-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Part number / OEM</Label>
              <Input value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} placeholder="34116794300" data-testid="delivery-partnum" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Supplier</Label>
              <SearchableSelect
                value={form.supplier_id}
                onChange={(v) => setForm({ ...form, supplier_id: v })}
                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                emptyLabel="— none —"
                placeholder="Pick supplier"
                testId="delivery-supplier"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Qty</Label>
              <Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} data-testid="delivery-qty" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sell € / unit</Label>
              <Input type="number" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} data-testid="delivery-price" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cost € / unit</Label>
              <Input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
            </div>
            <div className="md:col-span-3 flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <Label className="cursor-pointer text-xs">Tax exempt (used / 2nd-hand)</Label>
              <Switch checked={form.tax_exempt} onCheckedChange={(v) => setForm({ ...form, tax_exempt: v })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTargetCard(null)}>Back</Button>
            <Button className="rounded-full bg-primary" onClick={addPart} disabled={busy} data-testid="delivery-add-run">
              <Plus className="h-4 w-4 mr-2" /> {busy ? "Adding…" : "Add to card"}
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => nav("/repairs")}>
              Open card <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
