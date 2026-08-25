import React, { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, formatEUR } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Car, User, Wrench, Trash2, FileText, ArrowRight, AlertTriangle, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import SearchableSelect from "@/components/SearchableSelect";
import AddressFields from "@/components/AddressFields";
import VehicleMakeModelYear from "@/components/VehicleMakeModelYear";

const STATUS_STYLE = {
  scheduled: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  confirmed: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-500/30",
  in_service: "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  cancelled: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
};

function monthDays(year, month) {
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // Monday=0
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}
const iso = (d) => d.toISOString().slice(0, 10);
const isoLocal = (d) => {
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
};

export default function CalendarPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { t, meta } = useLang();
  const { user: me } = useAuth();
  const isOwner = me?.role === "owner";

  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [showNew, setShowNew] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [showNewVehicle, setShowNewVehicle] = useState(false);
  const EMPTY_NEW_CUST = { name: "", phone: "", email: "", address: "", postcode: "", house_number: "", house_number_addition: "", street: "", city: "", address_country: "NL", customer_type: "individual", company_name: "", kvk_number: "", vat_number: "", contact_person: "" };
  const EMPTY_NEW_VEH = { make: "", model: "", year: "", plate: "", color: "", km: "", country: "NL", apk_expiry: "", next_oil_change_km: "", vin: "", notes: "", meldcode: "", fuel: "", cc: "", doors: "", seats: "", weight: "", chassis_location: "", registration_date: "" };
  const [newCustomer, setNewCustomer] = useState(EMPTY_NEW_CUST);
  const [newVehicle, setNewVehicle] = useState(EMPTY_NEW_VEH);
  const [kvkBusy, setKvkBusy] = useState(false);
  const [rdwBusy, setRdwBusy] = useState(false);

  /* KvK auto-fill for the "New customer" mini-dialog. */
  const kvkLookup = async () => {
    const cleaned = (newCustomer.kvk_number || "").replace(/[^0-9]/g, "");
    if (cleaned.length !== 8) return toast.error("KvK = 8 cijfers");
    setKvkBusy(true);
    try {
      const { data } = await api.get(`/kvk/lookup?kvk=${cleaned}`);
      setNewCustomer(f => ({
        ...f,
        name: data.company_name || f.name,
        company_name: data.company_name || f.company_name,
        kvk_number: data.kvk_number,
        vat_number: data.vat_number || f.vat_number,
        street: data.street || f.street,
        house_number: data.house_number || f.house_number,
        house_number_addition: data.house_number_addition || f.house_number_addition,
        postcode: data.postcode || f.postcode,
        city: data.city || f.city,
        address_country: data.address_country || f.address_country,
      }));
      toast.success(`${data.company_name} · KvK ✓`);
    } catch (e) {
      const isConfigMissing = e?.response?.status === 501;
      toast.error(e?.response?.data?.detail || "KvK lookup failed",
        isConfigMissing ? { duration: 10000, description: "Je kunt de gegevens ondertussen handmatig invullen." } : {});
    } finally { setKvkBusy(false); }
  };

  /* RDW auto-fill for the "New vehicle" mini-dialog. */
  const rdwLookup = async () => {
    if (newVehicle.country !== "NL") return toast.error("RDW = NL only");
    const cleaned = (newVehicle.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cleaned || cleaned.length < 4) return toast.error(t("rdwEnterPlate"));
    setRdwBusy(true);
    try {
      const { data } = await api.get(`/rdw/lookup?plate=${encodeURIComponent(cleaned)}`);
      setNewVehicle(v => ({
        ...v,
        plate: data.plate || v.plate,
        make: data.make || v.make,
        model: data.model || v.model,
        year: data.year || v.year,
        color: data.color || v.color,
        country: data.country || v.country,
        apk_expiry: data.apk_expiry || v.apk_expiry,
        fuel: data.fuel || v.fuel,
        cc: data.cc || v.cc,
        doors: data.doors || v.doors,
        seats: data.seats || v.seats,
        weight: data.weight || v.weight,
        chassis_location: data.chassis_location || v.chassis_location,
        registration_date: data.registration_date || v.registration_date,
      }));
      toast.success(`${data.make} ${data.model} ${data.year}`.trim() + " · RDW ✓");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "RDW lookup failed");
    } finally { setRdwBusy(false); }
  };
  const [form, setForm] = useState({
    customer_id: "", vehicle_id: "", mechanic_id: "",
    scheduled_at: isoLocal(new Date(Date.now() + 60 * 60 * 1000)),
    duration_min: 60, service_type: "", notes: "",
  });
  const [conflicts, setConflicts] = useState([]);
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startISO = new Date(year, month, 1).toISOString();
  const endISO = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

  const { data: appts = [] } = useQuery({
    queryKey: ["appts", startISO, endISO],
    queryFn: () => api.get(`/appointments?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`).then(r => r.data),
  });
  const { data: customers = [] } = useQuery({ queryKey: ["cus"], queryFn: () => api.get("/customers").then(r => r.data) });
  const { data: users = [] } = useQuery({ queryKey: ["users-safe"], enabled: isOwner, queryFn: () => api.get("/users").then(r => r.data).catch(() => []) });
  const { data: vehicles = [] } = useQuery({
    queryKey: ["cust-vehicles", form.customer_id],
    enabled: !!form.customer_id,
    queryFn: () => api.get(`/customers/${form.customer_id}/vehicles`).then(r => r.data),
  });

  const days = useMemo(() => monthDays(year, month), [year, month]);
  const apptByDay = useMemo(() => {
    const map = {};
    for (const a of appts) {
      const k = a.scheduled_at.slice(0, 10);
      (map[k] = map[k] || []).push(a);
    }
    return map;
  }, [appts]);

  const selectedKey = iso(selectedDay);
  const dayAppts = (apptByDay[selectedKey] || []).slice().sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const jumpMonth = (delta) => {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + delta);
    setCursor(d);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.scheduled_at) return toast.error(t("pickDateTime"));
    if (conflicts.length > 0 && !window.confirm(t("apptConflictConfirm", { n: conflicts.length }))) return;
    try {
      await api.post("/appointments", {
        customer_id: form.customer_id || null,
        vehicle_id: form.vehicle_id || null,
        mechanic_id: form.mechanic_id || null,
        scheduled_at: new Date(form.scheduled_at).toISOString(),
        duration_min: Number(form.duration_min) || 60,
        service_type: form.service_type || "General service",
        notes: form.notes || "",
      });
      toast.success(t("appointmentCreated"));
      setShowNew(false);
      setConflicts([]);
      setForm({ customer_id: "", vehicle_id: "", mechanic_id: "", scheduled_at: isoLocal(new Date()), duration_min: 60, service_type: "", notes: "" });
      qc.invalidateQueries();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  /* Check conflicts whenever mechanic / date / duration changes in the dialog */
  useEffect(() => {
    if (!showNew || !form.mechanic_id || !form.scheduled_at) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    setCheckingConflicts(true);
    const iso = new Date(form.scheduled_at).toISOString();
    const params = new URLSearchParams({
      mechanic_id: form.mechanic_id,
      start: iso,
      duration_min: String(Number(form.duration_min) || 60),
    });
    api.get(`/appointments/conflicts?${params.toString()}`)
      .then(r => { if (!cancelled) setConflicts(r.data?.conflicts || []); })
      .catch(() => { if (!cancelled) setConflicts([]); })
      .finally(() => { if (!cancelled) setCheckingConflicts(false); });
    return () => { cancelled = true; };
  }, [showNew, form.mechanic_id, form.scheduled_at, form.duration_min]);

  const del = async (id) => {
    if (!window.confirm(t("deleteAppointmentConfirm"))) return;
    try { await api.delete(`/appointments/${id}`); toast.success(t("deleted")); qc.invalidateQueries(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const convert = async (a) => {
    try {
      const { data: card } = await api.post(`/appointments/${a.id}/convert`);
      toast.success(t("cardCreated") + " · " + card.card_number, {
        action: { label: t("openCard"), onClick: () => nav("/repairs") },
      });
      qc.invalidateQueries();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const openNewOnDay = (d) => {
    const dt = new Date(d);
    dt.setHours(9, 0, 0, 0);
    setForm(f => ({ ...f, scheduled_at: isoLocal(dt) }));
    setShowNew(true);
  };

  const createCustomer = async (e) => {
    e.preventDefault();
    const nameField = newCustomer.customer_type === "company" ? newCustomer.company_name : newCustomer.name;
    if (!nameField?.trim()) return toast.error(newCustomer.customer_type === "company" ? "Bedrijfsnaam is verplicht" : t("nameRequired"));
    try {
      const payload = { ...newCustomer, name: nameField };
      const { data } = await api.post("/customers", payload);
      toast.success(t("customerAdded"));
      await qc.invalidateQueries({ queryKey: ["cus"] });
      setForm(f => ({ ...f, customer_id: data.id, vehicle_id: "" }));
      setNewCustomer(EMPTY_NEW_CUST);
      setShowNewCustomer(false);
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const createVehicle = async (e) => {
    e.preventDefault();
    if (!form.customer_id) return toast.error(t("pickCustomerFirst"));
    if (!newVehicle.make && !newVehicle.plate) return toast.error(t("nameRequired"));
    try {
      const { data } = await api.post(`/customers/${form.customer_id}/vehicles`, newVehicle);
      toast.success(t("vehicleAdded"));
      await qc.invalidateQueries({ queryKey: ["cust-vehicles", form.customer_id] });
      setForm(f => ({ ...f, vehicle_id: data.id }));
      setNewVehicle(EMPTY_NEW_VEH);
      setShowNewVehicle(false);
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const monthLabel = cursor.toLocaleDateString(meta.locale, { month: "long", year: "numeric" });
  const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const isRTL = meta.dir === "rtl";

  return (
    <div className="space-y-6" data-testid="calendar-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("scheduling")}</div>
          <h1 className="font-display text-4xl font-black tracking-tight">{t("calendar")}</h1>
          <p className="text-muted-foreground mt-2">{t("calendarSub", { n: appts.length })}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Button variant="outline" size="icon" className="rounded-full" onClick={() => jumpMonth(-1)} data-testid="cal-prev"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="font-display text-xl font-bold min-w-[180px] text-center capitalize">{monthLabel}</div>
          <Button variant="outline" size="icon" className="rounded-full" onClick={() => jumpMonth(1)} data-testid="cal-next"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" className="rounded-full" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); setSelectedDay(new Date()); }}>{t("today")}</Button>
          <Button className="rounded-full bg-primary hover:bg-primary/90" onClick={() => setShowNew(true)} data-testid="cal-new">
            <Plus className="h-4 w-4 mr-2" /> {t("newAppointment")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Calendar grid */}
        <Card className="p-4 border-border">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekdays.map(w => (
              <div key={w} className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground text-center py-2">{t("dow_" + w)}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              if (!d) return <div key={i} className="min-h-[100px]" />;
              const k = iso(d);
              const items = apptByDay[k] || [];
              const isToday = k === iso(new Date());
              const isSel = k === iso(selectedDay);
              return (
                <div key={i}
                     onClick={() => setSelectedDay(d)}
                     onDoubleClick={() => openNewOnDay(d)}
                     className={`min-h-[100px] p-1.5 rounded-md border cursor-pointer transition-colors ${isSel ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                     data-testid={`cal-day-${k}`}>
                  <div className={`flex items-center justify-between mb-1`}>
                    <span className={`text-xs font-mono ${isToday ? "text-primary font-bold" : "text-muted-foreground"}`}>{d.getDate()}</span>
                    {items.length > 0 && <Badge className="text-[9px] px-1.5 py-0 h-4 font-mono">{items.length}</Badge>}
                  </div>
                  <div className="space-y-0.5">
                    {items.slice(0, 3).map(a => (
                      <div key={a.id} className={`text-[10px] px-1 py-0.5 rounded truncate ${STATUS_STYLE[a.status] || ""}`} title={`${a.scheduled_at.slice(11, 16)} · ${a.customer_name || t("walkIn")}`}>
                        <span className="font-mono">{a.scheduled_at.slice(11, 16)}</span> {a.customer_name || a.service_type}
                      </div>
                    ))}
                    {items.length > 3 && <div className="text-[10px] text-muted-foreground text-center">+{items.length - 3}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Side panel */}
        <Card className="p-4 border-border">
          <div className="mb-4 pb-3 border-b border-border">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("selectedDay")}</div>
            <div className="font-display text-xl font-bold">{selectedDay.toLocaleDateString(meta.locale, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div>
            <div className="text-xs text-muted-foreground mt-1">{dayAppts.length} {t("appointments")}</div>
          </div>
          <div className="space-y-3">
            {dayAppts.length === 0 && (
              <div className="py-10 text-center">
                <CalendarDays className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <div className="text-sm text-muted-foreground">{t("noAppointments")}</div>
                <Button size="sm" variant="outline" className="rounded-full mt-3" onClick={() => openNewOnDay(selectedDay)} data-testid="cal-day-add">
                  <Plus className="h-3.5 w-3.5 mr-1" /> {t("newAppointment")}
                </Button>
              </div>
            )}
            {dayAppts.map(a => (
              <div key={a.id} className="p-3 rounded-md border border-border hover:border-primary/40 transition-colors" data-testid={`appt-row-${a.id}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="font-mono font-bold text-sm">{a.scheduled_at.slice(11, 16)} <span className="text-muted-foreground text-[10px]">· {a.duration_min}m</span></div>
                  <Badge className={`text-[10px] ${STATUS_STYLE[a.status]}`}>{t("appt_" + a.status)}</Badge>
                </div>
                <div className="text-sm font-medium">{a.service_type}</div>
                <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                  {a.customer_name && <div className="flex items-center gap-1"><User className="h-3 w-3" />{a.customer_name}</div>}
                  {(a.vehicle_label || a.car_plate) && <div className="flex items-center gap-1"><Car className="h-3 w-3" />{a.vehicle_label} {a.car_plate && `· ${a.car_plate}`}</div>}
                  {a.mechanic_name && <div className="flex items-center gap-1"><Wrench className="h-3 w-3" />{a.mechanic_name}</div>}
                </div>
                {a.notes && <div className="text-[11px] text-muted-foreground mt-2 line-clamp-2">{a.notes}</div>}
                <div className="flex gap-1 mt-3">
                  {a.repair_id ? (
                    <Button size="sm" variant="outline" className="rounded-full flex-1" onClick={() => nav("/repairs")} data-testid={`appt-open-card-${a.id}`}>
                      <FileText className="h-3 w-3 mr-1" /> {t("openCard")}
                    </Button>
                  ) : (
                    <Button size="sm" className="rounded-full flex-1 bg-primary" onClick={() => convert(a)} data-testid={`appt-convert-${a.id}`}>
                      <ArrowRight className="h-3 w-3 mr-1" /> {t("convertToCard")}
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => del(a.id)} data-testid={`appt-del-${a.id}`}>
                    <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* New appointment dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display">{t("newAppointment")}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{t("customer")}</Label>
                  <button type="button" onClick={() => setShowNewCustomer(true)} className="text-[11px] text-primary hover:underline flex items-center gap-1" data-testid="appt-new-customer-btn">
                    <Plus className="h-3 w-3" /> {t("newCustomer")}
                  </button>
                </div>
                <SearchableSelect
                  value={form.customer_id}
                  onChange={(v) => setForm({ ...form, customer_id: v, vehicle_id: "" })}
                  options={customers.map(c => ({ value: c.id, label: c.name, secondary: c.phone }))}
                  emptyLabel={t("walkIn")}
                  searchPlaceholder={t("searchCustomer")}
                  placeholder={t("walkIn")}
                  testId="appt-customer-select"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{t("vehicle")}</Label>
                  <button type="button" onClick={() => setShowNewVehicle(true)} disabled={!form.customer_id} className="text-[11px] text-primary hover:underline flex items-center gap-1 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed" data-testid="appt-new-vehicle-btn">
                    <Plus className="h-3 w-3" /> {t("newVehicle")}
                  </button>
                </div>
                <Select value={form.vehicle_id || "none"} onValueChange={(v) => setForm({ ...form, vehicle_id: v === "none" ? "" : v })} disabled={!form.customer_id}>
                  <SelectTrigger data-testid="appt-vehicle-select"><SelectValue placeholder={form.customer_id ? t("pickVehicle") : t("pickCustomerFirst")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— {t("walkInVehicle")} —</SelectItem>
                    {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{[v.make, v.model, v.year].filter(Boolean).join(" ")} {v.plate ? `· ${v.plate}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="space-y-1.5">
                <Label>{t("dateTime")}</Label>
                <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} data-testid="appt-datetime" required />
              </div>
              <div className="space-y-1.5">
                <Label>{t("duration")} ({t("minutes")})</Label>
                <Input type="number" min="15" step="15" value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} data-testid="appt-duration" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("serviceType")}</Label>
              <Input value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })} placeholder={t("serviceTypeHint")} data-testid="appt-service" />
            </div>
            {isOwner && (
              <div className="space-y-1.5">
                <Label>{t("mechanic")}</Label>
                <Select value={form.mechanic_id || "none"} onValueChange={(v) => setForm({ ...form, mechanic_id: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="appt-mechanic-select"><SelectValue placeholder={t("unassigned")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— {t("unassigned")} —</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name} · {u.role}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {conflicts.length > 0 && (
              <div className="rounded-md border border-amber-500/60 bg-amber-500/10 p-3" data-testid="appt-conflict-banner">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {t("apptConflictTitle", { n: conflicts.length })}
                  </div>
                </div>
                <ul className="space-y-1 text-xs">
                  {conflicts.slice(0, 4).map(c => (
                    <li key={c.id} className="font-mono text-amber-900 dark:text-amber-200 flex items-center gap-2">
                      <span>{c.scheduled_at.slice(0, 10)} · {c.scheduled_at.slice(11, 16)}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="truncate">{c.customer_name || t("walkIn")} — {c.service_type}</span>
                      <span className="text-muted-foreground">({c.duration_min}m)</span>
                    </li>
                  ))}
                  {conflicts.length > 4 && (
                    <li className="text-xs text-muted-foreground">+ {conflicts.length - 4}</li>
                  )}
                </ul>
                <div className="text-[10px] font-mono uppercase tracking-widest text-amber-700 dark:text-amber-400 mt-2">
                  {t("apptConflictHint")}
                </div>
              </div>
            )}
            {checkingConflicts && (
              <div className="text-[10px] font-mono text-muted-foreground">{t("apptConflictChecking")}</div>
            )}
            <div className="space-y-1.5">
              <Label>{t("notes")}</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>{t("cancel")}</Button>
              <Button type="submit" className="rounded-full" data-testid="appt-save">{t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quick add customer dialog — same layout as the Customers page */}
      <Dialog open={showNewCustomer} onOpenChange={(v) => { setShowNewCustomer(v); if (!v) setNewCustomer(EMPTY_NEW_CUST); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">{t("newCustomer")}</DialogTitle></DialogHeader>
          <form onSubmit={createCustomer} className="space-y-4">
            {/* Individual / Company toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-muted/40 rounded-full border border-border" data-testid="cal-cust-type-toggle">
              <button
                type="button"
                onClick={() => setNewCustomer({ ...newCustomer, customer_type: "individual" })}
                className={`h-9 rounded-full text-sm font-medium transition-colors ${newCustomer.customer_type !== "company" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="cal-cust-type-individual"
              >
                <span className="inline-flex items-center gap-1.5"><span>👤</span>{t("customerTypeIndividual")}</span>
              </button>
              <button
                type="button"
                onClick={() => setNewCustomer({ ...newCustomer, customer_type: "company" })}
                className={`h-9 rounded-full text-sm font-medium transition-colors ${newCustomer.customer_type === "company" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="cal-cust-type-company"
              >
                <span className="inline-flex items-center gap-1.5"><span>🏢</span>{t("customerTypeCompany")}</span>
              </button>
            </div>

            {/* KvK hero */}
            {newCustomer.customer_type === "company" && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2" data-testid="cal-kvk-hero">
                <div className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{t("kvkLookup")}</div>
                </div>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-9 space-y-1">
                    <Label className="text-[10px]">{t("kvkNumber")}</Label>
                    <Input value={newCustomer.kvk_number} onChange={(e) => setNewCustomer({ ...newCustomer, kvk_number: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); kvkLookup(); } }}
                      placeholder="12345678" className="h-10 font-mono tracking-wider" data-testid="cal-cust-kvk-input" />
                  </div>
                  <div className="col-span-3">
                    <Button type="button" className="w-full h-10 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm disabled:opacity-60"
                      onClick={kvkLookup} disabled={kvkBusy || !newCustomer.kvk_number} data-testid="cal-cust-kvk-btn">
                      {kvkBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}KvK
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Company fields */}
            {newCustomer.customer_type === "company" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>{t("companyName")} *</Label>
                  <Input required value={newCustomer.company_name} onChange={(e) => setNewCustomer({ ...newCustomer, company_name: e.target.value, name: e.target.value })} data-testid="cal-cust-company-name" /></div>
                <div className="space-y-1.5"><Label>{t("vatNumber")}</Label>
                  <Input value={newCustomer.vat_number} onChange={(e) => setNewCustomer({ ...newCustomer, vat_number: e.target.value.toUpperCase() })} placeholder="NL812345678B01" className="font-mono" /></div>
                <div className="space-y-1.5 col-span-2"><Label>{t("contactPerson")}</Label>
                  <Input value={newCustomer.contact_person} onChange={(e) => setNewCustomer({ ...newCustomer, contact_person: e.target.value })} placeholder={t("contactPersonPlaceholder")} /></div>
              </div>
            )}

            {/* Individual name */}
            {newCustomer.customer_type !== "company" && (
              <div className="space-y-1.5"><Label>{t("name")} *</Label>
                <Input required value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} data-testid="quick-customer-name" /></div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t("phone")}</Label><Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} data-testid="quick-customer-phone" /></div>
              <div className="space-y-1.5"><Label>{t("email")}</Label><Input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} /></div>
            </div>

            <div className="space-y-2 p-3 rounded-md border border-border bg-muted/20">
              <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("address")}</div>
              <AddressFields
                value={{ postcode: newCustomer.postcode, house_number: newCustomer.house_number, house_number_addition: newCustomer.house_number_addition, street: newCustomer.street, city: newCustomer.city, address_country: newCustomer.address_country }}
                onChange={(a) => setNewCustomer({ ...newCustomer, ...a })}
                testIdPrefix="cal-cust-addr"
                compact
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowNewCustomer(false)}>{t("cancel")}</Button>
              <Button type="submit" className="rounded-full" data-testid="quick-customer-save">{t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quick add vehicle dialog — mirrors the CustomerVehiclesEditor add-form */}
      <Dialog open={showNewVehicle} onOpenChange={(v) => { setShowNewVehicle(v); if (!v) setNewVehicle(EMPTY_NEW_VEH); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">{t("newVehicle")}</DialogTitle></DialogHeader>
          <form onSubmit={createVehicle} className="space-y-4">
            {/* RDW hero */}
            <div className="rounded-md border border-orange-500/40 bg-orange-500/5 p-3 space-y-2" data-testid="cal-rdw-hero">
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                <div className="text-[10px] font-mono uppercase tracking-widest text-orange-700 dark:text-orange-400">{t("rdwLookup")}</div>
              </div>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4 space-y-1">
                  <Label className="text-[10px]">{t("country")}</Label>
                  <select value={newVehicle.country} onChange={(e) => setNewVehicle({ ...newVehicle, country: e.target.value })} className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm" data-testid="cal-veh-country">
                    {["NL","DE","BE","FR","IT","ES","PL","TR","MA","SY","LB","JO","IQ","EG","SA","AE","GB","OTHER"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="col-span-5 space-y-1">
                  <Label className="text-[10px]">{t("plateNumber")}</Label>
                  <Input value={newVehicle.plate} onChange={(e) => setNewVehicle({ ...newVehicle, plate: e.target.value.toUpperCase() })}
                    onKeyDown={(e) => { if (e.key === "Enter" && newVehicle.country === "NL") { e.preventDefault(); rdwLookup(); } }}
                    placeholder="12-ABC-3" className="h-10 font-mono tracking-wider" data-testid="quick-veh-plate" />
                </div>
                <div className="col-span-3">
                  <Button type="button" className="w-full h-10 rounded-md bg-orange-500 hover:bg-orange-600 text-white shadow-sm disabled:opacity-60"
                    onClick={rdwLookup} disabled={rdwBusy || newVehicle.country !== "NL" || !newVehicle.plate}
                    data-testid="cal-veh-rdw">
                    {rdwBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}RDW
                  </Button>
                </div>
              </div>
            </div>

            <VehicleMakeModelYear
              value={{ make: newVehicle.make, model: newVehicle.model, year: newVehicle.year }}
              onChange={(mmy) => setNewVehicle({ ...newVehicle, ...mmy })}
              testIdPrefix="quick-veh"
            />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="space-y-1"><Label className="text-[10px]">{t("color")}</Label><Input value={newVehicle.color} onChange={(e) => setNewVehicle({ ...newVehicle, color: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-[10px]">{t("odometer")}</Label><Input value={newVehicle.km} onChange={(e) => setNewVehicle({ ...newVehicle, km: e.target.value })} placeholder="km" /></div>
              <div className="space-y-1"><Label className="text-[10px]">{t("apkExpiry")}</Label><Input type="date" value={newVehicle.apk_expiry} onChange={(e) => setNewVehicle({ ...newVehicle, apk_expiry: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-[10px]">{t("nextOilChangeKm")}</Label><Input type="number" value={newVehicle.next_oil_change_km} onChange={(e) => setNewVehicle({ ...newVehicle, next_oil_change_km: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border/50">
              <div className="space-y-1"><Label className="text-[10px]">Brandstof</Label><Input value={newVehicle.fuel} onChange={(e) => setNewVehicle({ ...newVehicle, fuel: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-[10px]">CC</Label><Input value={newVehicle.cc} onChange={(e) => setNewVehicle({ ...newVehicle, cc: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-[10px]">Deuren</Label><Input value={newVehicle.doors} onChange={(e) => setNewVehicle({ ...newVehicle, doors: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-[10px]">Zitpl.</Label><Input value={newVehicle.seats} onChange={(e) => setNewVehicle({ ...newVehicle, seats: e.target.value })} /></div>
              <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">Meldcode</Label><Input value={newVehicle.meldcode} onChange={(e) => setNewVehicle({ ...newVehicle, meldcode: e.target.value })} placeholder="4-cijferige code" className="font-mono" /></div>
              <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">VIN</Label><Input value={newVehicle.vin} onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value })} className="font-mono" /></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowNewVehicle(false)}>{t("cancel")}</Button>
              <Button type="submit" className="rounded-full" data-testid="quick-veh-save">{t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
