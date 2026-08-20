import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { CheckCircle2, Printer, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

function printInvoice(inv, settings) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  const rows = inv.lines.map((l) => `<tr><td>${l.name}<div style="font-size:10px;color:#888">${l.sku || ""}</div></td><td class="right">${l.quantity}</td><td class="right">${formatEUR(l.unit_price)}</td><td class="right">${formatEUR(l.total)}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><title>${inv.invoice_number}</title>
    <style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:32px;color:#111;max-width:720px;margin:0 auto}h1{font-size:24px;margin:0}.muted{color:#666;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:13px}th{background:#f5f5f5}.right{text-align:right}.badge{display:inline-block;padding:2px 10px;border-radius:999px;background:#0ea5e9;color:#fff;font-size:10px;letter-spacing:.1em}.paid{background:#22c55e}.totrow{font-size:15px;font-weight:700}</style>
    </head><body>
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div><h1>${settings?.name || "Garage"}</h1><div class="muted">${settings?.address || ""}</div><div class="muted">${settings?.phone || ""}${settings?.email ? " · " + settings.email : ""}</div>${settings?.tax_id ? `<div class="muted">VAT: ${settings.tax_id}</div>` : ""}</div>
      <div style="text-align:right"><span class="badge ${inv.status === 'paid' ? 'paid' : ''}">${inv.status === 'paid' ? 'PAID' : 'INVOICE'}</span><div style="font-size:14px;margin-top:6px;font-weight:700">${inv.invoice_number}</div><div class="muted">${new Date(inv.created_at).toLocaleDateString("en-GB")}</div></div>
    </div>
    <hr style="margin:20px 0;border:none;border-top:1px solid #eee" />
    <div class="muted" style="text-transform:uppercase;letter-spacing:.1em;font-size:10px">Bill to</div>
    <div style="font-size:15px;font-weight:600;margin-top:4px">${inv.customer_name || "Walk-in customer"}</div>
    <table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Total</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div style="margin-top:16px;text-align:right">
      <div class="muted">Subtotal: ${formatEUR(inv.subtotal)}</div>
      ${inv.tax ? `<div class="muted">Tax: ${formatEUR(inv.tax)}</div>` : ""}
      <div class="totrow" style="margin-top:4px">Total: ${formatEUR(inv.total)}</div>
    </div>
    ${inv.note ? `<p class="muted" style="margin-top:24px">${inv.note}</p>` : ""}
    <p class="muted" style="margin-top:24px;text-align:center">${settings?.footer_note || "Thank you!"}</p>
    </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

export default function Invoices() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [taxRate, setTaxRate] = useState(0);
  const [note, setNote] = useState("");
  const [selectedTxns, setSelectedTxns] = useState([]);

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => api.get("/invoices").then(r => r.data) });
  const { data: customers = [] } = useQuery({ queryKey: ["cus"], queryFn: () => api.get("/customers").then(r => r.data) });
  const { data: txns = [] } = useQuery({ queryKey: ["txns"], queryFn: () => api.get("/transactions?limit=500").then(r => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });

  const eligible = txns.filter(t => t.type === "OUT" && !t.invoice_id && (!customerId || t.customer_id === customerId));

  const toggle = (id) => setSelectedTxns(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async () => {
    if (!selectedTxns.length) return toast.error("Pick at least one transaction");
    try {
      const { data } = await api.post("/invoices/from-transactions", {
        customer_id: customerId || null,
        transaction_ids: selectedTxns,
        tax_rate: Number(taxRate),
        note,
      });
      toast.success(`Invoice ${data.invoice_number} created`, {
        action: { label: "Print", onClick: () => printInvoice(data, settings) },
      });
      setShowCreate(false); setSelectedTxns([]); setCustomerId(""); setNote(""); setTaxRate(0);
      qc.invalidateQueries();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const markPaid = async (id) => {
    try { await api.post(`/invoices/${id}/mark-paid`); toast.success("Marked paid"); qc.invalidateQueries(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete invoice?")) return;
    try { await api.delete(`/invoices/${id}`); toast.success("Deleted"); qc.invalidateQueries(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  // running balance per customer
  const balances = customers.map(c => {
    const custInvs = invoices.filter(i => i.customer_id === c.id);
    return {
      ...c,
      unpaid: custInvs.filter(i => i.status !== "paid").reduce((s, i) => s + i.total, 0),
      paid: custInvs.filter(i => i.status === "paid").reduce((s, i) => s + i.total, 0),
      count: custInvs.length,
    };
  }).filter(c => c.count > 0);

  return (
    <div className="space-y-8" data-testid="invoices-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Billing</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Invoices</h1>
          <p className="text-muted-foreground mt-2">{invoices.length} invoices · {formatEUR(invoices.filter(i => i.status !== "paid").reduce((s, i) => s + i.total, 0))} outstanding</p>
        </div>
        <Button className="rounded-full bg-primary hover:bg-primary/90" onClick={() => setShowCreate(true)} data-testid="invoice-create-button">
          <Plus className="h-4 w-4 mr-2" /> New invoice
        </Button>
      </div>

      {balances.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {balances.map(c => (
            <Card key={c.id} className="p-4 border-border card-hover">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">{c.count} invoices</div>
                </div>
                {c.unpaid > 0
                  ? <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">Owes {formatEUR(c.unpaid)}</Badge>
                  : <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">Settled</Badge>}
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>Paid lifetime</span>
                <span className="font-mono">{formatEUR(c.paid)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right w-40">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(inv => (
              <TableRow key={inv.id} data-testid={`invoice-row-${inv.invoice_number}`}>
                <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                <TableCell>{inv.customer_name || "Walk-in"}</TableCell>
                <TableCell className="text-muted-foreground">{inv.lines.length}</TableCell>
                <TableCell className="text-right tabular-nums font-mono">{formatEUR(inv.total)}</TableCell>
                <TableCell>
                  {inv.status === "paid"
                    ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">Paid</Badge>
                    : <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">Due</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs font-mono">{new Date(inv.created_at).toLocaleDateString("en-GB")}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => printInvoice(inv, settings)} data-testid={`invoice-print-${inv.invoice_number}`}><Printer className="h-4 w-4" /></Button>
                    {inv.status !== "paid" && <Button size="sm" variant="outline" className="rounded-full" onClick={() => markPaid(inv.id)} data-testid={`invoice-paid-${inv.invoice_number}`}><CheckCircle2 className="h-3 w-3 mr-1" />Paid</Button>}
                    <Button size="icon" variant="ghost" onClick={() => del(inv.id)}><Trash2 className="h-4 w-4 text-rose-400" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {invoices.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-16 text-muted-foreground">No invoices yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Bundle transactions into an invoice</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={customerId || "none"} onValueChange={(v) => { setCustomerId(v === "none" ? "" : v); setSelectedTxns([]); }}>
                  <SelectTrigger data-testid="invoice-customer-select"><SelectValue placeholder="Any / walk-in" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Walk-in / any</SelectItem>
                    {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tax rate (%)</Label>
                <Input type="number" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} data-testid="invoice-tax-input" />
              </div>
            </div>
            <div className="border border-border rounded-md max-h-72 overflow-y-auto">
              {eligible.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No unbilled OUT transactions for this filter.</div>}
              {eligible.map(t => (
                <label key={t.id} className="flex items-center gap-3 p-3 border-b border-border last:border-0 cursor-pointer hover:bg-accent">
                  <Checkbox checked={selectedTxns.includes(t.id)} onCheckedChange={() => toggle(t.id)} data-testid={`invoice-txn-${t.id}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.item_name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{t.item_sku} · {new Date(t.created_at).toLocaleDateString("en-GB")} · {t.customer_name || "walk-in"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono">{t.quantity} × {formatEUR(t.unit_price)}</div>
                    <div className="text-xs font-mono font-bold">{formatEUR(t.total)}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="space-y-1.5"><Label>Note</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="p-3 rounded-md bg-muted/40 border border-border flex justify-between">
              <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Selected</span>
              <span className="font-mono font-bold">{selectedTxns.length} · {formatEUR(eligible.filter(t => selectedTxns.includes(t.id)).reduce((s, t) => s + t.total, 0))}</span>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={submit} className="rounded-full" data-testid="invoice-submit">Create invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
