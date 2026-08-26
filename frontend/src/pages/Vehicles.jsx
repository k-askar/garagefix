import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Car, Wrench, Phone, Mail, User, ClipboardList, X, Calendar as CalIcon, FileText, ShieldAlert, ShieldCheck as ShieldOk, QrCode, Send, Loader2 } from "lucide-react";
import { useLang } from "@/i18n";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import CarPassportQrDialog from "@/components/CarPassportQrDialog";

const STATUS_TONE = {
  completed:   "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
  open:        "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/40",
};

export default function Vehicles() {
  const { t } = useLang();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);
  const [qrVehicle, setQrVehicle] = useState(null);
  // Which vehicle we're currently emailing — used for the row-level spinner.
  const [sendingApk, setSendingApk] = useState(null);
  // "all" | "apk_due" — quick filter to show only vehicles whose APK expires soon.
  const [apkFilter, setApkFilter] = useState("all");

  /** Send a Dutch APK reminder email to the vehicle owner. */
  const sendApkReminder = async (v) => {
    if (!v.owner_email) return toast.error(t("apkNoOwnerEmail") || "Owner has no email on file");
    setSendingApk(v.id);
    try {
      const { data } = await api.post(`/vehicles/${v.id}/apk-reminder`);
      toast.success(t("apkReminderSent", { email: data.to }) || `APK reminder sent to ${data.to}`);
      qc.invalidateQueries({ queryKey: ["vehicles-list"] });
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSendingApk(null);
    }
  };

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles-list"],
    queryFn: () => api.get("/vehicles").then(r => r.data),
  });

  /** Classify APK status. `null` = unknown, `expired` = past due, `soon` = ≤30 days,
   *  `warn` = ≤90 days, `ok` otherwise.  Used for badge colour + stat card. */
  const apkStatus = (days) => {
    if (days === null || days === undefined) return "unknown";
    if (days < 0) return "expired";
    if (days <= 30) return "soon";
    if (days <= 90) return "warn";
    return "ok";
  };

  const filtered = useMemo(() => {
    let list = vehicles;
    if (apkFilter === "apk_due") {
      // Include both expired + ≤30 days so the operator gets one call-list.
      list = list.filter(v => v.apk_days !== null && v.apk_days !== undefined && v.apk_days <= 30);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(v => [
        v.plate, v.vin, v.make, v.model,
        v.owner_name, v.owner_email, v.owner_phone,
        String(v.year || ""),
      ].some(s => (s || "").toString().toLowerCase().includes(q)));
    }
    return list;
  }, [vehicles, search, apkFilter]);

  const totals = {
    all: vehicles.length,
    withRepairs: vehicles.filter(v => (v.repair_count || 0) > 0).length,
    active: vehicles.filter(v => v.last_repair && v.last_repair.status !== "completed").length,
    apkDue: vehicles.filter(v => v.apk_days !== null && v.apk_days !== undefined && v.apk_days <= 30).length,
  };

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ["vehicle-history", detail?.id],
    queryFn: () => api.get(`/vehicles/${detail.id}/history`).then(r => r.data),
    enabled: !!detail,
  });

  const { data: allRepairs = [] } = useQuery({
    queryKey: ["vehicle-repairs", detail?.id],
    queryFn: () => api.get(`/repairs`).then(r => r.data.filter(x => x.vehicle_id === detail.id)),
    enabled: !!detail,
  });

  return (
    <div className="space-y-6" data-testid="vehicles-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2 flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5" /> {t("garageFleet") || "Garage fleet"}
          </div>
          <h1 className="font-display text-4xl font-black tracking-tight">{t("vehiclesTitle") || "Vehicles"}</h1>
          <p className="text-muted-foreground mt-2">
            {t("vehiclesSub") || "Every car that ever entered the workshop. Search by plate, VIN, model, or owner."}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-center min-w-[110px]">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("totalCars") || "Total"}</div>
            <div className="text-2xl font-bold font-display" data-testid="vehicles-total">{totals.all}</div>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 text-center min-w-[110px]">
            <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{t("serviced") || "Serviced"}</div>
            <div className="text-2xl font-bold font-display text-emerald-700 dark:text-emerald-400">{totals.withRepairs}</div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-center min-w-[110px]">
            <div className="text-[10px] font-mono uppercase tracking-widest text-amber-700 dark:text-amber-400">{t("inWorkshop") || "In workshop"}</div>
            <div className="text-2xl font-bold font-display text-amber-700 dark:text-amber-400">{totals.active}</div>
          </div>
          <button
            onClick={() => setApkFilter(apkFilter === "apk_due" ? "all" : "apk_due")}
            className={`rounded-lg border px-4 py-2 text-center min-w-[110px] transition-colors ${
              apkFilter === "apk_due"
                ? "border-rose-500 bg-rose-500/20 ring-2 ring-rose-500/30"
                : totals.apkDue > 0
                  ? "border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 cursor-pointer"
                  : "border-border bg-muted/20"
            }`}
            data-testid="vehicles-apk-filter"
            title={t("filterApkDue") || "Toggle APK-due filter"}
          >
            <div className={`text-[10px] font-mono uppercase tracking-widest flex items-center justify-center gap-1 ${totals.apkDue > 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`}>
              <ShieldAlert className="h-3 w-3" /> {t("apkDue") || "APK due"}
            </div>
            <div className={`text-2xl font-bold font-display ${totals.apkDue > 0 ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`} data-testid="vehicles-apk-count">
              {totals.apkDue}
            </div>
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative max-w-2xl">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("vehicleSearchPlaceholder") || "Search plate, VIN, make, model, owner…"}
          className="pl-10 pr-10 rounded-full"
          data-testid="vehicles-search"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full hover:bg-accent flex items-center justify-center"
            data-testid="vehicles-search-clear"
          ><X className="h-3.5 w-3.5" /></button>
        )}
      </div>

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("plate") || "Plate"}</TableHead>
              <TableHead>{t("vehicle") || "Vehicle"}</TableHead>
              <TableHead>{t("owner") || "Owner"}</TableHead>
              <TableHead className="text-center">{t("visits") || "Visits"}</TableHead>
              <TableHead>{t("apk") || "APK"}</TableHead>
              <TableHead>{t("lastRepair") || "Last repair"}</TableHead>
              <TableHead className="text-right">{t("actionsLabel")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{t("loading") || "Loading…"}</TableCell></TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16 text-muted-foreground" data-testid="vehicles-empty">
                  {vehicles.length === 0
                    ? (t("noVehiclesInGarage") || "No vehicles yet — add a customer and their car from the Customers page.")
                    : apkFilter === "apk_due"
                      ? (t("noVehiclesApkDue") || "No vehicles with APK due soon — everyone's road-legal.")
                      : (t("noVehiclesMatch") || "No vehicle matches your search.")}
                </TableCell>
              </TableRow>
            )}
            {filtered.map(v => {
              const status = apkStatus(v.apk_days);
              return (
              <TableRow key={v.id} className="cursor-pointer" onClick={() => setDetail(v)} data-testid={`vehicle-row-${v.plate || v.id}`}>
                <TableCell>
                  <div className="font-mono text-sm font-bold text-primary uppercase">{v.plate || "—"}</div>
                  {v.vin && <div className="font-mono text-[10px] text-muted-foreground">{v.vin}</div>}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Car className="h-3.5 w-3.5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{v.make} {v.model}</div>
                      <div className="text-xs text-muted-foreground">{v.year || ""}{v.color ? ` · ${v.color}` : ""}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium flex items-center gap-1.5"><User className="h-3 w-3 text-muted-foreground" />{v.owner_name || "—"}</div>
                  <div className="text-xs text-muted-foreground flex flex-col">
                    {v.owner_phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{v.owner_phone}</span>}
                    {v.owner_email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{v.owner_email}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="font-mono">
                    <Wrench className="h-3 w-3 mr-1" /> {v.repair_count || 0}
                  </Badge>
                </TableCell>
                <TableCell data-testid={`vehicle-apk-${v.plate || v.id}`}>
                  {status === "unknown" ? (
                    <span className="text-[11px] text-muted-foreground italic">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col gap-0.5">
                        <Badge className={
                          status === "expired" ? "bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-500/50 hover:bg-rose-500/20 animate-pulse"
                          : status === "soon" ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40 hover:bg-rose-500/15"
                          : status === "warn" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/15"
                          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15"
                        }>
                          {status === "expired" || status === "soon" ? <ShieldAlert className="h-3 w-3 mr-1" /> : <ShieldOk className="h-3 w-3 mr-1" />}
                          {status === "expired"
                            ? `${t("expired") || "Expired"} · ${Math.abs(v.apk_days)}d`
                            : `${v.apk_days}d`}
                        </Badge>
                        <span className="font-mono text-[10px] text-muted-foreground">{v.apk_expiry}</span>
                      </div>
                      {/* Send-reminder button — only meaningful when APK is
                          expired or ≤30d and the owner has an email. */}
                      {(status === "expired" || status === "soon") && v.owner_email && (
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 rounded-full border-rose-500/50 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 shrink-0"
                          disabled={sendingApk === v.id}
                          onClick={(e) => { e.stopPropagation(); sendApkReminder(v); }}
                          title={
                            v.apk_reminder_sent_at
                              ? (t("apkReminderResend") || "Resend APK reminder")
                              : (t("apkReminderSend") || "Send APK reminder")
                          }
                          data-testid={`vehicle-apk-remind-${v.plate || v.id}`}
                        >
                          {sendingApk === v.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Send className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {v.last_repair ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-primary">{v.last_repair.card_number}</span>
                        <Badge className={STATUS_TONE[v.last_repair.status] || STATUS_TONE.open}>
                          {v.last_repair.status === "completed" ? (t("completed") || "Completed")
                            : v.last_repair.status === "in_progress" ? (t("inProgress") || "In progress")
                            : (t("statusOpen") || "Open")}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[220px]" title={v.last_repair.complaint}>
                        {v.last_repair.complaint || "—"}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {new Date(v.last_repair.created_at).toLocaleDateString("en-GB")} · {formatEUR(v.last_repair.grand_total || 0)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">{t("noRepairsYet") || "No repairs yet"}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); setQrVehicle(v); }}
                      title={t("printQrSticker") || "Print QR sticker"}
                      data-testid={`vehicle-qr-${v.plate || v.id}`}
                    >
                      <QrCode className="h-4 w-4 text-primary" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={(e) => { e.stopPropagation(); setDetail(v); }}
                      data-testid={`vehicle-open-${v.plate || v.id}`}
                    >
                      <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> {t("timeline") || "Timeline"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Detail dialog — everything ever done to this vehicle */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="vehicle-detail-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Car className="h-5 w-5 text-primary" />
              {detail?.make} {detail?.model} <span className="font-mono text-primary">· {detail?.plate}</span>
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              {/* Owner + basic info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3 bg-muted/20">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{t("owner") || "Owner"}</div>
                  <div className="font-semibold">{detail.owner_name || "—"}</div>
                  {detail.owner_phone && <div className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{detail.owner_phone}</div>}
                  {detail.owner_email && <div className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{detail.owner_email}</div>}
                </div>
                <div className="rounded-lg border border-border p-3 bg-muted/20">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">{t("vehicle") || "Vehicle"}</div>
                  <div className="font-semibold">{detail.year || ""} {detail.make} {detail.model}</div>
                  <div className="text-xs text-muted-foreground">
                    {detail.color && <span>{detail.color} · </span>}
                    {detail.fuel_type || ""}
                  </div>
                  {detail.vin && <div className="text-[10px] font-mono text-muted-foreground mt-1">VIN {detail.vin}</div>}
                </div>
                <div className="rounded-lg border border-primary/30 p-3 bg-primary/5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-primary/80 mb-1">{t("summary") || "Summary"}</div>
                  <div className="text-2xl font-bold font-display text-primary">{detail.repair_count || 0}</div>
                  <div className="text-xs text-primary/80">{t("totalVisits") || "total visits"}</div>
                </div>
              </div>

              {/* Full repair history */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <ClipboardList className="h-4 w-4 text-primary" />
                    {t("repairHistory") || "Repair history"}
                    <span className="text-xs font-mono text-muted-foreground">· {allRepairs.length}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full text-primary border-primary/40 hover:bg-primary/10"
                    onClick={() => { setQrVehicle(detail); }}
                    data-testid="vehicle-detail-qr"
                  >
                    <QrCode className="h-3.5 w-3.5 mr-1.5" /> {t("qrSticker") || "QR sticker"}
                  </Button>
                </div>
                {allRepairs.length === 0 && (
                  <div className="text-sm text-muted-foreground p-4 text-center border-2 border-dashed border-border rounded-lg">
                    {t("noRepairsYet") || "No repairs yet"}
                  </div>
                )}
                <div className="space-y-2">
                  {allRepairs.map(r => (
                    <Card key={r.id} className="p-3 border-border hover:border-primary/40 transition-colors cursor-pointer" onClick={() => nav(`/repairs?card=${r.id}`)} data-testid={`vehicle-detail-repair-${r.card_number}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-primary">{r.card_number}</span>
                            <Badge className={STATUS_TONE[r.status] || STATUS_TONE.open}>
                              {r.status === "completed" ? (t("completed") || "Completed")
                                : r.status === "in_progress" ? (t("inProgress") || "In progress")
                                : (t("statusOpen") || "Open")}
                            </Badge>
                            {r.invoice_id && (
                              <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30">
                                <FileText className="h-3 w-3 mr-1" /> {t("invoiced") || "Invoiced"}
                              </Badge>
                            )}
                          </div>
                          {r.complaint && <div className="text-sm mt-1 line-clamp-2 italic">"{r.complaint}"</div>}
                          <div className="text-[10px] font-mono text-muted-foreground mt-1 flex items-center gap-3">
                            <span className="flex items-center gap-1"><CalIcon className="h-3 w-3" />{new Date(r.created_at).toLocaleDateString("en-GB")}</span>
                            {r.mechanic_name && <span>{r.mechanic_name}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold font-mono">{formatEUR(r.grand_total || r.total || 0)}</div>
                          <div className="text-[10px] text-muted-foreground">{(r.parts_used || []).length} {t("parts") || "parts"}</div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Service events timeline (APK / oil / etc.) */}
              {history?.events?.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 font-semibold">
                    <Wrench className="h-4 w-4 text-primary" />
                    {t("serviceEvents") || "Service events"}
                  </div>
                  <div className="space-y-1.5">
                    {history.events.map((ev, i) => (
                      <div key={i} className="p-2 rounded-md bg-muted/40 border border-border text-sm flex items-center justify-between">
                        <div>
                          <span className="font-mono text-xs uppercase text-primary">{ev.type}</span>
                          <span className="ml-2 text-muted-foreground">{ev.note || ""}</span>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">{new Date(ev.at).toLocaleDateString("en-GB")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Reusable QR passport dialog — mints a public sticker link that opens
          the customer-facing service timeline when scanned from any phone. */}
      <CarPassportQrDialog
        vehicle={qrVehicle}
        open={!!qrVehicle}
        onOpenChange={(v) => { if (!v) setQrVehicle(null); }}
      />
    </div>
  );
}
