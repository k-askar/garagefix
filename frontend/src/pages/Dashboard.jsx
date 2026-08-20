import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Euro, AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

function KpiCard({ label, value, hint, icon: Icon, accent, testId }) {
  return (
    <Card data-testid={testId} className="card-hover border-border bg-card p-6 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="font-display text-3xl font-bold tabular-nums">{value}</div>
          {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={`h-10 w-10 rounded-md flex items-center justify-center border ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { data: sum } = useQuery({ queryKey: ["dash"], queryFn: () => api.get("/dashboard/summary").then((r) => r.data) });
  const { data: movement = [] } = useQuery({ queryKey: ["move14"], queryFn: () => api.get("/reports/movement?days=14").then((r) => r.data) });

  const s = sum || {};

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Overview · Live</div>
          <h1 className="font-display text-4xl lg:text-5xl font-black tracking-tight">Workshop dashboard</h1>
          <p className="text-muted-foreground mt-2 max-w-xl">A single, honest view of every part, every euro on the floor.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="rounded-full" data-testid="quick-inventory">
            <Link to="/inventory"><Package className="h-4 w-4 mr-2" /> Inventory</Link>
          </Button>
          <Button asChild className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90" data-testid="quick-movement">
            <Link to="/movement"><ArrowUpRight className="h-4 w-4 mr-2" /> Move stock</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard testId="kpi-stock-value" label="Stock value (cost)" value={formatEUR(s.total_stock_value)}
          hint={`Retail ${formatEUR(s.total_retail_value)}`} icon={Euro}
          accent="bg-primary/15 border-primary/30 text-primary" />
        <KpiCard testId="kpi-total-units" label="Units on floor" value={(s.total_units ?? 0).toLocaleString()}
          hint={`${s.total_items ?? 0} unique SKUs`} icon={Boxes}
          accent="bg-emerald-500/15 border-emerald-500/30 text-emerald-400" />
        <KpiCard testId="kpi-low-stock" label="Low stock" value={s.low_stock_count ?? 0}
          hint={`${s.out_of_stock_count ?? 0} out of stock`} icon={AlertTriangle}
          accent="bg-amber-500/15 border-amber-500/30 text-amber-400" />
        <KpiCard testId="kpi-today" label="Today's flow" value={`${s.todays_txn_count ?? 0}`}
          hint={`IN ${formatEUR(s.in_today)} · OUT ${formatEUR(s.out_today)}`} icon={TrendingUp}
          accent="bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-400" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-6 border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Stock movement · 14d</div>
              <h3 className="font-display text-xl font-bold">In / Out flow (EUR)</h3>
            </div>
            <div className="flex gap-4 text-xs font-mono text-muted-foreground">
              <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /> IN</span>
              <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-rose-400" /> OUT</span>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={movement}>
                <CartesianGrid stroke="hsl(217 33% 15%)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} stroke="hsl(215 20% 65%)" fontSize={11} />
                <YAxis stroke="hsl(215 20% 65%)" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(222 47% 7%)", border: "1px solid hsl(217 33% 15%)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="in" stroke="#34d399" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="out" stroke="#fb7185" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">Top movers · 30d</div>
              <h3 className="font-display text-xl font-bold">What's flying out</h3>
            </div>
          </div>
          <div className="space-y-3">
            {(s.top_movers || []).length === 0 && (
              <div className="text-sm text-muted-foreground py-8 text-center">No sales yet. Log your first Stock OUT.</div>
            )}
            {(s.top_movers || []).map((m, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center font-mono text-xs text-primary">{i + 1}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{m.name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{m.sku}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono">{m.qty} units</div>
                  <div className="text-[11px] font-mono text-emerald-400">{formatEUR(m.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-6 border-border" data-testid="low-stock-panel">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-amber-400">Action required</div>
            <h3 className="font-display text-xl font-bold">Below reorder point</h3>
          </div>
          <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10">
            {s.low_stock_count ?? 0} items
          </Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(s.low_stock_items || []).map((i) => (
            <div key={i.id} className="p-4 rounded-md border border-border bg-muted/30 flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{i.name}</div>
                <div className="text-[11px] font-mono text-muted-foreground">{i.sku}</div>
                <div className="mt-2 text-xs">
                  <span className="text-amber-400 font-mono">{i.quantity}</span>
                  <span className="text-muted-foreground"> / {i.reorder_point} reorder</span>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" className="rounded-full text-xs">
                <Link to="/movement"><ArrowDownRight className="h-3 w-3 mr-1" /> Restock</Link>
              </Button>
            </div>
          ))}
          {(s.low_stock_items || []).length === 0 && (
            <div className="col-span-full text-sm text-muted-foreground text-center py-8">
              All parts above reorder threshold. Nice.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
