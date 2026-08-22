import React, { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Maximize2, Clock, Wrench, Flame, RefreshCw, Truck } from "lucide-react";
import PlateBadge from "@/components/PlateBadge";
import { useNavigate } from "react-router-dom";

/**
 * Live-status TV board — one big row per open card.
 * Auto-refresh every 30s. Live "in shop" and "clocked" counters tick every second.
 */
function fmtHours(hours) {
  if (hours == null) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtMinutes(mins) {
  const total = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function liveSeconds(iso, now) {
  if (!iso) return 0;
  try { return Math.max(0, (now - new Date(iso).getTime()) / 1000); } catch { return 0; }
}
function fmtLive(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

const STATUS_STYLE = {
  open: "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/40",
  in_progress: "bg-amber-500/25 text-amber-700 dark:text-amber-300 border-amber-500/50",
};

export default function BayBoard() {
  const nav = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [fs, setFs] = useState(false);
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["bay-board"],
    queryFn: () => api.get("/bay-board").then(r => r.data),
    refetchInterval: 30000,
  });
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const cards = data?.cards || [];
  const totals = useMemo(() => ({
    open: cards.filter(c => c.status === "open").length,
    in_progress: cards.filter(c => c.status === "in_progress").length,
    running: cards.filter(c => c.live_since).length,
    parts_pending: cards.reduce((s, c) => s + (c.special_parts_pending || 0), 0),
  }), [cards]);

  const toggleFs = async () => {
    try {
      if (!document.fullscreenElement) { await document.documentElement.requestFullscreen(); setFs(true); }
      else { await document.exitFullscreen(); setFs(false); }
    } catch {}
  };

  return (
    <div className="space-y-6" data-testid="bay-board-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">LIVE WORKSHOP</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Bay Board</h1>
          <p className="text-muted-foreground mt-2">{cards.length} active cards · auto-refreshing every 30 s</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} className="rounded-full" disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" onClick={toggleFs} className="rounded-full" data-testid="bay-fullscreen">
            <Maximize2 className="h-4 w-4 mr-2" /> {fs ? "Exit" : "Full-screen"}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: "Open", v: totals.open, cls: "text-blue-700 dark:text-blue-400" },
          { l: "In progress", v: totals.in_progress, cls: "text-amber-700 dark:text-amber-400" },
          { l: "Clock running", v: totals.running, cls: "text-emerald-700 dark:text-emerald-400" },
          { l: "Parts on order", v: totals.parts_pending, cls: "text-primary" },
        ].map((k, i) => (
          <Card key={i} className="p-4 border-border">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{k.l}</div>
            <div className={`font-display text-3xl font-black tabular-nums font-mono ${k.cls}`}>{k.v}</div>
          </Card>
        ))}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {cards.length === 0 && (
          <Card className="p-16 border-border text-center text-muted-foreground">
            No open cards — the workshop is clear ✅
          </Card>
        )}
        {cards.map(c => {
          const running = !!c.live_since;
          const runningSec = liveSeconds(c.live_since, now);
          const label = [c.car_make, c.car_model, c.car_year].filter(Boolean).join(" ") || "Vehicle";
          const overdue = c.estimated_hours > 0 && c.hours_in_shop > c.estimated_hours * 2;
          return (
            <Card
              key={c.id}
              onClick={() => nav("/repairs")}
              className={`p-5 border cursor-pointer transition-all hover:border-primary/60 ${overdue ? "border-rose-500/50 bg-rose-500/5" : running ? "border-emerald-500/40 bg-emerald-500/5" : "border-border"}`}
              data-testid={`bay-card-${c.card_number}`}
            >
              <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-4 items-center">
                {/* Left — card # + plate */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-mono text-xs text-muted-foreground">{c.card_number}</div>
                    {c.priority === "high" && <Flame className="h-3.5 w-3.5 text-rose-500" />}
                  </div>
                  <div className="font-display text-lg font-bold truncate">{label}</div>
                  {c.car_plate && <div className="mt-1"><PlateBadge plate={c.car_plate} country={c.car_country || "NL"} size="sm" /></div>}
                </div>

                {/* Middle — customer + status + complaint */}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.customer_name || "Walk-in"}</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge className={`text-[10px] ${STATUS_STYLE[c.status] || ""}`}>{c.status.replace("_", " ")}</Badge>
                    {c.mechanic_name ? <span className="text-xs text-muted-foreground">👤 {c.mechanic_name}</span> : <span className="text-xs text-amber-700 dark:text-amber-400">unassigned</span>}
                    {c.special_parts_pending > 0 && <Badge variant="outline" className="text-[10px]"><Truck className="h-3 w-3 mr-1" />{c.special_parts_pending} on order</Badge>}
                  </div>
                  {c.complaint && <div className="text-[11px] text-muted-foreground mt-1 truncate">{c.complaint}</div>}
                </div>

                {/* Right — times */}
                <div className="text-right space-y-1 shrink-0 font-mono tabular-nums">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">In shop</div>
                  <div className={`text-xl font-bold ${overdue ? "text-rose-600 dark:text-rose-400" : ""}`}>{fmtHours(c.hours_in_shop)}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground pt-1 flex items-center justify-end gap-1">
                    <Clock className="h-3 w-3" /> {running ? "Running now" : "Clocked"}
                  </div>
                  <div className={`text-lg font-mono font-bold ${running ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                    {running ? fmtLive(runningSec + (c.clocked_minutes || 0) * 60) : fmtMinutes(c.clocked_minutes)}
                  </div>
                  {c.estimated_hours > 0 && (
                    <div className="text-[10px] text-muted-foreground">est. {c.estimated_hours}h</div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
