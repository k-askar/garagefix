import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ArrowDownRight, ArrowUpRight, Search, Printer } from "lucide-react";
import { printReceipt } from "@/lib/receipt";

export default function Transactions() {
  const { data: rows = [] } = useQuery({ queryKey: ["txns"], queryFn: () => api.get("/transactions").then((r) => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then((r) => r.data) });
  const [q, setQ] = useState("");
  const [f, setF] = useState("all");
  const filtered = rows.filter((t) => {
    const s = q.toLowerCase();
    const match = !s || t.item_name.toLowerCase().includes(s) || t.item_sku.toLowerCase().includes(s);
    const type = f === "all" || t.type === f;
    return match && type;
  });

  return (
    <div className="space-y-8" data-testid="transactions-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Ledger</div>
        <h1 className="font-display text-4xl font-black tracking-tight">Transactions</h1>
        <p className="text-muted-foreground mt-2">Every part that moved, with who and why.</p>
      </div>
      <Card className="border-border">
        <div className="p-4 flex flex-wrap gap-3 items-center border-b border-border">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item / SKU" className="pl-9" data-testid="txn-search" />
          </div>
          <Select value={f} onValueChange={setF}>
            <SelectTrigger className="w-40" data-testid="txn-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="IN">Stock IN</SelectItem>
              <SelectItem value="OUT">Stock OUT</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Party</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{new Date(t.created_at).toLocaleString("en-GB")}</TableCell>
                  <TableCell>
                    {t.type === "IN" ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15"><ArrowDownRight className="h-3 w-3 mr-1" />IN</Badge>
                    ) : (
                      <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/15"><ArrowUpRight className="h-3 w-3 mr-1" />OUT</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{t.item_name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{t.item_sku}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.supplier_name || t.customer_name || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEUR(t.unit_price)}</TableCell>
                  <TableCell className="text-right tabular-nums font-mono">{formatEUR(t.total)}</TableCell>
                  <TableCell className="text-right">
                    {t.type === "OUT" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => printReceipt({ txn: t, item: null, settings: settings || {} })}
                        data-testid={`receipt-${t.id}`}
                        title="Print receipt"
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-16 text-muted-foreground">No transactions yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
