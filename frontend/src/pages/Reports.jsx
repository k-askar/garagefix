import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Wallet, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#f472b6", "#eab308"];

function todayISO(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function Reports() {
  const { data: inv = [] } = useQuery({ queryKey: ["inv"], queryFn: () => api.get("/inventory").then((r) => r.data) });
  const { data: movement = [] } = useQuery({ queryKey: ["move30"], queryFn: () => api.get("/reports/movement?days=30").then((r) => r.data) });
  const [start, setStart] = useState(todayISO(-30));
  const [end, setEnd] = useState(todayISO(0));
  const { data: profit } = useQuery({
    queryKey: ["profit", start, end],
    queryFn: () => api.get(`/reports/profit?start=${start}&end=${end}`).then((r) => r.data),
  });

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

  return (
    <div className="space-y-8" data-testid="reports-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Insights</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-2">Read the workshop's pulse and profitability.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="rounded-full" onClick={async () => {
            try {
              const res = await api.get("/reports/inventory/excel", { responseType: "blob" });
              const url = URL.createObjectURL(res.data);
              const a = document.createElement("a"); a.href = url; a.download = `inventory-${new Date().toISOString().slice(0, 10)}.xlsx`;
              document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            } catch (e) { toast.error(formatApiError(e)); }
          }} data-testid="report-inv-excel"><FileSpreadsheet className="h-4 w-4 mr-2" /> Inventory · Excel</Button>
          <Button variant="outline" className="rounded-full" onClick={async () => {
            try {
              const res = await api.get(`/reports/profit/excel?start=${start}&end=${end}`, { responseType: "blob" });
              const url = URL.createObjectURL(res.data);
              const a = document.createElement("a"); a.href = url; a.download = `profit-${start}-${end}.xlsx`;
              document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            } catch (e) { toast.error(formatApiError(e)); }
          }} data-testid="report-profit-excel"><FileSpreadsheet className="h-4 w-4 mr-2" /> Profit · Excel</Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview"><TrendingUp className="h-4 w-4 mr-2" /> Overview</TabsTrigger>
          <TabsTrigger value="profit" data-testid="tab-profit"><Wallet className="h-4 w-4 mr-2" /> Profit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
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
        </TabsContent>

        <TabsContent value="profit" className="space-y-6 mt-6" data-testid="profit-tab-content">
          <Card className="p-4 border-border flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">From</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-44" data-testid="profit-start" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">To</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-44" data-testid="profit-end" />
            </div>
            <div className="flex gap-2 ml-auto">
              {[
                { l: "7d", s: () => { setStart(todayISO(-7)); setEnd(todayISO(0)); } },
                { l: "30d", s: () => { setStart(todayISO(-30)); setEnd(todayISO(0)); } },
                { l: "90d", s: () => { setStart(todayISO(-90)); setEnd(todayISO(0)); } },
                { l: "YTD", s: () => { setStart(new Date().getFullYear() + "-01-01"); setEnd(todayISO(0)); } },
              ].map(x => <Button key={x.l} size="sm" variant="outline" className="rounded-full" onClick={x.s} data-testid={`profit-${x.l}`}>{x.l}</Button>)}
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: "Revenue", value: formatEUR(profit?.total_revenue || 0), accent: "text-emerald-700 dark:text-emerald-400" },
              { label: "Cost of goods", value: formatEUR(profit?.total_cost || 0), accent: "text-rose-600 dark:text-rose-400" },
              { label: "Gross profit", value: formatEUR(profit?.total_profit || 0), accent: "text-primary" },
              { label: "Margin", value: `${(profit?.margin || 0).toFixed(1)}%`, accent: "text-fuchsia-700 dark:text-fuchsia-400" },
            ].map((k) => (
              <Card key={k.label} className="p-6 border-border">
                <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{k.label}</div>
                <div className={`font-display text-3xl font-bold tabular-nums mt-2 ${k.accent}`}>{k.value}</div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="p-6 border-border">
              <h3 className="font-display text-xl font-bold mb-4">By category</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profit?.by_category || []}>
                    <CartesianGrid stroke="hsl(217 33% 15%)" vertical={false} />
                    <XAxis dataKey="category" stroke="hsl(215 20% 65%)" fontSize={11} />
                    <YAxis stroke="hsl(215 20% 65%)" fontSize={11} />
                    <Tooltip contentStyle={{ background: "hsl(222 47% 7%)", border: "1px solid hsl(217 33% 15%)", borderRadius: 8 }} formatter={(v) => formatEUR(v)} />
                    <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="profit" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-6 border-border overflow-x-auto">
              <h3 className="font-display text-xl font-bold mb-4">Category breakdown</h3>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(profit?.by_category || []).map(c => (
                    <TableRow key={c.category}>
                      <TableCell className="font-medium">{c.category}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.qty_sold}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEUR(c.revenue)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-mono ${c.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{formatEUR(c.profit)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.margin.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                  {(profit?.by_category || []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No sales in this period.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Card>
          </div>

          <Card className="p-6 border-border overflow-x-auto">
            <h3 className="font-display text-xl font-bold mb-4">Profit by part</h3>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Part</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(profit?.by_item || []).map(p => (
                  <TableRow key={p.item_id} data-testid={`profit-row-${p.sku}`}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{p.sku}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.category}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{p.qty_sold}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEUR(p.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatEUR(p.cost)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-mono ${p.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{formatEUR(p.profit)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{p.margin.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
                {(profit?.by_item || []).length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No sales in this period.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
