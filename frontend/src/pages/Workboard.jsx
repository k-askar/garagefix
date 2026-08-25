import React, { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft, ChevronRight, Wrench, Clock, Search, Maximize2, Minimize2, Flame, ArrowLeftRight, X,
} from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";
import PlateBadge from "@/components/PlateBadge";

/* ---------- date helpers ---------- */
const DAY_MS = 86400000;
const isoDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
};
const startOfWeek = (d) => {
  // Monday-first
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0=Mon
  x.setDate(x.getDate() - day);
  return x;
};
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY_MS);

const STATUS_STYLE = {
  open: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  in_progress: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};

const HOUR_PRESETS = [1, 2, 4, 8];

/* ---------- load bar (per mechanic per day) ---------- */
function LoadBar({ hours, capacity = 8 }) {
  const pct = Math.min(200, Math.round((hours / capacity) * 100));
  let color = "bg-emerald-500";
  if (pct >= 100) color = "bg-rose-500";
  else if (pct >= 75) color = "bg-amber-500";
  else if (pct === 0) color = "bg-muted-foreground/20";
  return (
    <div className="w-full">
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`${color} h-full transition-all`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground">
        <span className={pct >= 100 ? "text-rose-600 dark:text-rose-400 font-bold" : ""}>
          {hours}h / {capacity}h
        </span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

/* Check if a card has an alert-worthy vehicle condition (expired/soon APK or oil overdue). */
function vehicleAlert(card) {
  const alerts = [];
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const apk = card.car_apk_expiry;
  if (apk) {
    if (apk < today) alerts.push({ kind: "apk", level: "critical", text: `APK expired ${apk}` });
    else if (apk <= soon) alerts.push({ kind: "apk", level: "warn", text: `APK ends ${apk}` });
  }
  const nextOil = Number(card.car_next_oil_change_km || 0);
  const curKm = parseInt(String(card.car_km || "0").replace(/[^0-9]/g, ""), 10) || 0;
  if (nextOil > 0 && curKm > 0) {
    if (curKm >= nextOil) alerts.push({ kind: "oil", level: "critical", text: `Oil ${curKm - nextOil}km overdue` });
    else if (nextOil - curKm <= 500) alerts.push({ kind: "oil", level: "warn", text: `Oil due in ${nextOil - curKm}km` });
  }
  return alerts;
}

/* ---------- draggable job card ---------- */
function CardChip({ card, onDragStart, onOpen, onSendBack, compact = false }) {
  const veh = [card.car_make, card.car_model].filter(Boolean).join(" ") || "Vehicle TBD";
  const alerts = vehicleAlert(card);
  const worst = alerts.reduce((a, x) => (x.level === "critical" ? "critical" : a), alerts.length ? "warn" : "");
  const alertRing =
    worst === "critical" ? "ring-2 ring-rose-500 animate-pulse shadow-[0_0_12px_rgba(244,63,94,0.6)]" :
    worst === "warn" ? "ring-1 ring-amber-500/70" : "";
  const priorityRing =
    !worst && card.priority === "high" ? "ring-1 ring-rose-500/60" :
    !worst && card.priority === "low" ? "ring-1 ring-slate-500/40" : "";
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card)}
      onClick={onOpen}
      className={`group cursor-grab active:cursor-grabbing rounded-md border border-border bg-card p-2.5 hover:border-primary/40 hover:bg-accent/40 transition-all ${alertRing} ${priorityRing}`}
      data-testid={`workboard-chip-${card.card_number}`}
      title={alerts.map(a => a.text).join(" · ")}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Wrench className="h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{card.card_number} · {veh}</div>
          <div className="text-[10px] font-mono text-muted-foreground truncate flex items-center gap-1.5">
            {card.car_plate && <PlateBadge plate={card.car_plate} country={card.car_country || "NL"} size="xxs" />}
            <span className="truncate">{card.customer_name || "Walk-in"}</span>
          </div>
          {/* Show the assigned mechanic prominently on the chip. Employees
              browsing the "Niet-toegewezen" sidebar can instantly see the
              card is destined for a specific colleague, and mechanic-column
              chips still confirm ownership if a card is later moved. */}
          {card.mechanic_name && (
            <div className="text-[10px] font-mono text-primary truncate mt-0.5 flex items-center gap-1">
              <Wrench className="h-2.5 w-2.5" />
              <span className="truncate">{card.mechanic_name}</span>
            </div>
          )}
        </div>
        {!compact && card.estimated_hours > 0 && (
          <Badge variant="outline" className="font-mono text-[10px] px-1.5 h-5 shrink-0">
            <Clock className="h-3 w-3 mr-1" />{card.estimated_hours}h
          </Badge>
        )}
        {card.priority === "high" && <Flame className="h-3 w-3 text-rose-500 shrink-0" />}
      </div>
      {!compact && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          <Badge className={STATUS_STYLE[card.status] + " text-[9px] px-1.5 h-4"}>
            {card.status.replace("_", " ")}
          </Badge>
          {alerts.map((a, i) => (
            <Badge
              key={i}
              className={`text-[9px] px-1.5 h-4 ${a.level === "critical"
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/50"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40"}`}
              data-testid={`workboard-alert-${a.kind}-${card.card_number}`}
            >
              {a.kind === "apk" ? "APK" : "OIL"} · {a.text.split(" ").slice(-1)[0]}
            </Badge>
          ))}
          {onSendBack && (
            <button
              onClick={(e) => { e.stopPropagation(); onSendBack(card); }}
              className="ms-auto text-[9px] font-mono text-muted-foreground hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Send back to unassigned"
              data-testid={`workboard-sendback-${card.card_number}`}
            >
              <ArrowLeftRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- editor for estimated hours (popover-lite) ---------- */
function HoursPicker({ current, onPick, onClose }) {
  const [custom, setCustom] = useState(current || "");
  return (
    <div
      className="absolute z-50 top-full mt-1 start-0 rounded-md border border-border bg-card shadow-xl p-3 w-56"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
        Estimated hours
      </div>
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {HOUR_PRESETS.map((h) => (
          <Button
            key={h}
            size="sm"
            variant={current === h ? "default" : "outline"}
            className="h-8 font-mono"
            onClick={() => { onPick(h); onClose(); }}
            data-testid={`workboard-hours-${h}`}
          >
            {h}h
          </Button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          type="number"
          step="0.5"
          min="0"
          className="h-8 text-xs"
          placeholder="custom"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <Button
          size="sm"
          className="h-8"
          onClick={() => { onPick(Number(custom) || 0); onClose(); }}
          data-testid="workboard-hours-custom-apply"
        >
          Set
        </Button>
      </div>
    </div>
  );
}

/* =====================================================================
   WORKBOARD PAGE
   ===================================================================== */
export default function Workboard() {
  const { t, meta } = useLang();
  const qc = useQueryClient();
  const isRTL = meta.dir === "rtl";
  const localeStr = meta.locale || "en-GB";

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [statusFilter, setStatusFilter] = useState("active"); // active | all | open | in_progress | completed
  const [search, setSearch] = useState("");
  const [presenter, setPresenter] = useState(false);
  const [hoursMenu, setHoursMenu] = useState(null); // { cardId, top, left }

  const { data: cards = [], refetch } = useQuery({
    queryKey: ["workboard-cards"],
    queryFn: () => api.get("/repairs").then((r) => r.data),
    refetchInterval: presenter ? 30000 : false,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["workboard-users"],
    queryFn: () => api.get("/users").then((r) => r.data).catch(() => []),
  });

  const mechanics = useMemo(
    () => users.filter((u) => u.role === "staff" || u.role === "owner"),
    [users]
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const dayKeys = useMemo(() => days.map(isoDay), [days]);

  /* filter cards by status */
  const filterByStatus = (c) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "active") return c.status !== "completed";
    return c.status === statusFilter;
  };

  /* search across chip */
  const matchesSearch = (c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.card_number?.toLowerCase().includes(q) ||
      c.customer_name?.toLowerCase().includes(q) ||
      c.car_plate?.toLowerCase().includes(q) ||
      c.car_make?.toLowerCase().includes(q) ||
      c.car_model?.toLowerCase().includes(q)
    );
  };

  /* bucket: unassigned (no mechanic OR no scheduled_date) → sidebar */
  const unassigned = useMemo(
    () =>
      cards
        .filter(filterByStatus)
        .filter(matchesSearch)
        .filter((c) => !c.mechanic_id || !c.scheduled_date)
        .sort((a, b) =>
          (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0) ||
          (a.created_at < b.created_at ? 1 : -1)
        ),
    [cards, statusFilter, search]
  );

  /* bucket: assigned in visible week per mechanic-day */
  const bucket = useMemo(() => {
    const m = new Map();
    cards
      .filter(filterByStatus)
      .filter(matchesSearch)
      .filter((c) => c.mechanic_id && c.scheduled_date && dayKeys.includes(c.scheduled_date))
      .forEach((c) => {
        const key = `${c.mechanic_id}|${c.scheduled_date}`;
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(c);
      });
    return m;
  }, [cards, dayKeys, statusFilter, search]);

  /* weekly load per mechanic (used for pill color) — respects visible-status filter */
  const weeklyLoad = useMemo(() => {
    const m = new Map();
    mechanics.forEach((u) => m.set(u.id, 0));
    cards.filter(filterByStatus).forEach((c) => {
      if (c.mechanic_id && c.scheduled_date && dayKeys.includes(c.scheduled_date)) {
        m.set(c.mechanic_id, (m.get(c.mechanic_id) || 0) + (Number(c.estimated_hours) || 0));
      }
    });
    return m;
  }, [cards, mechanics, dayKeys, statusFilter]);

  /* ---------- drag & drop ---------- */
  const dragRef = useRef(null);
  const onDragStart = (e, card) => {
    dragRef.current = card;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", card.id); } catch {}
  };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };

  const assign = async (cardId, patch) => {
    try {
      await api.post(`/repairs/${cardId}/assign`, patch);
      qc.invalidateQueries({ queryKey: ["workboard-cards"] });
    } catch (e) {
      toast.error(formatApiError(e));
    }
  };

  const onDropOnCell = async (e, mechanicId, dayKey) => {
    e.preventDefault();
    const card = dragRef.current;
    dragRef.current = null;
    if (!card) return;
    // conflict warning
    const already = (bucket.get(`${mechanicId}|${dayKey}`) || [])
      .filter((c) => c.id !== card.id)
      .reduce((s, c) => s + (Number(c.estimated_hours) || 0), 0);
    const need = Number(card.estimated_hours) || 0;
    if (already + need > 8) {
      if (!window.confirm(t("workboardOverloadConfirm"))) return;
    }
    await assign(card.id, {
      mechanic_id: mechanicId,
      scheduled_date: dayKey,
      // if the card has no estimate yet, default to 1h so it takes up space
      estimated_hours: need || 1,
    });
    toast.success(t("workboardAssigned"));
  };

  const onDropOnUnassigned = async (e) => {
    e.preventDefault();
    const card = dragRef.current;
    dragRef.current = null;
    if (!card) return;
    await assign(card.id, { mechanic_id: null, scheduled_date: "" });
    toast.success(t("workboardUnassigned"));
  };

  const sendBack = async (card) => {
    await assign(card.id, { mechanic_id: null, scheduled_date: "" });
    toast.success(t("workboardUnassigned"));
  };

  const setHours = async (card, hours) => {
    await assign(card.id, { estimated_hours: hours });
  };

  const cyclePriority = async (card) => {
    const order = ["normal", "high", "low"];
    const next = order[(order.indexOf(card.priority || "normal") + 1) % order.length];
    await assign(card.id, { priority: next });
  };

  /* week nav */
  const goToday = () => setWeekStart(startOfWeek(new Date()));
  const goPrev = () => setWeekStart(addDays(weekStart, -7));
  const goNext = () => setWeekStart(addDays(weekStart, 7));

  const fmtHeader = () => {
    const end = addDays(weekStart, 6);
    const opts = { day: "2-digit", month: "short" };
    return `${weekStart.toLocaleDateString(localeStr, opts)} – ${end.toLocaleDateString(localeStr, opts)}`;
  };

  const dowLabels = ["dow_mon", "dow_tue", "dow_wed", "dow_thu", "dow_fri", "dow_sat", "dow_sun"];
  const todayKey = isoDay(new Date());

  useEffect(() => {
    const close = () => setHoursMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <div className={presenter ? "space-y-4" : "space-y-6"} data-testid="workboard-page">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">
            {t("workshopFloor")}
          </div>
          <h1 className="font-display text-4xl font-black tracking-tight">
            {t("workboard")}
          </h1>
          <p className="text-muted-foreground mt-2">{t("workboardTagline")}</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Button variant="outline" className="rounded-full" onClick={goToday} data-testid="workboard-today">
            {t("today")}
          </Button>
          <div className="flex items-center gap-1 border border-border rounded-full px-2 py-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={isRTL ? goNext : goPrev} data-testid="workboard-prev">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-mono min-w-[160px] text-center">{fmtHeader()}</div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={isRTL ? goPrev : goNext} data-testid="workboard-next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Tabs value={statusFilter} onValueChange={setStatusFilter}>
            <TabsList>
              <TabsTrigger value="active" data-testid="workboard-filter-active">{t("wbFilterActive")}</TabsTrigger>
              <TabsTrigger value="open">{t("open")}</TabsTrigger>
              <TabsTrigger value="in_progress">{t("inProgress")}</TabsTrigger>
              <TabsTrigger value="all">{t("allCards")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => setPresenter((p) => !p)}
            data-testid="workboard-presenter"
          >
            {presenter ? <Minimize2 className="h-4 w-4 me-2" /> : <Maximize2 className="h-4 w-4 me-2" />}
            {t("wbPresenter")}
          </Button>
        </div>
      </div>

      {/* Flex: main board + right sidebar */}
      <div className="flex gap-3 items-start">
        {/* Main board */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Weekday headers (aligned with 220px mechanic-label + 7 day cells) */}
          <div className="grid grid-cols-[220px_repeat(7,minmax(0,1fr))] gap-2">
            <div />
            {days.map((d, i) => {
              const key = isoDay(d);
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={`text-center py-2 rounded-md border ${
                    isToday ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  <div className="text-[10px] font-mono uppercase tracking-widest">
                    {t(dowLabels[i])}
                  </div>
                  <div className="text-sm font-mono font-bold">
                    {d.toLocaleDateString(localeStr, { day: "2-digit", month: "short" })}
                  </div>
                </div>
              );
            })}
          </div>

          {mechanics.length === 0 && (
            <div className="text-center py-16 border border-dashed border-border rounded-lg">
              <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{t("wbNoMechanics")}</p>
            </div>
          )}

          {/* One row per mechanic */}
          {mechanics.map((u) => {
            const totalWeek = weeklyLoad.get(u.id) || 0;
            const dot =
              totalWeek === 0 ? "bg-emerald-500" :
              totalWeek <= 40 ? "bg-amber-500" : "bg-rose-500";
            return (
              <div
                key={u.id}
                className="grid grid-cols-[220px_repeat(7,minmax(0,1fr))] gap-2"
                data-testid={`workboard-row-${u.id}`}
              >
                <div className="p-3 border border-border rounded-md bg-card flex flex-col justify-between min-h-[180px]">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${dot} shrink-0`} />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{u.name || u.email}</div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        {u.role}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                      {t("wbWeekLoad")}
                    </div>
                    <LoadBar hours={totalWeek} capacity={40} />
                  </div>
                </div>
                {days.map((d) => {
                  const key = isoDay(d);
                  const list = bucket.get(`${u.id}|${key}`) || [];
                  const dayHours = list.reduce((s, c) => s + (Number(c.estimated_hours) || 0), 0);
                  const isToday = key === todayKey;
                  return (
                    <div
                      key={`${u.id}-${key}`}
                      onDragOver={onDragOver}
                      onDrop={(e) => onDropOnCell(e, u.id, key)}
                      className={`min-h-[180px] rounded-md border p-2 flex flex-col gap-1.5 transition-colors ${
                        isToday ? "bg-primary/5 border-primary/30" : "bg-muted/20 border-border"
                      } hover:border-primary/40`}
                      data-testid={`workboard-cell-${u.id}-${key}`}
                    >
                      <div className="flex-1 space-y-1.5">
                        {list.length === 0 && (
                          <div className="text-[10px] font-mono text-muted-foreground/50 text-center py-4">
                            {t("wbEmpty")}
                          </div>
                        )}
                        {list.map((c) => (
                          <div key={c.id} className="relative">
                            <CardChip
                              card={c}
                              onDragStart={onDragStart}
                              onSendBack={sendBack}
                              onOpen={(e) => {
                                e.stopPropagation();
                                setHoursMenu({ cardId: c.id, current: c.estimated_hours });
                              }}
                              compact={presenter}
                            />
                            {hoursMenu?.cardId === c.id && (
                              <HoursPicker
                                current={c.estimated_hours}
                                onPick={(h) => setHours(c, h)}
                                onClose={() => setHoursMenu(null)}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="pt-1 border-t border-border/50">
                        <LoadBar hours={dayHours} capacity={8} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Right sidebar */}
        <UnassignedList
          cards={unassigned}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDropOnUnassigned}
          onCyclePriority={cyclePriority}
          count={unassigned.length}
          t={t}
          search={search}
          setSearch={setSearch}
          hoursMenu={hoursMenu}
          setHoursMenu={setHoursMenu}
          setHours={setHours}
        />
      </div>
    </div>
  );
}

/* ---------- Unassigned sidebar ---------- */
function UnassignedList({ cards, onDragStart, onDragOver, onDrop, onCyclePriority, count, t, search, setSearch, hoursMenu, setHoursMenu, setHours }) {
  return (
    <Card
      className="p-3 border-border overflow-hidden flex flex-col w-[280px] shrink-0 sticky top-4"
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="workboard-unassigned-list"
    >
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          placeholder={t("wbSearchTasks")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-1"
          data-testid="workboard-search"
        />
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {t("wbUnassigned")}
        </div>
        <Badge variant="outline" className="font-mono">
          {count}
        </Badge>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[75vh] pr-1">
        {cards.length === 0 && (
          <div className="text-[11px] font-mono text-muted-foreground/60 text-center py-8">
            {t("wbAllAssigned")}
          </div>
        )}
        {cards.map((c) => (
          <div key={c.id} className="relative group">
            <CardChip
              card={c}
              onDragStart={onDragStart}
              onOpen={(e) => {
                e.stopPropagation();
                setHoursMenu({ cardId: c.id, current: c.estimated_hours });
              }}
            />
            <button
              className="absolute top-1 end-1 opacity-0 group-hover:opacity-100 text-[9px] font-mono text-muted-foreground hover:text-primary bg-card/80 rounded px-1"
              onClick={(e) => { e.stopPropagation(); onCyclePriority(c); }}
              title="Cycle priority"
              data-testid={`workboard-priority-${c.card_number}`}
            >
              <Flame className="h-3 w-3" />
            </button>
            {hoursMenu?.cardId === c.id && (
              <HoursPicker
                current={c.estimated_hours}
                onPick={(h) => setHours(c, h)}
                onClose={() => setHoursMenu(null)}
              />
            )}
          </div>
        ))}
      </div>
      <div className="text-[10px] font-mono text-muted-foreground/70 pt-2 border-t border-border mt-2">
        {t("wbTip")}
      </div>
    </Card>
  );
}
