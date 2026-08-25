import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Car, Plus, Save, Trash2, X, ChevronDown, ChevronUp, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import PlateBadge from "@/components/PlateBadge";
import { useLang } from "@/i18n";

const COUNTRIES = ["NL", "DE", "BE", "FR", "IT", "ES", "PL", "GB", "TR", "MA", "DZ", "SA", "AE", "EG", "SY", "LB", "JO", "IQ"];
const EMPTY = { make: "", model: "", year: "", plate: "", color: "", km: "", country: "NL", apk_expiry: "", next_oil_change_km: "", vin: "", notes: "", meldcode: "", fuel: "", cc: "", doors: "", seats: "", weight: "", chassis_location: "", registration_date: "" };

/**
 * Fetch RDW data for a plate and merge it into the caller's form state.
 * Returns true when the lookup succeeded so the UI can react (toast, etc.).
 */
async function lookupRdwInto(plate, applyPatch, t) {
  const cleaned = (plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned || cleaned.length < 4) {
    toast.error(t("rdwEnterPlate"));
    return false;
  }
  try {
    const { data } = await api.get(`/rdw/lookup?plate=${encodeURIComponent(cleaned)}`);
    // Merge every non-empty imported field into the form (never overwrite with blanks)
    const patch = {};
    ["make", "model", "year", "color", "country", "apk_expiry",
     "fuel", "cc", "doors", "seats", "weight", "chassis_location", "registration_date"
    ].forEach(k => { if (data[k]) patch[k] = data[k]; });
    patch.plate = data.plate;
    applyPatch(patch);
    toast.success(`${data.make} ${data.model} ${data.year}`.trim() + " · RDW ✓");
    return true;
  } catch (e) {
    const msg = e?.response?.data?.detail || e?.message || "RDW lookup failed";
    toast.error(msg);
    return false;
  }
}

/**
 * Inline editor for the vehicles linked to a specific customer.
 * Shows a collapsible row per vehicle with save/delete, plus an "Add vehicle"
 * form at the bottom. Kept simple: each row has its own local dirty copy so
 * the parent dialog doesn't need to know anything about vehicles.
 */
export default function CustomerVehiclesEditor({ customerId }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [openRow, setOpenRow] = useState(null);   // vehicle id whose editor is expanded
  const [drafts, setDrafts] = useState({});       // { [vehicleId]: { …editable fields } }
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [rdwBusy, setRdwBusy] = useState("");     // "" | "new" | vehicleId — which row is currently querying RDW

  const lookupNew = async () => {
    setRdwBusy("new");
    try {
      await lookupRdwInto(newForm.plate, (patch) => setNewForm(f => ({ ...f, ...patch })), t);
    } finally { setRdwBusy(""); }
  };

  const lookupRow = async (v) => {
    setRdwBusy(v.id);
    try {
      const draft = drafts[v.id] || { ...v };
      await lookupRdwInto(draft.plate, (patch) => setDrafts(d => ({ ...d, [v.id]: { ...(d[v.id] || v), ...patch } })), t);
    } finally { setRdwBusy(""); }
  };

  const { data: vehicles = [], refetch } = useQuery({
    queryKey: ["cust-vehicles", customerId],
    enabled: !!customerId,
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: () => api.get(`/customers/${customerId}/vehicles`).then(r => r.data),
  });

  const draftFor = (v) => drafts[v.id] ?? { ...v };
  const isDirty = (v) => !!drafts[v.id];
  const setDraft = (vid, patch) => setDrafts(d => ({ ...d, [vid]: { ...(d[vid] || vehicles.find(x => x.id === vid)), ...patch } }));

  const saveVehicle = async (v) => {
    const draft = draftFor(v);
    setBusy(true);
    try {
      const payload = { ...draft };
      if (payload.next_oil_change_km === "" || payload.next_oil_change_km === null) delete payload.next_oil_change_km;
      else payload.next_oil_change_km = Number(payload.next_oil_change_km);
      if (payload.apk_expiry === "") payload.apk_expiry = null;
      delete payload.id; delete payload.customer_id; delete payload.created_at; delete payload.passport_token;
      await api.put(`/vehicles/${v.id}`, payload);
      toast.success(t("vehicleUpdated"));
      // Clear the row's draft & refresh
      setDrafts(d => { const n = { ...d }; delete n[v.id]; return n; });
      await qc.invalidateQueries({ queryKey: ["cust-vehicles", customerId] });
      refetch();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const deleteVehicle = async (v) => {
    if (!window.confirm(t("deleteVehicleConfirm") + `\n${v.make} ${v.model} · ${v.plate}`)) return;
    setBusy(true);
    try {
      await api.delete(`/vehicles/${v.id}`);
      toast.success(t("vehicleDeleted"));
      await qc.invalidateQueries({ queryKey: ["cust-vehicles", customerId] });
      refetch();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const addNew = async () => {
    if (!newForm.make && !newForm.plate) return toast.error(t("nameRequired"));
    setBusy(true);
    try {
      const payload = { ...newForm };
      if (payload.next_oil_change_km === "") delete payload.next_oil_change_km;
      else payload.next_oil_change_km = Number(payload.next_oil_change_km);
      if (payload.apk_expiry === "") payload.apk_expiry = null;
      await api.post(`/customers/${customerId}/vehicles`, payload);
      toast.success(t("vehicleAdded"));
      setNewForm(EMPTY);
      setAdding(false);
      await qc.invalidateQueries({ queryKey: ["cust-vehicles", customerId] });
      refetch();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 p-3 rounded-md border border-border bg-muted/20" data-testid="cust-vehicles-editor">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Car className="h-4 w-4 text-primary" />
          <div className="text-[10px] font-mono uppercase tracking-widest text-primary">
            {t("linkedVehicles")} · {vehicles.length}
          </div>
        </div>
        <Button
          type="button" size="sm" variant="outline"
          className="rounded-full h-7 text-[11px]"
          onClick={() => setAdding(a => !a)}
          data-testid="cust-veh-add-toggle"
        >
          {adding ? <><X className="h-3 w-3 mr-1" />{t("close")}</> : <><Plus className="h-3 w-3 mr-1" />{t("addVehicle")}</>}
        </Button>
      </div>

      {/* Add new vehicle form (collapsed by default) — plate lookup is the hero */}
      {adding && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3" data-testid="cust-veh-add-form">
          {/* Hero: plate + country + RDW lookup, big and first */}
          <div className="rounded-md border border-orange-500/40 bg-orange-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              <div className="text-[11px] font-mono uppercase tracking-widest text-orange-700 dark:text-orange-400">
                {t("rdwLookup")}
              </div>
            </div>
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 md:col-span-3 space-y-1">
                <Label className="text-[10px]">{t("country")}</Label>
                <select
                  value={newForm.country}
                  onChange={(e) => setNewForm({ ...newForm, country: e.target.value })}
                  className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
                  data-testid="cust-veh-new-country"
                >
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-8 md:col-span-6 space-y-1">
                <Label className="text-[10px]">{t("plateNumber")}</Label>
                <Input
                  value={newForm.plate}
                  onChange={(e) => setNewForm({ ...newForm, plate: e.target.value.toUpperCase() })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (newForm.country === "NL") lookupNew(); } }}
                  placeholder="12-ABC-3"
                  className="h-10 font-mono text-base tracking-wider"
                  data-testid="cust-veh-new-plate"
                />
              </div>
              <div className="col-span-4 md:col-span-3">
                <Button
                  type="button"
                  className="w-full h-10 rounded-md bg-orange-500 hover:bg-orange-600 text-white shadow-sm disabled:opacity-60"
                  onClick={lookupNew}
                  disabled={rdwBusy === "new" || newForm.country !== "NL" || !newForm.plate}
                  title={newForm.country !== "NL" ? "RDW = NL only" : t("rdwLookup")}
                  data-testid="cust-veh-new-rdw"
                >
                  {rdwBusy === "new" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                  RDW
                </Button>
              </div>
            </div>
            {newForm.country !== "NL" && (
              <p className="text-[10px] text-muted-foreground">RDW = NL only · املأ الحقول يدوياً للدول الأخرى.</p>
            )}
          </div>

          {/* Details grid — auto-populated after RDW, or fill manually */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div className="space-y-1"><Label className="text-[10px]">{t("make")}</Label><Input value={newForm.make} onChange={(e) => setNewForm({ ...newForm, make: e.target.value })} data-testid="cust-veh-new-make" /></div>
            <div className="space-y-1"><Label className="text-[10px]">{t("model")}</Label><Input value={newForm.model} onChange={(e) => setNewForm({ ...newForm, model: e.target.value })} data-testid="cust-veh-new-model" /></div>
            <div className="space-y-1"><Label className="text-[10px]">{t("year")}</Label><Input value={newForm.year} onChange={(e) => setNewForm({ ...newForm, year: e.target.value })} data-testid="cust-veh-new-year" /></div>
            <div className="space-y-1"><Label className="text-[10px]">{t("color")}</Label><Input value={newForm.color} onChange={(e) => setNewForm({ ...newForm, color: e.target.value })} data-testid="cust-veh-new-color" /></div>
            <div className="space-y-1"><Label className="text-[10px]">{t("odometer")}</Label><Input value={newForm.km} onChange={(e) => setNewForm({ ...newForm, km: e.target.value })} data-testid="cust-veh-new-km" /></div>
            <div className="space-y-1"><Label className="text-[10px]">{t("apkExpiry")}</Label><Input type="date" value={newForm.apk_expiry || ""} onChange={(e) => setNewForm({ ...newForm, apk_expiry: e.target.value })} data-testid="cust-veh-new-apk" /></div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] flex items-center gap-1">VIN <span className="text-[9px] text-muted-foreground">(RDW لا يوفّره — يُدخل يدوياً)</span></Label>
              <Input value={newForm.vin || ""} onChange={(e) => setNewForm({ ...newForm, vin: e.target.value })} placeholder="17 حرف/رقم" data-testid="cust-veh-new-vin" />
            </div>
            <div className="space-y-1"><Label className="text-[10px]">{t("nextOilChangeKm")}</Label><Input type="number" value={newForm.next_oil_change_km} onChange={(e) => setNewForm({ ...newForm, next_oil_change_km: e.target.value })} data-testid="cust-veh-new-oil" /></div>
          </div>

          {/* Auto-imported RDW technical details (read-only unless the user overrides) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-primary/20">
            <div className="space-y-1"><Label className="text-[10px]">Brandstof</Label><Input value={newForm.fuel || ""} onChange={(e) => setNewForm({ ...newForm, fuel: e.target.value })} placeholder="Benzine / Diesel …" data-testid="cust-veh-new-fuel" /></div>
            <div className="space-y-1"><Label className="text-[10px]">CC</Label><Input value={newForm.cc || ""} onChange={(e) => setNewForm({ ...newForm, cc: e.target.value })} placeholder="1339" data-testid="cust-veh-new-cc" /></div>
            <div className="space-y-1"><Label className="text-[10px]">Deuren</Label><Input value={newForm.doors || ""} onChange={(e) => setNewForm({ ...newForm, doors: e.target.value })} data-testid="cust-veh-new-doors" /></div>
            <div className="space-y-1"><Label className="text-[10px]">Zitplaatsen</Label><Input value={newForm.seats || ""} onChange={(e) => setNewForm({ ...newForm, seats: e.target.value })} data-testid="cust-veh-new-seats" /></div>
            <div className="space-y-1"><Label className="text-[10px]">Gewicht (kg)</Label><Input value={newForm.weight || ""} onChange={(e) => setNewForm({ ...newForm, weight: e.target.value })} data-testid="cust-veh-new-weight" /></div>
            <div className="space-y-1"><Label className="text-[10px]">Tenaamstelling</Label><Input type="date" value={newForm.registration_date || ""} onChange={(e) => setNewForm({ ...newForm, registration_date: e.target.value })} data-testid="cust-veh-new-regdate" /></div>
            <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">Chassis loc.</Label><Input value={newForm.chassis_location || ""} onChange={(e) => setNewForm({ ...newForm, chassis_location: e.target.value })} placeholder="r. tegen schutbord …" data-testid="cust-veh-new-chassis" /></div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] flex items-center gap-1">Meldcode voertuig <span className="text-[9px] text-muted-foreground">(privé — يُدخل يدوياً)</span></Label>
              <Input value={newForm.meldcode || ""} onChange={(e) => setNewForm({ ...newForm, meldcode: e.target.value })} placeholder="4-cijferige code" className="font-mono" data-testid="cust-veh-new-meldcode" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] flex items-center gap-1">VIN <span className="text-[9px] text-muted-foreground">(privé — يُدخل يدوياً)</span></Label>
              <Input value={newForm.vin || ""} onChange={(e) => setNewForm({ ...newForm, vin: e.target.value })} placeholder="17 حرف/رقم" className="font-mono" data-testid="cust-veh-new-vin" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" size="sm" className="rounded-full bg-primary" onClick={addNew} disabled={busy} data-testid="cust-veh-new-save">
              <Save className="h-3 w-3 mr-1" /> {t("addVehicle")}
            </Button>
          </div>
        </div>
      )}

      {/* Existing vehicles */}
      {vehicles.length === 0 && !adding && (
        <div className="text-center text-xs text-muted-foreground py-4">{t("noVehiclesYet")}</div>
      )}
      <div className="space-y-2">
        {vehicles.map(v => {
          const d = draftFor(v);
          const expanded = openRow === v.id;
          return (
            <div key={v.id} className={`rounded-md border ${isDirty(v) ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-background/60"}`} data-testid={`cust-veh-row-${v.id}`}>
              <div className="flex items-center gap-3 p-2">
                <button
                  type="button"
                  onClick={() => setOpenRow(o => o === v.id ? null : v.id)}
                  className="flex-1 flex items-center gap-3 text-left"
                  data-testid={`cust-veh-toggle-${v.id}`}
                >
                  <PlateBadge plate={v.plate} country={v.country || "NL"} size="xs" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {v.km ? v.km + " km · " : ""}{v.color || ""}{v.apk_expiry ? " · APK " + v.apk_expiry : ""}
                    </div>
                  </div>
                  {isDirty(v) && <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 text-[10px]">{t("unsaved")}</Badge>}
                  {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                <Button type="button" size="icon" variant="ghost" onClick={() => deleteVehicle(v)} data-testid={`cust-veh-del-${v.id}`}>
                  <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                </Button>
              </div>
              {expanded && (
                <div className="border-t border-border/50 p-3 space-y-2 bg-muted/20" data-testid={`cust-veh-editor-${v.id}`}>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <div className="space-y-1"><Label className="text-[10px]">{t("make")}</Label><Input value={d.make || ""} onChange={(e) => setDraft(v.id, { make: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">{t("model")}</Label><Input value={d.model || ""} onChange={(e) => setDraft(v.id, { model: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">{t("year")}</Label><Input value={d.year || ""} onChange={(e) => setDraft(v.id, { year: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">{t("plateNumber")}</Label>
                      <div className="flex gap-1">
                        <Input value={d.plate || ""} onChange={(e) => setDraft(v.id, { plate: e.target.value.toUpperCase() })} />
                        {(d.country || "NL") === "NL" && (
                          <Button
                            type="button" size="icon" variant="outline"
                            className="rounded-full shrink-0 border-orange-500/40 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10"
                            onClick={() => lookupRow(v)}
                            disabled={rdwBusy === v.id}
                            title={t("rdwLookup")}
                            data-testid={`cust-veh-rdw-${v.id}`}
                          >
                            {rdwBusy === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">{t("country")}</Label>
                      <select value={d.country || "NL"} onChange={(e) => setDraft(v.id, { country: e.target.value })} className="w-full h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                        {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1"><Label className="text-[10px]">{t("color")}</Label><Input value={d.color || ""} onChange={(e) => setDraft(v.id, { color: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">{t("odometer")}</Label><Input value={d.km || ""} onChange={(e) => setDraft(v.id, { km: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">{t("apkExpiry")}</Label><Input type="date" value={d.apk_expiry || ""} onChange={(e) => setDraft(v.id, { apk_expiry: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">{t("nextOilChangeKm")}</Label><Input type="number" value={d.next_oil_change_km ?? ""} onChange={(e) => setDraft(v.id, { next_oil_change_km: e.target.value })} /></div>
                  </div>
                  {/* Extra RDW / manual details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border/50">
                    <div className="space-y-1"><Label className="text-[10px]">Brandstof</Label><Input value={d.fuel || ""} onChange={(e) => setDraft(v.id, { fuel: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">CC</Label><Input value={d.cc || ""} onChange={(e) => setDraft(v.id, { cc: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Deuren</Label><Input value={d.doors || ""} onChange={(e) => setDraft(v.id, { doors: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Zitpl.</Label><Input value={d.seats || ""} onChange={(e) => setDraft(v.id, { seats: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Gewicht (kg)</Label><Input value={d.weight || ""} onChange={(e) => setDraft(v.id, { weight: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-[10px]">Tenaamstelling</Label><Input type="date" value={d.registration_date || ""} onChange={(e) => setDraft(v.id, { registration_date: e.target.value })} /></div>
                    <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">Chassis loc.</Label><Input value={d.chassis_location || ""} onChange={(e) => setDraft(v.id, { chassis_location: e.target.value })} /></div>
                    <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">Meldcode voertuig</Label><Input value={d.meldcode || ""} onChange={(e) => setDraft(v.id, { meldcode: e.target.value })} placeholder="4-cijferige code" className="font-mono" data-testid={`cust-veh-meldcode-${v.id}`} /></div>
                    <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">VIN</Label><Input value={d.vin || ""} onChange={(e) => setDraft(v.id, { vin: e.target.value })} className="font-mono" /></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    {isDirty(v) && (
                      <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => setDrafts(dd => { const n = { ...dd }; delete n[v.id]; return n; })}>
                        {t("close")}
                      </Button>
                    )}
                    <Button
                      type="button" size="sm"
                      className="rounded-full bg-primary hover:bg-primary/90"
                      onClick={() => saveVehicle(v)}
                      disabled={busy || !isDirty(v)}
                      data-testid={`cust-veh-save-${v.id}`}
                    >
                      <Save className="h-3 w-3 mr-1" /> {t("saveChanges")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
