import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Car, Wrench, Plus, Trash2, CheckCircle2, FileText, Printer, User, Gauge, X, ClipboardList, FileDown, MessageCircle, Play, Square, Timer, Lock, Unlock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/i18n";
import { downloadRepairCardPdf, printRepairCard, downloadListReportPdf, printListReport } from "@/lib/reports";
import { whatsappShare } from "@/lib/whatsapp";
import RepairPhotos from "@/components/RepairPhotos";
import PlateBadge from "@/components/PlateBadge";
import SearchableSelect from "@/components/SearchableSelect";
import SpecialPartsPanel from "@/components/SpecialPartsPanel";

const STATUS_STYLE = {
  open: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  in_progress: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
};
const STATUS_LABEL = { open: "Open", in_progress: "In progress", completed: "Completed" };

function repairLabels(t) {
  return {
    jobCard: t("jobCards"), customer: t("customer"), vehicle: t("vehicle"),
    mechanic: t("mechanic"), status: t("status"), complaint: t("customerComplaint"),
    diagnosis: t("diagnosis"), workDone: t("workPerformed"), part: t("part"),
    qty: t("qty"), unitPrice: t("unitPrice"), total: t("total"), noParts: t("noParts") || "—",
    partsTotal: t("parts"), labor: t("labor"), grandTotal: t("grandTotal"),
    plate: t("plate"), km: t("km"),
    timeClock: t("timeClock"), startedAt: t("startedAt"), stopped: t("stopped"), duration: t("duration"),
  };
}

function printJobCard(card, settings) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return;
  const rows = (card.parts_used || []).map(p =>
    `<tr><td>${p.name}<div style="font-size:10px;color:#888">${p.sku}</div></td><td class="right">${p.quantity}</td><td class="right">${formatEUR(p.unit_price)}</td><td class="right">${formatEUR(p.total)}</td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><title>${card.card_number}</title>
    <style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;padding:32px;color:#111;max-width:720px;margin:0 auto}h1{font-size:22px;margin:0}.muted{color:#666;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.box{border:1px solid #eee;border-radius:8px;padding:12px}.lbl{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#666}.val{font-size:14px;font-weight:600;margin-top:2px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #eee;text-align:left;font-size:13px}th{background:#f5f5f5}.right{text-align:right}.badge{display:inline-block;padding:2px 10px;border-radius:999px;background:#0ea5e9;color:#fff;font-size:10px;letter-spacing:.1em}</style>
    </head><body>
    <div style="display:flex;justify-content:space-between;align-items:start">
      <div><h1>${settings?.name || "Garage"}</h1><div class="muted">${settings?.address || ""}</div><div class="muted">${settings?.phone || ""}</div></div>
      <div style="text-align:right"><span class="badge">JOB CARD</span><div style="font-size:14px;margin-top:6px;font-weight:700">${card.card_number}</div><div class="muted">${new Date(card.created_at).toLocaleDateString("en-GB")}</div></div>
    </div>
    <div class="grid">
      <div class="box"><div class="lbl">Customer</div><div class="val">${card.customer_name || "—"}</div><div class="muted">${card.customer_phone || ""}</div></div>
      <div class="box"><div class="lbl">Vehicle</div><div class="val">${[card.car_make, card.car_model, card.car_year].filter(Boolean).join(" ")}</div><div class="muted">Plate: ${card.car_plate || "—"} · ${card.car_color || ""} · ${card.car_km ? card.car_km + " km" : ""}</div></div>
      <div class="box"><div class="lbl">Mechanic</div><div class="val">${card.mechanic_name || "—"}</div></div>
      <div class="box"><div class="lbl">Status</div><div class="val">${STATUS_LABEL[card.status] || card.status}</div></div>
    </div>
    ${card.complaint ? `<div style="margin-top:16px"><div class="lbl">Customer complaint</div><p>${card.complaint}</p></div>` : ""}
    ${card.diagnosis ? `<div style="margin-top:8px"><div class="lbl">Diagnosis</div><p>${card.diagnosis}</p></div>` : ""}
    ${card.work_done ? `<div style="margin-top:8px"><div class="lbl">Work performed</div><p>${card.work_done}</p></div>` : ""}
    <table><thead><tr><th>Part</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Total</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" style="text-align:center;color:#888;padding:16px">No parts</td></tr>`}</tbody></table>
    <div style="margin-top:16px;text-align:right">
      <div class="muted">Parts total: ${formatEUR(card.parts_total)}</div>
      <div class="muted">Labor: ${formatEUR(card.labor_charge)}</div>
      <div style="font-size:16px;font-weight:700;margin-top:4px">Grand total: ${formatEUR(card.grand_total)}</div>
    </div>
    </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

function fmtDuration(mins) {
  const total = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtLive(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function TimeClockPanel({ card, setData, settings, refetch }) {
  const { t, meta } = useLang();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rate = Number(settings?.labor_rate || 45);
  const logs = card.time_logs || [];
  const running = useMemo(() => logs.find(l => !l.stopped_at), [logs]);
  const totalMinutes = logs.reduce((s, l) => s + (l.stopped_at ? (Number(l.minutes) || 0) : 0), 0);
  const autoCharge = (totalMinutes / 60) * rate;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const liveSeconds = running ? Math.max(0, (now - new Date(running.started_at).getTime()) / 1000) : 0;

  const clockIn = async () => {
    setBusy(true);
    try {
      const { data: updated } = await api.post(`/repairs/${card.id}/clock-in`, { note });
      setData(updated); setNote("");
      toast.success(t("clockInSuccess"));
      refetch();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const clockOut = async () => {
    setBusy(true);
    try {
      const { data: updated } = await api.post(`/repairs/${card.id}/clock-out`, { note });
      setData(updated); setNote("");
      toast.success(t("clockOutSuccess"));
      refetch();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const removeLog = async (logId) => {
    if (!window.confirm(t("delete") + "?")) return;
    try {
      const { data: updated } = await api.delete(`/repairs/${card.id}/time-logs/${logId}`);
      setData(updated); toast.success(t("deleted"));
      refetch();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const localeStr = meta.dir === "rtl" ? "ar-EG" : "en-GB";

  return (
    <Card className="p-5 border-border space-y-4" data-testid="time-clock-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" />
          <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{t("timeClock")}</div>
        </div>
        <div className="text-[11px] font-mono text-muted-foreground">{t("rate")}: {formatEUR(rate)} / {t("hours")}</div>
      </div>

      {/* Live timer + clock in/out */}
      <div className={`rounded-md border p-4 flex items-center justify-between gap-3 ${running ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-muted/30"}`}>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {running ? `${t("running")} · ${running.mechanic_name || t("mechanic")}` : t("stopped")}
          </div>
          <div className={`font-display text-3xl font-black tabular-nums mt-1 ${running ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`} data-testid="time-clock-live">
            {running ? fmtLive(liveSeconds) : "00:00:00"}
          </div>
          {running && <div className="text-[11px] font-mono text-muted-foreground mt-1">{t("startedAt")}: {new Date(running.started_at).toLocaleTimeString(localeStr, { hour: "2-digit", minute: "2-digit" })}</div>}
        </div>
        <div className="flex flex-col gap-2 min-w-[220px]">
          <Input placeholder={t("logNote")} value={note} onChange={(e) => setNote(e.target.value)} data-testid="time-clock-note" />
          {running ? (
            <Button onClick={clockOut} disabled={busy} className="rounded-full bg-rose-500 hover:bg-rose-500/90 text-white" data-testid="time-clock-out">
              <Square className="h-4 w-4 mr-2" /> {t("clockOut")}
            </Button>
          ) : (
            <Button onClick={clockIn} disabled={busy} className="rounded-full bg-emerald-500 hover:bg-emerald-500/90 text-white" data-testid="time-clock-in">
              <Play className="h-4 w-4 mr-2" /> {t("clockIn")}
            </Button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-md border border-border">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("duration")}</div>
          <div className="font-mono font-bold text-lg tabular-nums">{fmtDuration(totalMinutes)}</div>
        </div>
        <div className="p-3 rounded-md border border-border">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("rate")}</div>
          <div className="font-mono font-bold text-lg tabular-nums">{formatEUR(rate)}</div>
        </div>
        <div className="p-3 rounded-md border border-primary/30 bg-primary/5">
          <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("autoLabor")}</div>
          <div className="font-mono font-bold text-lg tabular-nums text-primary" data-testid="time-clock-auto-labor">{formatEUR(autoCharge)}</div>
        </div>
      </div>

      {/* Logs list */}
      <div className="space-y-2">
        {logs.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">{t("noTimeLogs")}</div>}
        {logs.slice().sort((a, b) => b.started_at.localeCompare(a.started_at)).map(l => (
          <div key={l.id} className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-border" data-testid={`time-log-row-${l.id}`}>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{l.mechanic_name || t("unassigned")}</div>
              <div className="text-[11px] font-mono text-muted-foreground">
                {new Date(l.started_at).toLocaleString(localeStr, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                {" → "}
                {l.stopped_at ? new Date(l.stopped_at).toLocaleString(localeStr, { hour: "2-digit", minute: "2-digit" }) : <span className="text-emerald-700 dark:text-emerald-400">{t("liveTimer")}</span>}
              </div>
              {l.note && <div className="text-[11px] text-muted-foreground mt-0.5">{l.note}</div>}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-sm font-mono font-bold tabular-nums">{l.stopped_at ? fmtDuration(l.minutes) : "…"}</div>
                {l.stopped_at && <div className="text-[10px] font-mono text-muted-foreground">{formatEUR((Number(l.minutes) / 60) * rate)}</div>}
              </div>
              <Button size="icon" variant="ghost" onClick={() => removeLog(l.id)} data-testid={`time-log-remove-${l.id}`}>
                <X className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CardEditor({ card, onClose, users, customers, items, settings, refetch }) {
  const { t, meta } = useLang();
  const [data, setData] = useState(card);
  const [saving, setSaving] = useState(false);
  const [addItem, setAddItem] = useState("");
  const [addQty, setAddQty] = useState(1);
  // Identity fields (customer + vehicle) are LOCKED by default to prevent
  // accidental edits. The owner can click the padlock to unlock.
  const [locked, setLocked] = useState(true);
  const linkedCustomer = customers.find(c => c.id === card.customer_id);
  const customerOutOfSync = !!linkedCustomer && (
    (linkedCustomer.name || "") !== (data.customer_name || "") ||
    (linkedCustomer.phone || "") !== (data.customer_phone || "")
  );
  const syncFromCustomer = () => {
    if (!linkedCustomer) return;
    set("customer_name", linkedCustomer.name || "");
    set("customer_phone", linkedCustomer.phone || "");
    toast.success(t("customerSynced"));
  };
  const logoSrc = settings?.logo_url?.startsWith("/api/")
    ? `${process.env.REACT_APP_BACKEND_URL}${settings.logo_url}`
    : (settings?.logo_url || "/logo-shawish.png");

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  const saveField = async () => {
    setSaving(true);
    try {
      const { data: updated } = await api.put(`/repairs/${card.id}`, {
        customer_name: data.customer_name, customer_phone: data.customer_phone,
        car_make: data.car_make, car_model: data.car_model, car_year: data.car_year,
        car_plate: data.car_plate, car_color: data.car_color, car_km: data.car_km,
        mechanic_id: data.mechanic_id, complaint: data.complaint, diagnosis: data.diagnosis,
        work_done: data.work_done, labor_charge: Number(data.labor_charge || 0),
        notes: data.notes, status: data.status,
      });
      setData(updated);
      toast.success("Card updated");
      refetch();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  const addPart = async () => {
    if (!addItem) return toast.error("Pick a part");
    try {
      const { data: updated } = await api.post(`/repairs/${card.id}/parts`, { item_id: addItem, quantity: Number(addQty) });
      setData(updated); setAddItem(""); setAddQty(1);
      toast.success("Part added and stock updated");
      refetch();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const removePart = async (txnId) => {
    try {
      const { data: updated } = await api.delete(`/repairs/${card.id}/parts/${txnId}`);
      setData(updated); toast.success("Part removed, stock restored"); refetch();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const invoice = async () => {
    try {
      const { data: inv } = await api.post(`/repairs/${card.id}/invoice`);
      toast.success(`Invoice ${inv.invoice_number} created`);
      refetch();
      onClose();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="rounded-lg bg-secondary border border-primary/20 p-4 flex items-center justify-between gap-4 mb-4">
          <img src={logoSrc} alt="logo" className="h-14 w-auto object-contain" data-testid="repair-editor-logo" onError={(e) => { e.currentTarget.src = "/logo-shawish.png"; }} />
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary">Job card</div>
            <div className="font-mono text-primary text-sm">{data.card_number}</div>
            <div className="text-[10px] font-mono text-muted-foreground">{new Date(data.created_at).toLocaleDateString(meta.dir === 'rtl' ? 'ar-EG' : 'en-GB')}</div>
          </div>
        </div>
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-3">
            <span>Job card {data.card_number}</span>
            <Badge className={STATUS_STYLE[data.status] + " capitalize"}>{STATUS_LABEL[data.status]}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Lock toolbar for identity fields */}
          <div className="flex items-center justify-between gap-2 flex-wrap rounded-md border border-border bg-muted/30 px-3 py-2" data-testid="repair-identity-lock-bar">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
              <span>{locked ? t("identityLocked") : t("identityUnlocked")}</span>
              {linkedCustomer && (
                <Badge variant="outline" className="ms-2 font-mono text-[10px]">
                  <User className="h-3 w-3 mr-1" />{linkedCustomer.name}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {customerOutOfSync && (
                <Button size="sm" variant="outline" className="rounded-full h-7 text-[11px]" onClick={syncFromCustomer} data-testid="repair-sync-customer">
                  <RefreshCw className="h-3 w-3 mr-1" />{t("syncFromRecord")}
                </Button>
              )}
              <Button
                size="sm"
                variant={locked ? "outline" : "default"}
                className="rounded-full h-7 text-[11px]"
                onClick={() => {
                  if (locked) {
                    if (window.confirm(t("unlockConfirm"))) setLocked(false);
                  } else {
                    setLocked(true);
                  }
                }}
                data-testid="repair-lock-toggle"
              >
                {locked ? <><Unlock className="h-3 w-3 mr-1" />{t("unlock")}</> : <><Lock className="h-3 w-3 mr-1" />{t("lockAgain")}</>}
              </Button>
            </div>
          </div>

          {/* Customer + Car header cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className={`p-5 border-border card-hover ${locked ? "bg-muted/10" : ""}`}>
              <div className="flex items-center gap-2 mb-3">
                <User className="h-4 w-4 text-primary" />
                <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Customer</div>
                {locked && <Lock className="h-3 w-3 ms-auto text-muted-foreground/70" />}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2"><Label className="text-xs">Name</Label><Input value={data.customer_name || ""} readOnly={locked} disabled={locked} onChange={(e) => set("customer_name", e.target.value)} data-testid="repair-customer-name" /></div>
                <div className="space-y-1.5 col-span-2"><Label className="text-xs">Phone</Label><Input value={data.customer_phone || ""} readOnly={locked} disabled={locked} onChange={(e) => set("customer_phone", e.target.value)} data-testid="repair-customer-phone" /></div>
              </div>
            </Card>
            <Card className={`p-5 border-border card-hover ${locked ? "bg-muted/10" : ""}`}>
              <div className="flex items-center gap-2 mb-3">
                <Car className="h-4 w-4 text-primary" />
                <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Vehicle</div>
                {locked && <Lock className="h-3 w-3 ms-auto text-muted-foreground/70" />}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Make</Label><Input value={data.car_make || ""} readOnly={locked} disabled={locked} onChange={(e) => set("car_make", e.target.value)} data-testid="repair-car-make" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Model</Label><Input value={data.car_model || ""} readOnly={locked} disabled={locked} onChange={(e) => set("car_model", e.target.value)} data-testid="repair-car-model" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Year</Label><Input value={data.car_year || ""} readOnly={locked} disabled={locked} onChange={(e) => set("car_year", e.target.value)} data-testid="repair-car-year" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Plate</Label><Input value={data.car_plate || ""} readOnly={locked} disabled={locked} onChange={(e) => set("car_plate", e.target.value)} data-testid="repair-car-plate" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Color</Label><Input value={data.car_color || ""} readOnly={locked} disabled={locked} onChange={(e) => set("car_color", e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Odometer (km)</Label><Input value={data.car_km || ""} readOnly={locked} disabled={locked} onChange={(e) => set("car_km", e.target.value)} /></div>
              </div>
            </Card>
          </div>

          {/* Mechanic + status */}
          <Card className="p-5 border-border">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest font-mono text-muted-foreground">Mechanic</Label>
                <Select value={data.mechanic_id || "none"} onValueChange={(v) => set("mechanic_id", v === "none" ? "" : v)}>
                  <SelectTrigger data-testid="repair-mechanic-select"><SelectValue placeholder="Assign mechanic" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— unassigned —</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs uppercase tracking-widest font-mono text-muted-foreground">Status</Label>
                <Tabs value={data.status} onValueChange={(v) => set("status", v)}>
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="open" data-testid="repair-status-open">Open</TabsTrigger>
                    <TabsTrigger value="in_progress" data-testid="repair-status-progress">In progress</TabsTrigger>
                    <TabsTrigger value="completed" data-testid="repair-status-completed">Completed</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </Card>

          {/* Repair notes */}
          <Card className="p-5 border-border space-y-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Repair log</div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Customer complaint</Label><Textarea rows={2} value={data.complaint || ""} onChange={(e) => set("complaint", e.target.value)} data-testid="repair-complaint" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Diagnosis</Label><Textarea rows={2} value={data.diagnosis || ""} onChange={(e) => set("diagnosis", e.target.value)} data-testid="repair-diagnosis" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Work performed</Label><Textarea rows={3} value={data.work_done || ""} onChange={(e) => set("work_done", e.target.value)} data-testid="repair-work" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Labor charge (€)</Label><Input type="number" step="0.01" value={data.labor_charge || 0} onChange={(e) => set("labor_charge", e.target.value)} data-testid="repair-labor" />
                <p className="text-[10px] text-muted-foreground">{t("laborAuto")}</p>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Internal notes</Label><Input value={data.notes || ""} onChange={(e) => set("notes", e.target.value)} /></div>
            </div>
          </Card>

          {/* Labor time clock */}
          <TimeClockPanel card={data} setData={setData} settings={settings} refetch={refetch} />

          {/* Parts used */}
          <Card className="p-5 border-border">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" />
                <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Parts used</div>
              </div>
              <div className="font-mono text-sm">{(data.parts_used || []).length} lines · {formatEUR(data.parts_total)}</div>
            </div>
            <div className="grid grid-cols-[1fr_100px_auto] gap-2 mb-4">
              <SearchableSelect
                value={addItem}
                onChange={setAddItem}
                options={items.filter(i => i.quantity > 0).map(i => ({
                  value: i.id,
                  label: i.name,
                  secondary: `${i.sku} · ${i.quantity} in stock · ${formatEUR(i.selling_price)}`,
                }))}
                emptyLabel="— pick from stock —"
                searchPlaceholder="Search by name or SKU"
                placeholder="Pick a part from stock"
                testId="repair-part-select"
              />
              <Input type="number" min="1" value={addQty} onChange={(e) => setAddQty(e.target.value)} data-testid="repair-part-qty" />
              <Button onClick={addPart} className="rounded-full bg-primary" data-testid="repair-part-add"><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
            <div className="space-y-2">
              {(data.parts_used || []).length === 0 && <div className="text-sm text-muted-foreground text-center py-6">No parts used yet.</div>}
              {(data.parts_used || []).map(p => (
                <div key={p.txn_id} className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-border">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{p.sku}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm font-mono">{p.quantity} × {formatEUR(p.unit_price)}</div>
                      <div className="text-xs font-mono font-bold">{formatEUR(p.total)}</div>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removePart(p.txn_id)} data-testid={`repair-part-remove-${p.txn_id}`}>
                      <X className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Photos of the vehicle */}
          <Card className="p-5 border-border">
            <RepairPhotos repairId={data.id} photos={data.photos || []} onChange={(photos) => setData({ ...data, photos })} />
          </Card>

          {/* Special-order parts (not from stock) */}
          <SpecialPartsPanel card={data} setCard={setData} />

          {/* Totals with BTW / VAT breakdown */}
          <Card className="p-5 border-primary/30 bg-primary/5 space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("parts")}</div><div className="font-display text-2xl font-bold tabular-nums mt-1">{formatEUR(data.parts_total)}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("labor")}</div><div className="font-display text-2xl font-bold tabular-nums mt-1">{formatEUR(data.labor_charge)}</div></div>
              <div><div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("subtotal")}</div><div className="font-display text-2xl font-bold tabular-nums mt-1">{formatEUR(data.grand_total)}</div></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end pt-3 border-t border-primary/20">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{t("taxRate")}</Label>
                <Input
                  type="number" step="0.1" min="0" max="100"
                  value={data.tax_rate ?? settings?.default_tax_rate ?? 21}
                  onChange={(e) => set("tax_rate", Number(e.target.value))}
                  data-testid="repair-tax-rate"
                />
              </div>
              <div className="text-center">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("btw")}</div>
                <div className="font-display text-xl font-bold tabular-nums mt-1" data-testid="repair-tax-amount">{formatEUR(data.tax_amount || 0)}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("totalWithTax")}</div>
                <div className="font-display text-3xl font-bold tabular-nums mt-1 text-primary" data-testid="repair-total-with-tax">{formatEUR(data.total_with_tax || data.grand_total)}</div>
              </div>
            </div>
          </Card>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
          <Button variant="outline" className="rounded-full" onClick={() => printRepairCard(data, settings, meta.dir, repairLabels(t))} data-testid="repair-print-button">
            <Printer className="h-4 w-4 mr-2" /> {t("printCard")}
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => downloadRepairCardPdf(data, settings, meta.dir, repairLabels(t))} data-testid="repair-pdf-button">
            <FileDown className="h-4 w-4 mr-2" /> {t("pdf")}
          </Button>
          <Button variant="outline" className="rounded-full text-emerald-700 dark:text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10" onClick={() => whatsappShare({
              phone: data.customer_phone, garageName: settings?.name,
              header: `Job card ${data.card_number}`,
              lines: [`${[data.car_make, data.car_model, data.car_year].filter(Boolean).join(" ")} · ${data.car_plate || ""}`,
                      ...(data.parts_used || []).map(p => `• ${p.name} × ${p.quantity} — ${p.total.toFixed(2)}€`),
                      data.labor_charge ? `• Labor — ${Number(data.labor_charge).toFixed(2)}€` : ""],
              total: data.grand_total,
            })} data-testid="repair-whatsapp-button">
            <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp
          </Button>
          {!data.invoice_id && <Button variant="outline" className="rounded-full" onClick={invoice} data-testid="repair-invoice-button"><FileText className="h-4 w-4 mr-2" /> {t("createInvoice")}</Button>}
          <Button onClick={saveField} disabled={saving} className="rounded-full bg-primary hover:bg-primary/90" data-testid="repair-save-button">
            <CheckCircle2 className="h-4 w-4 mr-2" /> {saving ? t("loading") : t("saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Repairs() {
  const qc = useQueryClient();
  const { t, meta } = useLang();
  const [showNew, setShowNew] = useState(false);
  const [openCardId, setOpenCardId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState({
    customer_id: "", customer_name: "", customer_phone: "",
    car_make: "", car_model: "", car_year: "", car_plate: "", car_color: "", car_km: "",
    mechanic_id: "", complaint: "", notes: "",
  });

  const { data: cards = [], refetch } = useQuery({ queryKey: ["repairs"], queryFn: () => api.get("/repairs").then(r => r.data) });
  const { user: me } = useAuth();
  const { data: users = [] } = useQuery({
    queryKey: ["users-safe"],
    enabled: me?.role === "owner",
    queryFn: () => api.get("/users").then(r => r.data).catch(() => []),
  });
  const { data: customers = [] } = useQuery({ queryKey: ["cus"], queryFn: () => api.get("/customers").then(r => r.data) });
  const { data: items = [] } = useQuery({ queryKey: ["inv"], queryFn: () => api.get("/inventory").then(r => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });

  const filtered = filter === "all" ? cards : cards.filter(c => c.status === filter);

  const create = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/repairs", {
        ...form,
        customer_id: form.customer_id || null,
        mechanic_id: form.mechanic_id || null,
      });
      toast.success(`Card ${data.card_number} created`);
      setShowNew(false);
      setForm({ customer_id: "", customer_name: "", customer_phone: "", car_make: "", car_model: "", car_year: "", car_plate: "", car_color: "", car_km: "", mechanic_id: "", complaint: "", notes: "" });
      qc.invalidateQueries();
      setOpenCardId(data.id);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete card? Any used parts will be restocked.")) return;
    try { await api.delete(`/repairs/${id}`); toast.success("Deleted"); qc.invalidateQueries(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const openCard = cards.find(c => c.id === openCardId);

  const exportReport = async (mode) => {
    const args = {
      title: t("jobCards"),
      subtitle: `${filtered.length} ${t("items")}`,
      headers: [t("poNumber") || "#", t("vehicle"), t("customer"), t("mechanic"), t("status"), t("total")],
      rows: filtered.map(c => [
        c.card_number,
        `${[c.car_make, c.car_model, c.car_year].filter(Boolean).join(" ")} · ${c.car_plate || "—"}`,
        c.customer_name || "—",
        c.mechanic_name || "—",
        STATUS_LABEL[c.status] || c.status,
        formatEUR(c.grand_total),
      ]),
      settings, dir: meta.dir, lang: meta.locale?.slice(0, 2),
    };
    if (mode === "pdf") {
      setExporting(true);
      try { await downloadListReportPdf(args); } finally { setExporting(false); }
    } else printListReport(args);
  };

  return (
    <div className="space-y-8" data-testid="repairs-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("workshopFloor")}</div>
          <h1 className="font-display text-4xl font-black tracking-tight">{t("jobCards")}</h1>
          <p className="text-muted-foreground mt-2">{t("repairsTagline")}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList>
              <TabsTrigger value="all" data-testid="repair-filter-all">{t("allCards")}</TabsTrigger>
              <TabsTrigger value="open">{t("open")}</TabsTrigger>
              <TabsTrigger value="in_progress">{t("inProgress")}</TabsTrigger>
              <TabsTrigger value="completed">{t("completed")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" className="rounded-full" onClick={() => exportReport("print")} data-testid="repairs-print-button">
            <Printer className="h-4 w-4 mr-2" /> {t("print")}
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => exportReport("pdf")} disabled={exporting} data-testid="repairs-pdf-button">
            <FileDown className="h-4 w-4 mr-2" /> {exporting ? t("loading") : t("pdf")}
          </Button>
          <Button className="rounded-full bg-primary hover:bg-primary/90" onClick={() => setShowNew(true)} data-testid="repair-new-button">
            <Plus className="h-4 w-4 mr-2" /> {t("newCard")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(c => (
          <Card key={c.id} className="group p-5 border-border card-hover cursor-pointer relative overflow-hidden" onClick={() => setOpenCardId(c.id)} data-testid={`repair-card-${c.card_number}`}>
            <div className="absolute top-0 left-0 right-0 h-10 bg-secondary flex items-center justify-between px-4 border-b border-primary/20">
              <img src={settings?.logo_url || "/logo-shawish.png"} alt="" className="h-6 w-auto object-contain opacity-90" />
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-primary">{c.card_number}</span>
            </div>
            <div className="mt-8 flex items-start justify-between mb-4">
              <div>
                <div className="font-display text-xl font-bold mt-1">{[c.car_make, c.car_model].filter(Boolean).join(" ") || "Vehicle TBD"}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {c.car_year && <span className="text-xs font-mono text-muted-foreground">{c.car_year}</span>}
                  <PlateBadge plate={c.car_plate} size="xs" />
                </div>
              </div>
              <Badge className={STATUS_STYLE[c.status] + " capitalize whitespace-nowrap"}>{STATUS_LABEL[c.status]}</Badge>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                <span className="truncate">{c.customer_name || "Walk-in"}{c.customer_phone && ` · ${c.customer_phone}`}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Wrench className="h-3.5 w-3.5" />
                <span>{c.mechanic_name || "Unassigned"}</span>
              </div>
              {c.car_km && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Gauge className="h-3.5 w-3.5" />
                  <span>{c.car_km} km</span>
                </div>
              )}
            </div>

            {c.complaint && <p className="text-xs text-muted-foreground mt-3 line-clamp-2">"{c.complaint}"</p>}

            <div className="mt-4 pt-4 border-t border-border flex justify-between items-end">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Parts</div>
                <div className="text-sm font-mono">{(c.parts_used || []).length}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Total</div>
                <div className="font-display text-lg font-bold tabular-nums text-primary">{formatEUR(c.grand_total)}</div>
              </div>
            </div>

            <Button size="icon" variant="ghost" className="absolute bottom-3 right-3 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity duration-200" onClick={(e) => { e.stopPropagation(); del(c.id); }} data-testid={`repair-delete-${c.card_number}`}>
              <Trash2 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            </Button>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center py-20 border border-dashed border-border rounded-lg">
            <Wrench className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No {filter === "all" ? "" : STATUS_LABEL[filter]?.toLowerCase() + " "}job cards yet.</p>
          </div>
        )}
      </div>

      {/* New card dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">New job card</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Customer (existing or new)</Label>
              <SearchableSelect
                value={form.customer_id}
                onChange={(v) => setForm({ ...form, customer_id: v })}
                options={customers.map(c => ({ value: c.id, label: c.name, secondary: c.phone }))}
                emptyLabel="— walk-in / enter manually —"
                searchPlaceholder="Search customer by name or phone"
                placeholder="Pick or leave blank"
                testId="new-repair-customer-select"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Customer name</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} data-testid="new-repair-name" /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} data-testid="new-repair-phone" /></div>
              <div className="space-y-1.5"><Label>Car make</Label><Input value={form.car_make} onChange={(e) => setForm({ ...form, car_make: e.target.value })} placeholder="e.g. VW" data-testid="new-repair-make" /></div>
              <div className="space-y-1.5"><Label>Car model</Label><Input value={form.car_model} onChange={(e) => setForm({ ...form, car_model: e.target.value })} placeholder="e.g. Golf" data-testid="new-repair-model" /></div>
              <div className="space-y-1.5"><Label>Year</Label><Input value={form.car_year} onChange={(e) => setForm({ ...form, car_year: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Plate</Label><Input value={form.car_plate} onChange={(e) => setForm({ ...form, car_plate: e.target.value })} data-testid="new-repair-plate" /></div>
              <div className="space-y-1.5"><Label>Color</Label><Input value={form.car_color} onChange={(e) => setForm({ ...form, car_color: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Odometer (km)</Label><Input value={form.car_km} onChange={(e) => setForm({ ...form, car_km: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Mechanic</Label>
              <Select value={form.mechanic_id || "none"} onValueChange={(v) => setForm({ ...form, mechanic_id: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="new-repair-mechanic-select"><SelectValue placeholder="Assign later if needed" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— unassigned —</SelectItem>
                  {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Customer complaint</Label><Textarea rows={3} value={form.complaint} onChange={(e) => setForm({ ...form, complaint: e.target.value })} placeholder="e.g. Brake pedal soft, pulls to the right..." data-testid="new-repair-complaint" /></div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button type="submit" className="rounded-full bg-primary" data-testid="new-repair-submit">Open card</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {openCard && (
        <CardEditor
          card={openCard}
          onClose={() => setOpenCardId(null)}
          users={users}
          customers={customers}
          items={items}
          settings={settings}
          refetch={refetch}
        />
      )}
    </div>
  );
}
