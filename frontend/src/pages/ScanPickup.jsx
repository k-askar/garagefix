import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScanLine, CameraOff, ClipboardList, User, ArrowRight, Search, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { Html5Qrcode } from "html5-qrcode";
import { useLang } from "@/i18n";
import { useAuth } from "@/context/AuthContext";

export default function ScanPickup() {
  const qc = useQueryClient();
  const { t } = useLang();
  const { user } = useAuth();
  const scannerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanError, setScanError] = useState("");
  const [item, setItem] = useState(null);
  const [qty, setQty] = useState(1);
  const [dest, setDest] = useState("repair"); // repair | walkin
  const [repairId, setRepairId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [price, setPrice] = useState(0);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [history, setHistory] = useState([]);

  const { data: cards = [] } = useQuery({
    queryKey: ["repairs-open"],
    queryFn: () => api.get("/repairs").then(r => r.data.filter(c => c.status !== "completed")),
  });
  const { data: customers = [] } = useQuery({ queryKey: ["cus"], queryFn: () => api.get("/customers").then(r => r.data) });

  // Camera lifecycle
  useEffect(() => {
    if (!scanning) return;
    const id = "scan-pickup-cam";
    setScanError("");
    scannerRef.current = new Html5Qrcode(id);
    scannerRef.current.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 280, height: 160 } },
      (decoded) => {
        onCode(decoded);
        // stop after first hit
        stop();
      },
      () => {}
    ).catch((e) => setScanError(String(e?.message || e)));
    return stop;
    // eslint-disable-next-line
  }, [scanning]);

  const stop = () => {
    try { scannerRef.current?.stop().then(() => scannerRef.current?.clear()).catch(() => {}); } catch (_) {}
  };

  const onCode = async (code) => {
    setScanning(false);
    if (!code) return;
    try {
      const { data } = await api.get(`/inventory/lookup?code=${encodeURIComponent(code)}`);
      setItem(data);
      setPrice(data.selling_price || 0);
      setQty(1);
      toast.success(`Loaded: ${data.name}`);
    } catch (e) {
      setItem(null);
      toast.error(formatApiError(e));
    }
  };

  const manualLoad = async () => {
    const c = manualCode.trim();
    if (!c) return;
    await onCode(c);
    setManualCode("");
  };

  const reset = () => { setItem(null); setQty(1); setRepairId(""); setCustomerId(""); setNote(""); };

  const confirm = async () => {
    if (!item) return;
    if (Number(qty) < 1) return toast.error("Quantity must be at least 1");
    if (Number(qty) > item.quantity) return toast.error(`Only ${item.quantity} in stock`);
    if (dest === "repair" && !repairId) return toast.error("Pick a repair card");
    setConfirming(true);
    try {
      let receipt;
      if (dest === "repair") {
        const { data } = await api.post(`/repairs/${repairId}/parts`, { item_id: item.id, quantity: Number(qty) });
        const card = cards.find(c => c.id === repairId);
        receipt = { kind: "repair", dest: `${card?.card_number} · ${[card?.car_make, card?.car_model, card?.car_plate].filter(Boolean).join(" ")}`, item: item.name, sku: item.sku, qty };
        toast.success("Assigned to repair card");
      } else {
        const { data } = await api.post("/transactions", {
          type: "OUT",
          item_id: item.id,
          quantity: Number(qty),
          unit_price: Number(price),
          customer_id: customerId || null,
          note: note || "Scan pickup",
        });
        const c = customers.find(x => x.id === customerId);
        receipt = { kind: "walkin", dest: c ? c.name : "Walk-in", item: item.name, sku: item.sku, qty };
        toast.success("Recorded to walk-in");
      }
      setHistory(h => [{ ...receipt, at: new Date().toLocaleTimeString() }, ...h].slice(0, 12));
      qc.invalidateQueries();
      reset();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setConfirming(false); }
  };

  const lowStock = item && item.quantity <= item.reorder_point;

  return (
    <div className="space-y-8" data-testid="scan-pickup-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Warehouse pickup</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Scan & Assign</h1>
          <p className="text-muted-foreground mt-2">Scan a part off the shelf, tell us where it's going. Stock is deducted instantly.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Step 1 — capture */}
        <Card className="p-6 border-border space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Step 1</div>
              <h3 className="font-display text-xl font-bold">Scan barcode</h3>
            </div>
            {!scanning ? (
              <Button className="rounded-full bg-primary" onClick={() => setScanning(true)} data-testid="scan-open">
                <ScanLine className="h-4 w-4 mr-2" /> Open camera
              </Button>
            ) : (
              <Button variant="outline" className="rounded-full" onClick={() => { stop(); setScanning(false); }}>
                <X className="h-4 w-4 mr-2" /> Stop
              </Button>
            )}
          </div>

          {scanning ? (
            <div className="rounded-md overflow-hidden border border-border">
              <div id="scan-pickup-cam" style={{ width: "100%", minHeight: 240, background: "#000" }} />
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-8 text-center bg-muted/20">
              <ScanLine className="h-10 w-10 text-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Open the camera or type a SKU / barcode below.</p>
            </div>
          )}

          {scanError && <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2"><CameraOff className="h-4 w-4" /> {scanError}</div>}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={manualCode} onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), manualLoad())}
                placeholder="Type SKU or barcode" className="pl-9" data-testid="scan-manual" />
            </div>
            <Button variant="outline" className="rounded-full" onClick={manualLoad} data-testid="scan-manual-load">Load</Button>
          </div>

          {item && (
            <div className="p-4 rounded-md border border-primary/30 bg-primary/5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">{item.sku} · {item.barcode}</div>
                </div>
                <Badge className={lowStock ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15"}>
                  {item.quantity} in stock
                </Badge>
              </div>
              <div className="mt-3 text-xs text-muted-foreground grid grid-cols-2 gap-2">
                <div>Cost: <span className="font-mono text-foreground">{formatEUR(item.cost_price)}</span></div>
                <div>Price: <span className="font-mono text-foreground">{formatEUR(item.selling_price)}</span></div>
                {item.location && <div>Bin: <span className="font-mono text-foreground">{item.location}</span></div>}
                {item.category && <div>Cat: <span className="font-mono text-foreground">{item.category}</span></div>}
              </div>
            </div>
          )}
        </Card>

        {/* Step 2 — destination */}
        <Card className="p-6 border-border space-y-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Step 2</div>
            <h3 className="font-display text-xl font-bold">Where is it going?</h3>
          </div>

          <Tabs value={dest} onValueChange={setDest}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="repair" data-testid="dest-repair"><ClipboardList className="h-4 w-4 mr-2" /> Repair card</TabsTrigger>
              <TabsTrigger value="walkin" data-testid="dest-walkin"><User className="h-4 w-4 mr-2" /> Walk-in</TabsTrigger>
            </TabsList>
            <TabsContent value="repair" className="space-y-3 mt-4">
              {cards.length === 0 && (
                <div className="p-4 rounded-md border border-dashed border-border text-center text-sm text-muted-foreground">
                  No open job cards. Create one from the Job cards page first.
                </div>
              )}
              {cards.length > 0 && (
                <>
                  <Label>Active job cards ({cards.length})</Label>
                  <div className="grid gap-2 max-h-72 overflow-y-auto">
                    {cards.map(c => (
                      <label key={c.id} className={`p-3 border rounded-md flex items-center gap-3 cursor-pointer transition-colors ${repairId === c.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}>
                        <input type="radio" name="repair" value={c.id} checked={repairId === c.id} onChange={() => setRepairId(c.id)} data-testid={`dest-card-${c.card_number}`} className="accent-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{[c.car_make, c.car_model, c.car_year].filter(Boolean).join(" ") || "Vehicle TBD"} · {c.car_plate || "—"}</div>
                          <div className="text-[11px] font-mono text-muted-foreground">{c.card_number} · {c.customer_name || "Walk-in"} · {c.mechanic_name || "unassigned"}</div>
                        </div>
                        <Badge variant="outline" className="capitalize text-[10px]">{c.status.replace("_", " ")}</Badge>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
            <TabsContent value="walkin" className="space-y-3 mt-4">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
                  <SelectTrigger data-testid="dest-customer-select"><SelectValue placeholder="Walk-in / choose customer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— walk-in —</SelectItem>
                    {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Sale price (€)</Label><Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="dest-price" /></div>
                <div className="space-y-1.5"><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="grid grid-cols-[100px_1fr] gap-3 items-end pt-2 border-t border-border">
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input type="number" min="1" max={item?.quantity || 999} value={qty} onChange={(e) => setQty(e.target.value)} disabled={!item} data-testid="pickup-qty" />
            </div>
            <Button
              onClick={confirm}
              disabled={!item || confirming || (dest === "repair" && !repairId)}
              className="rounded-full bg-primary hover:bg-primary/90 h-11"
              data-testid="pickup-confirm"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {confirming ? "Recording..." : (
                <>Confirm pickup · {formatEUR((dest === "repair" ? item?.selling_price : price) * (Number(qty) || 0))}
                <ArrowRight className="h-4 w-4 ml-2" /></>
              )}
            </Button>
          </div>
        </Card>
      </div>

      {history.length > 0 && (
        <Card className="p-6 border-border">
          <h3 className="font-display text-xl font-bold mb-4">Session log · {history.length}</h3>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm truncate">
                      <span className="font-medium">{h.item}</span>
                      <span className="text-muted-foreground"> · {h.qty} × </span>
                      <span className="text-primary">{h.dest}</span>
                    </div>
                    <div className="text-[11px] font-mono text-muted-foreground">{h.sku}</div>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-muted-foreground">{h.at}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
