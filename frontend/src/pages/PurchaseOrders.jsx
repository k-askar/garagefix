import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Sparkles, Send, PackageCheck, Trash2, Printer, Plus } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLE = {
  draft: "bg-muted text-muted-foreground border-border",
  sent: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  received: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  cancelled: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
};

function printPO(po, settings) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  const rows = po.items.map((l) => `<tr><td>${l.name}<div style="font-size:10px;color:#888">${l.sku}</div></td><td style="text-align:right">${l.quantity}</td><td style="text-align:right">${formatEUR(l.unit_cost)}</td><td style="text-align:right">${formatEUR(l.quantity * l.unit_cost)}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><title>${po.po_number}</title>
    <style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:32px;color:#111;max-width:720px;margin:0 auto}h1{font-size:22px;margin:0}.muted{color:#666;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:13px}th{background:#f5f5f5}.right{text-align:right}.badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#111;color:#fff;font-size:10px;letter-spacing:.1em}</style>
    </head><body>
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div><h1>${settings?.name || "Garage"}</h1><div class="muted">${settings?.address || ""}</div><div class="muted">${settings?.phone || ""}${settings?.email ? " · " + settings.email : ""}</div></div>
      <div style="text-align:right"><span class="badge">PURCHASE ORDER</span><div style="font-size:14px;margin-top:6px;font-weight:700">${po.po_number}</div><div class="muted">${new Date(po.created_at).toLocaleDateString("en-GB")}</div></div>
    </div>
    <hr style="margin:20px 0;border:none;border-top:1px solid #eee" />
    <div style="display:flex;gap:24px">
      <div style="flex:1"><div class="muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:10px">Supplier</div><div style="font-size:15px;font-weight:600;margin-top:4px">${po.supplier_name || "—"}</div></div>
      <div><div class="muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:10px">Status</div><div style="font-size:15px;font-weight:600;margin-top:4px;text-transform:capitalize">${po.status}</div></div>
    </div>
    <table><thead><tr><th>Part</th><th class="right">Qty</th><th class="right">Unit cost</th><th class="right">Total</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="text-align:right;margin-top:16px;font-size:18px;font-weight:700">Total: ${formatEUR(po.total)}</div>
    ${po.note ? `<p class="muted" style="margin-top:24px">Note: ${po.note}</p>` : ""}
    <p class="muted" style="margin-top:32px;text-align:center">Please deliver to the address above. Thank you.</p>
    </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

export default function PurchaseOrders() {
  const qc = useQueryClient();
  const [showSuggest, setShowSuggest] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selSupplierId, setSelSupplierId] = useState("");
  const [selItemId, setSelItemId] = useState("");
  const [selQty, setSelQty] = useState(1);
  const [draft, setDraft] = useState({ supplier_id: "", items: [], note: "" });
  const [payTarget, setPayTarget] = useState(null);
  const [payMethodId, setPayMethodId] = useState("");

  const { data: pos = [] } = useQuery({ queryKey: ["pos"], queryFn: () => api.get("/purchase-orders").then(r => r.data) });
  const { data: suggestions = [] } = useQuery({ queryKey: ["po-suggest"], queryFn: () => api.get("/purchase-orders/suggest").then(r => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ["sup"], queryFn: () => api.get("/suppliers").then(r => r.data) });
  const { data: items = [] } = useQuery({ queryKey: ["inv"], queryFn: () => api.get("/inventory").then(r => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });
  const { data: pmSummary } = useQuery({ queryKey: ["pay-summary"], queryFn: () => api.get("/payments/summary").then(r => r.data) });
  const methods = (pmSummary?.methods || []).filter(m => m.active);

  const createFromSuggestion = async (g) => {
    try {
      await api.post("/purchase-orders", { supplier_id: g.supplier_id, items: g.items, note: "Auto-generated from low-stock alert" });
      toast.success(`PO drafted for ${g.supplier_name}`);
      qc.invalidateQueries();
      setShowSuggest(false);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const addLineToDraft = () => {
    const it = items.find(x => x.id === selItemId);
    if (!it || selQty < 1) return;
    setDraft(d => ({ ...d, items: [...d.items, { item_id: it.id, sku: it.sku, name: it.name, quantity: Number(selQty), unit_cost: it.cost_price }] }));
    setSelItemId(""); setSelQty(1);
  };

  const submitDraft = async (e) => {
    e.preventDefault();
    if (!draft.items.length) return toast.error("Add at least one line");
    try {
      await api.post("/purchase-orders", { supplier_id: draft.supplier_id || null, items: draft.items, note: draft.note });
      toast.success("PO created");
      setDraft({ supplier_id: "", items: [], note: "" }); setShowCreate(false);
      qc.invalidateQueries();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const action = async (id, verb) => {
    try {
      await api.post(`/purchase-orders/${id}/${verb}`, verb === "receive" ? { payment_method_id: payMethodId || null } : {});
      toast.success(verb === "send" ? "Marked as sent" : "Received · stock updated");
      setPayTarget(null); setPayMethodId("");
      qc.invalidateQueries();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this PO?")) return;
    try { await api.delete(`/purchase-orders/${id}`); toast.success("Deleted"); qc.invalidateQueries(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-8" data-testid="po-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Procurement</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Purchase Orders</h1>
          <p className="text-muted-foreground mt-2">{pos.length} POs · {suggestions.length} suggested from low-stock</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => setShowSuggest(true)} data-testid="po-suggest-button">
            <Sparkles className="h-4 w-4 mr-2" /> Suggest from low-stock
          </Button>
          <Button className="rounded-full bg-primary hover:bg-primary/90" onClick={() => setShowCreate(true)} data-testid="po-create-button">
            <Plus className="h-4 w-4 mr-2" /> New PO
          </Button>
        </div>
      </div>

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>PO #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right w-72">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pos.map((p) => (
              <TableRow key={p.id} data-testid={`po-row-${p.po_number}`}>
                <TableCell className="font-mono text-xs">{p.po_number}</TableCell>
                <TableCell>{p.supplier_name || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{p.items?.length || 0}</TableCell>
                <TableCell className="text-right tabular-nums font-mono">{formatEUR(p.total)}</TableCell>
                <TableCell><Badge className={STATUS_STYLE[p.status] + " capitalize"}>{p.status}</Badge></TableCell>
                <TableCell className="text-muted-foreground text-xs font-mono">{new Date(p.created_at).toLocaleDateString("en-GB")}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => printPO(p, settings)} data-testid={`po-print-${p.po_number}`}><Printer className="h-4 w-4" /></Button>
                    {p.status === "draft" && <Button size="sm" variant="outline" className="rounded-full" onClick={() => action(p.id, "send")} data-testid={`po-send-${p.po_number}`}><Send className="h-3 w-3 mr-1" />Send</Button>}
                    {p.status !== "received" && <Button size="sm" className="rounded-full bg-emerald-500 hover:bg-emerald-500/90 text-white" onClick={() => { setPayTarget(p); setPayMethodId(""); }} data-testid={`po-receive-${p.po_number}`}><PackageCheck className="h-3 w-3 mr-1" />Receive</Button>}
                    <Button size="icon" variant="ghost" onClick={() => del(p.id)}><Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {pos.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-16 text-muted-foreground">No purchase orders yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showSuggest} onOpenChange={setShowSuggest}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Suggested POs from low-stock</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {suggestions.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nothing below reorder point. Nice.</p>}
            {suggestions.map((g, i) => (
              <Card key={i} className="p-4 border-border">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Supplier</div>
                    <div className="font-semibold">{g.supplier_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Total</div>
                    <div className="font-mono font-bold">{formatEUR(g.total)}</div>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  {g.items.map((l, j) => (
                    <div key={j} className="flex justify-between text-muted-foreground">
                      <span>{l.name} <span className="text-[11px] font-mono">({l.sku})</span></span>
                      <span className="font-mono">{l.quantity} × {formatEUR(l.unit_cost)}</span>
                    </div>
                  ))}
                </div>
                <Button className="mt-3 w-full rounded-full bg-primary hover:bg-primary/90" onClick={() => createFromSuggestion(g)} data-testid={`po-accept-${i}`}>
                  <Truck className="h-4 w-4 mr-2" /> Create draft PO
                </Button>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">New purchase order</DialogTitle></DialogHeader>
          <form onSubmit={submitDraft} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Supplier</Label>
              <SearchableSelect
                value={draft.supplier_id}
                onChange={(v) => setDraft(d => ({ ...d, supplier_id: v }))}
                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                emptyLabel="— none —"
                searchPlaceholder="Search supplier"
                placeholder="Pick supplier"
                testId="po-supplier-select"
              />
            </div>
            <div className="p-3 rounded-md border border-border space-y-3">
              <div className="grid grid-cols-[1fr_100px_auto] gap-2">
                <SearchableSelect
                  value={selItemId}
                  onChange={setSelItemId}
                  options={items.map(i => ({ value: i.id, label: i.name, secondary: i.sku }))}
                  emptyLabel="— pick —"
                  searchPlaceholder="Search part by name or SKU"
                  placeholder="Pick part"
                  testId="po-item-select"
                />
                <Input type="number" min="1" value={selQty} onChange={(e) => setSelQty(e.target.value)} data-testid="po-qty-input" />
                <Button type="button" onClick={addLineToDraft} variant="outline" className="rounded-full" data-testid="po-add-line"><Plus className="h-4 w-4" /></Button>
              </div>
              {draft.items.length > 0 && (
                <div className="space-y-1 text-sm">
                  {draft.items.map((l, i) => (
                    <div key={i} className="flex justify-between text-muted-foreground">
                      <span>{l.name}</span>
                      <span className="font-mono">{l.quantity} × {formatEUR(l.unit_cost)} = {formatEUR(l.quantity * l.unit_cost)}</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-border flex justify-between font-mono font-bold">
                    <span>Total</span>
                    <span>{formatEUR(draft.items.reduce((s, l) => s + l.quantity * l.unit_cost, 0))}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-1.5"><Label>Note</Label><Textarea rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" className="rounded-full" data-testid="po-submit">Create PO</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!payTarget} onOpenChange={(v) => { if (!v) { setPayTarget(null); setPayMethodId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">Receive · pick payment method</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {payTarget && (
              <div className="p-3 rounded-md border border-border bg-muted/40">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">PO</div>
                <div className="font-mono font-bold">{payTarget.po_number} · {payTarget.supplier_name || "—"}</div>
                <div className="mt-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Total</div>
                <div className="font-display text-2xl font-bold">{formatEUR(payTarget.total)}</div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Payment method (paid to supplier)</Label>
              <Select value={payMethodId || "none"} onValueChange={(v) => setPayMethodId(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="po-paymethod-select"><SelectValue placeholder="Pick a method" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Skip (no payment logged)</SelectItem>
                  {methods.map(m => <SelectItem key={m.id} value={m.id}>{m.name} · {formatEUR(m.balance)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Choose the account paying the supplier. Leave blank to just receive stock.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { setPayTarget(null); setPayMethodId(""); }}>Cancel</Button>
            <Button className="rounded-full bg-emerald-500 hover:bg-emerald-500/90" onClick={() => action(payTarget.id, "receive")} data-testid="po-receive-confirm">
              <PackageCheck className="h-4 w-4 mr-2" /> Receive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
