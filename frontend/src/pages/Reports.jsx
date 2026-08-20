import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#f472b6", "#eab308"];

function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const { data: inv = [] } = useQuery({ queryKey: ["inv"], queryFn: () => api.get("/inventory").then((r) => r.data) });
  const { data: movement = [] } = useQuery({ queryKey: ["move30"], queryFn: () => api.get("/reports/movement?days=30").then((r) => r.data) });
  const { data: txns = [] } = useQuery({ queryKey: ["txns-all"], queryFn: () => api.get("/transactions?limit=5000").then((r) => r.data) });

  const totalCost = inv.reduce((s, i) => s + i.cost_price * i.quantity, 0);
  const totalRetail = inv.reduce((s, i) => s + i.selling_price * i.quantity, 0);
  const potentialProfit = totalRetail - totalCost;

  const byCat = Object.values(inv.reduce((acc, i) => {
    const k = i.category || "General";
    acc[k] = acc[k] || { name: k, value: 0, units: 0 };
    acc[k].value += i.cost_price * i.quantity;
    acc[k].units += i.quantity;
    return acc;
  }, {}));

  const exportInventory = () => {
    downloadCSV("inventory.csv", inv.map((i) => ({
      sku: i.sku, barcode: i.barcode, name: i.name, category: i.category,
      cost_price: i.cost_price, selling_price: i.selling_price,
      quantity: i.quantity, reorder_point: i.reorder_point,
      unit: i.unit, location: i.location, compatible_vehicles: i.compatible_vehicles,
      stock_value: (i.cost_price * i.quantity).toFixed(2),
    })));
  };

  const exportTransactions = () => {
    downloadCSV("transactions.csv", txns.map((t) => ({
      date: t.created_at, type: t.type, sku: t.item_sku, item: t.item_name,
      quantity: t.quantity, unit_price: t.unit_price, total: t.total,
      supplier: t.supplier_name, customer: t.customer_name, note: t.note, by: t.created_by,
    })));
  };

  return (
    <div className="space-y-8" data-testid="reports-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Insights</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-2">Read the workshop's pulse over the last 30 days.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full" onClick={exportInventory} data-testid="export-inventory">
            <Download className="h-4 w-4 mr-2" /> Export inventory
          </Button>
          <Button variant="outline" className="rounded-full" onClick={exportTransactions} data-testid="export-transactions">
            <Download className="h-4 w-4 mr-2" /> Export transactions
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: "Stock value (cost)", value: formatEUR(totalCost) },
          { label: "Retail value", value: formatEUR(totalRetail) },
          { label: "Potential profit", value: formatEUR(potentialProfit) },
        ].map((k) => (
          <Card key={k.label} className="p-6 border-border">
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{k.label}</div>
            <div className="font-display text-3xl font-bold tabular-nums mt-2">{k.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6 border-border">
          <h3 className="font-display text-xl font-bold mb-4">30-day movement (EUR)</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={movement}>
                <CartesianGrid stroke="hsl(217 33% 15%)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} stroke="hsl(215 20% 65%)" fontSize={11} />
                <YAxis stroke="hsl(215 20% 65%)" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(222 47% 7%)", border: "1px solid hsl(217 33% 15%)", borderRadius: 8 }} />
                <Bar dataKey="in" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="out" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-6 border-border">
          <h3 className="font-display text-xl font-bold mb-4">Value by category</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {byCat.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(222 47% 7%)", border: "1px solid hsl(217 33% 15%)", borderRadius: 8 }} formatter={(v) => formatEUR(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2">
            {byCat.map((c, i) => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-muted-foreground">{c.name}</span>
                </div>
                <span className="font-mono">{formatEUR(c.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
