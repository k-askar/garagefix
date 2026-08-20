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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowDownRight, ArrowUpRight, ScanLine, CameraOff, Search, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Html5Qrcode } from "html5-qrcode";
import { printReceipt } from "@/lib/receipt";

function ScannerModal({ open, onClose, onDetected }) {
  const ref = useRef(null);
  const scannerRef = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr("");
    const id = "qr-reader-box";
    scannerRef.current = new Html5Qrcode(id);
    scannerRef.current.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 140 } },
      (decoded) => {
        onDetected(decoded);
        stop();
      },
      () => {}
    ).catch((e) => setErr(String(e?.message || e)));
    return () => stop();
    // eslint-disable-next-line
  }, [open]);

  const stop = () => {
    try { scannerRef.current?.stop().then(() => scannerRef.current?.clear()).catch(() => {}); } catch (_) {}
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { stop(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="font-display">Scan barcode</DialogTitle></DialogHeader>
        <div className="rounded-md overflow-hidden border border-border">
          <div id="qr-reader-box" ref={ref} style={{ width: "100%" }} />
        </div>
        {err && <div className="text-xs text-rose-400 flex items-center gap-2"><CameraOff className="h-4 w-4" /> {err}</div>}
        <p className="text-xs text-muted-foreground">Point the camera at the item's barcode or QR.</p>
        <DialogFooter><Button variant="ghost" onClick={() => { stop(); onClose(); }}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementForm({ type }) {
  const qc = useQueryClient();
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState("");
  const [item, setItem] = useState(null);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [partyId, setPartyId] = useState("");
  const [note, setNote] = useState("");

  const { data: suppliers = [] } = useQuery({ queryKey: ["sup"], queryFn: () => api.get("/suppliers").then((r) => r.data) });
  const { data: customers = [] } = useQuery({ queryKey: ["cus"], queryFn: () => api.get("/customers").then((r) => r.data) });
  const { data: items = [] } = useQuery({ queryKey: ["inv"], queryFn: () => api.get("/inventory").then((r) => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then((r) => r.data) });

  const lookup = async (c) => {
    const val = (c || code).trim();
    if (!val) return;
    try {
      const { data } = await api.get(`/inventory/lookup?code=${encodeURIComponent(val)}`);
      setItem(data);
      setPrice(type === "IN" ? data.cost_price : data.selling_price);
      toast.success(`Loaded: ${data.name}`);
    } catch (e) {
      setItem(null);
      toast.error(formatApiError(e));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!item) return toast.error("Pick an item first");
    try {
      const { data: txn } = await api.post("/transactions", {
        type,
        item_id: item.id,
        quantity: Number(qty),
        unit_price: Number(price),
        supplier_id: type === "IN" ? partyId || null : null,
        customer_id: type === "OUT" ? partyId || null : null,
        note,
      });
      if (type === "OUT") {
        toast.success("Stock OUT recorded", {
          action: {
            label: "Print receipt",
            onClick: () => printReceipt({ txn, item, settings: settings || {} }),
          },
          duration: 8000,
        });
      } else {
        toast.success("Stock IN recorded");
      }
      setItem(null); setQty(1); setPrice(0); setPartyId(""); setNote(""); setCode("");
      qc.invalidateQueries();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Card className="p-6 border-border">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Step 1</div>
            <h3 className="font-display text-xl font-bold">Find part</h3>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), lookup())}
                placeholder="Scan or type SKU / barcode"
                className="pl-9"
                data-testid={`${type.toLowerCase()}-code-input`}
              />
            </div>
            <Button type="button" onClick={() => lookup()} variant="outline" className="rounded-full">Load</Button>
            <Button type="button" onClick={() => setScan(true)} variant="outline" className="rounded-full" data-testid={`${type.toLowerCase()}-scan-button`}>
              <ScanLine className="h-4 w-4 mr-1" /> Scan
            </Button>
          </div>
          <Select value={item?.id || "none"} onValueChange={(v) => {
            const it = items.find((x) => x.id === v);
            if (it) { setItem(it); setPrice(type === "IN" ? it.cost_price : it.selling_price); }
          }}>
            <SelectTrigger data-testid={`${type.toLowerCase()}-item-select`}><SelectValue placeholder="Or pick from list" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— pick an item —</SelectItem>
              {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} · {i.sku}</SelectItem>)}
            </SelectContent>
          </Select>

          {item && (
            <div className="p-4 rounded-md border border-primary/30 bg-primary/5 space-y-1">
              <div className="text-sm font-semibold">{item.name}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{item.sku} · {item.barcode}</div>
              <div className="text-xs text-muted-foreground">In stock: <span className="text-foreground font-mono">{item.quantity}</span> · Cost {formatEUR(item.cost_price)} · Price {formatEUR(item.selling_price)}</div>
            </div>
          )}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Step 2</div>
            <h3 className="font-display text-xl font-bold">Movement details</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} data-testid={`${type.toLowerCase()}-qty-input`} />
            </div>
            <div className="space-y-1.5">
              <Label>{type === "IN" ? "Unit cost (€)" : "Sale price (€)"}</Label>
              <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} data-testid={`${type.toLowerCase()}-price-input`} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{type === "IN" ? "Supplier" : "Customer"}</Label>
            <Select value={partyId || "none"} onValueChange={(v) => setPartyId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— none —</SelectItem>
                {(type === "IN" ? suppliers : customers).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional reference" />
          </div>
          <div className="p-3 rounded-md bg-muted/40 border border-border flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Total</span>
            <span className="font-display text-xl font-bold tabular-nums">{formatEUR(Number(qty) * Number(price))}</span>
          </div>
          <Button
            type="submit"
            disabled={!item}
            data-testid={`${type.toLowerCase()}-submit`}
            className={`w-full rounded-full ${type === "IN" ? "bg-emerald-500 hover:bg-emerald-500/90" : "bg-rose-500 hover:bg-rose-500/90"} text-white`}
          >
            {type === "IN" ? <><ArrowDownRight className="h-4 w-4 mr-2" /> Record Stock IN</> : <><ArrowUpRight className="h-4 w-4 mr-2" /> Record Stock OUT</>}
          </Button>
        </form>
      </div>
      <ScannerModal open={scan} onClose={() => setScan(false)} onDetected={(d) => { setCode(d); setScan(false); lookup(d); }} />
    </Card>
  );
}

export default function StockMovement() {
  return (
    <div className="space-y-8" data-testid="movement-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Log movement</div>
        <h1 className="font-display text-4xl font-black tracking-tight">Stock IN / OUT</h1>
        <p className="text-muted-foreground mt-2">Scan or search a part, log its movement, done.</p>
      </div>
      <Tabs defaultValue="IN" className="space-y-6">
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="IN" data-testid="tab-in"><ArrowDownRight className="h-4 w-4 mr-2 text-emerald-400" /> Stock IN</TabsTrigger>
          <TabsTrigger value="OUT" data-testid="tab-out"><ArrowUpRight className="h-4 w-4 mr-2 text-rose-400" /> Stock OUT</TabsTrigger>
        </TabsList>
        <TabsContent value="IN"><MovementForm type="IN" /></TabsContent>
        <TabsContent value="OUT"><MovementForm type="OUT" /></TabsContent>
      </Tabs>
    </div>
  );
}
