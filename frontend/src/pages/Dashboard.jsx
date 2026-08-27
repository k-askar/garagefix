import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Euro, AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, TrendingUp, Car, Clock, Wrench, Users as UsersIcon, Bell, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useLang } from "@/i18n";
import PlateBadge from "@/components/PlateBadge";

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
  const { t } = useLang();
  const { data: sum } = useQuery({ queryKey: ["dash"], queryFn: () => api.get("/dashboard/summary").then((r) => r.data) });
  const { data: movement = [] } = useQuery({ queryKey: ["move14"], queryFn: () => api.get("/reports/movement?days=14").then((r) => r.data) });
  // Reminders widget — surfaces the count of pending service reminders (APK /
  // oil / manual) so the owner can jump straight to send them.
  const { data: reminders = [] } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => api.get("/reminders").then((r) => r.data),
    refetchInterval: 60000,
  });
  const pendingReminders = reminders.filter(r => r.status === "pending");
  const upcomingReminders = pendingReminders
    .slice()
    .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""))
    .slice(0, 4);

  const s = sum || {};
  const token = localStorage.getItem("garage_token") || "";
  const API = process.env.REACT_APP_BACKEND_URL;

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("overviewLive")}</div>
          <h1 className="font-display text-4xl lg:text-5xl font-black tracking-tight">{t("workshopDashboard")}</h1>
          <p className="text-muted-foreground mt-2 max-w-xl">{t("dashboardSubtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="rounded-full" data-testid="quick-inventory">
            <Link to="/inventory"><Package className="h-4 w-4 mr-2" /> {t("inventory")}</Link>
          </Button>
          <Button asChild className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90" data-testid="quick-movement">
            <Link to="/movement"><ArrowUpRight className="h-4 w-4 mr-2" /> {t("moveStock")}</Link>
          </Button>
        </div>
      </div>

      {/* Revenue snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard testId="kpi-cars-open" label={t("carsInWorkshop")} value={s.open_cars_count ?? 0}
          hint={`${(s.mechanic_minutes_today || 0) / 60 | 0}h ${(s.mechanic_minutes_today || 0) % 60 | 0}m ${t("laborToday")}`} icon={Car}
          accent="bg-primary/15 border-primary/30 text-primary" />
        <KpiCard testId="kpi-revenue-today" label={t("revenueToday")} value={formatEUR(s.revenue_today ?? 0)}
          hint={`${s.todays_txn_count ?? 0} ${t("transactions")}`} icon={Euro}
          accent="bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400" />
        <KpiCard testId="kpi-revenue-week" label={t("revenueWeek")} value={formatEUR(s.revenue_week ?? 0)}
          hint={t("last7Days")} icon={TrendingUp}
          accent="bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-700 dark:text-fuchsia-400" />
        <KpiCard testId="kpi-revenue-month" label={t("revenueMonth")} value={formatEUR(s.revenue_month ?? 0)}
          hint={t("last30Days")} icon={TrendingUp}
          accent="bg-sky-500/15 border-sky-500/30 text-sky-700 dark:text-sky-400" />
      </div>

      {/* Open cars in the workshop */}
      {/* Reminders — modern glass card with the next few upcoming customer nudges */}
      {pendingReminders.length > 0 && (
        <Card className="p-6 border-border relative overflow-hidden" data-testid="dash-reminders">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                <Bell className="h-5 w-5 text-amber-700 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-amber-700 dark:text-amber-400">
                  {t("reminders") || "Herinneringen"}
                </div>
                <div className="font-display text-2xl font-bold mt-0.5">
                  {pendingReminders.length} {(t("pending") || "pending").toLowerCase()}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("dashRemindersHint") || "Klanten die een dienst-nudge verdienen."}
                </div>
              </div>
            </div>
            <Button asChild variant="outline" className="rounded-full border-amber-500/40 hover:bg-amber-500/10" data-testid="dash-reminders-open">
              <Link to="/vehicles?tab=reminders"><Bell className="h-4 w-4 mr-2" /> {t("openReminders") || "Openen"}</Link>
            </Button>
          </div>
          <div className="relative mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
            {upcomingReminders.map((r) => (
              <Link
                key={r.id}
                to="/vehicles?tab=reminders"
                data-testid={`dash-reminder-${r.id}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-background/60 hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors p-3"
              >
                <div className="h-8 w-8 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                  {r.kind === "apk" ? <ShieldAlert className="h-4 w-4 text-rose-700 dark:text-rose-400" /> : <Bell className="h-4 w-4 text-amber-700 dark:text-amber-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{r.customer_name || "—"}</div>
                  <div className="text-[11px] font-mono text-muted-foreground truncate">
                    {r.reason} · {r.due_date}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {(s.open_cars || []).length > 0 && (
        <Card className="p-6 border-border" data-testid="open-cars-panel">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[11px] font-mono uppercase tracking-widest text-primary">{t("liveWorkshop")}</div>
              <h3 className="font-display text-2xl font-bold">{t("openCars")}</h3>
            </div>
            <Button asChild variant="outline" className="rounded-full" data-testid="dash-goto-repairs">
              <Link to="/repairs"><Wrench className="h-4 w-4 mr-2" /> {t("jobCards")}</Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(s.open_cars || []).map((c) => (
              <Link
                key={c.id}
                to={`/repairs`}
                data-testid={`open-car-${c.card_number}`}
                className="group flex gap-3 p-3 rounded-md border border-border bg-muted/30 hover:border-primary/50 transition-colors"
              >
                <div className="h-20 w-20 rounded-md overflow-hidden bg-secondary shrink-0 flex items-center justify-center border border-border">
                  {c.cover_photo_id ? (
                    <img
                      src={`${API}/api/photos/${c.cover_photo_id}?auth=${encodeURIComponent(token)}`}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Car className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[10px] text-primary uppercase tracking-widest">{c.card_number}</div>
                    <Badge className={c.status === "in_progress"
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40"
                      : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"}>
                      {t(`repair_status_${c.status}`)}
                    </Badge>
                  </div>
                  <div className="font-display font-bold truncate">{[c.car_make, c.car_model].filter(Boolean).join(" ") || t("vehicleTbd")}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <PlateBadge plate={c.car_plate} country={c.car_country || "NL"} size="xs" />
                    {c.customer_name && <span className="text-[11px] font-mono text-muted-foreground truncate">{c.customer_name}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] font-mono">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3" />{c.hours_in_shop}h</span>
                    {c.mechanic_name && <><span className="text-muted-foreground">·</span><span className="text-muted-foreground truncate">{c.mechanic_name}</span></>}
                    <span className="text-muted-foreground">·</span>
                    <span className="tabular-nums">{formatEUR(c.grand_total || 0)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Inventory KPIs (kept from before) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard testId="kpi-stock-value" label={t("stockValueCost")} value={formatEUR(s.total_stock_value)}
          hint={`${t("retail")} ${formatEUR(s.total_retail_value)}`} icon={Euro}
          accent="bg-primary/15 border-primary/30 text-primary" />
        <KpiCard testId="kpi-total-units" label={t("unitsOnFloor")} value={(s.total_units ?? 0).toLocaleString()}
          hint={`${s.total_items ?? 0} ${t("uniqueSkus")}`} icon={Boxes}
          accent="bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400" />
        <KpiCard testId="kpi-low-stock" label={t("lowStock")} value={s.low_stock_count ?? 0}
          hint={`${s.out_of_stock_count ?? 0} ${t("outOfStock")}`} icon={AlertTriangle}
          accent="bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-400" />
        <KpiCard testId="kpi-today" label={t("todaysFlow")} value={`${s.todays_txn_count ?? 0}`}
          hint={`IN ${formatEUR(s.in_today)} · OUT ${formatEUR(s.out_today)}`} icon={TrendingUp}
          accent="bg-fuchsia-500/15 border-fuchsia-500/30 text-fuchsia-700 dark:text-fuchsia-400" />
      </div>

      {(s.mechanic_hours_today || []).length > 0 && (
        <Card className="p-6 border-border" data-testid="mech-hours-panel">
          <div className="flex items-center gap-2 mb-3">
            <UsersIcon className="h-5 w-5 text-primary" />
            <h3 className="font-display text-xl font-bold">{t("mechanicHoursToday")}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(s.mechanic_hours_today || []).map((m) => (
              <div key={m.name} className="p-3 rounded-md border border-border bg-muted/30 flex items-center justify-between">
                <span className="font-medium">{m.name}</span>
                <span className="font-mono tabular-nums text-primary">{m.hours}h</span>
              </div>
            ))}
          </div>
        </Card>
      )}

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
                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} />
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
                  <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">{formatEUR(m.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-6 border-border" data-testid="low-stock-panel">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-amber-700 dark:text-amber-400">Action required</div>
            <h3 className="font-display text-xl font-bold">Below reorder point</h3>
          </div>
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/15">
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
                  <span className="text-amber-700 dark:text-amber-400 font-mono">{i.quantity}</span>
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
