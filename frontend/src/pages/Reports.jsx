import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#f472b6", "#eab308"];

export default function Reports() {
  const { data: inv = [] } = useQuery({ queryKey: ["inv"], queryFn: () => api.get("/inventory").then((r) => r.data) });
  const { data: movement = [] } = useQuery({ queryKey: ["move30"], queryFn: () => api.get("/reports/movement?days=30").then((r) => r.data) });

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
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Insights</div>
        <h1 className="font-display text-4xl font-black tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-2">Read the workshop's pulse over the last 30 days.</p>
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
