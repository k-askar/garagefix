import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Car, Plus, Sparkles, Search, Loader2 } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import PlateBadge from "@/components/PlateBadge";
import AddressFields from "@/components/AddressFields";
import VehicleMakeModelYear from "@/components/VehicleMakeModelYear";
import { toast } from "sonner";
import { useLang } from "@/i18n";

const COUNTRIES = [
  ["NL", "🇳🇱 NL"], ["DE", "🇩🇪 DE"], ["FR", "🇫🇷 FR"], ["BE", "🇧🇪 BE"], ["IT", "🇮🇹 IT"], ["ES", "🇪🇸 ES"],
  ["PL", "🇵🇱 PL"], ["TR", "🇹🇷 TR"], ["MA", "🇲🇦 MA"], ["SY", "🇸🇾 SY"], ["LB", "🇱🇧 LB"], ["JO", "🇯🇴 JO"],
  ["IQ", "🇮🇶 IQ"], ["EG", "🇪🇬 EG"], ["SA", "🇸🇦 SA"], ["AE", "🇦🇪 AE"], ["GB", "🇬🇧 GB"], ["OTHER", "Other"],
];

const EMPTY_FORM = {
  customer_id: "", vehicle_id: "",
  customer_name: "", customer_phone: "",
  car_make: "", car_model: "", car_year: "", car_plate: "", car_color: "", car_km: "",
  car_country: "NL", car_apk_expiry: "",
  mechanic_id: "", complaint: "", notes: "",
};

const EMPTY_VEHICLE = { make: "", model: "", year: "", plate: "", color: "", km: "", country: "NL", apk_expiry: "", next_oil_change_km: "", vin: "", notes: "", meldcode: "", fuel: "", cc: "", doors: "", seats: "", weight: "", chassis_location: "", registration_date: "" };

/**
 * NewJobCardDialog — a smarter, sectioned dialog for creating job cards.
 *  Step 1: Pick / create the CUSTOMER (auto-fills name + phone)
 *  Step 2: Pick / create the VEHICLE (auto-fills make/model/year/plate/km/country/apk)
 *  Step 3: Mechanic + complaint
 */
export default function NewJobCardDialog({ open, onOpenChange, customers, users, onCreated }) {
  const qc = useQueryClient();
  const { t } = useLang();
  const [form, setForm] = useState(EMPTY_FORM);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const EMPTY_NEW_CUST = { name: "", phone: "", email: "", address: "", postcode: "", house_number: "", house_number_addition: "", street: "", city: "", address_country: "NL", customer_type: "individual", company_name: "", kvk_number: "", vat_number: "", contact_person: "" };
  const [newCustomer, setNewCustomer] = useState(EMPTY_NEW_CUST);
  const [kvkBusy, setKvkBusy] = useState(false);
  const [rdwBusy, setRdwBusy] = useState(false);
  const [newVehicle, setNewVehicle] = useState(EMPTY_VEHICLE);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [busy, setBusy] = useState(false);

  /* Query RDW open-data for a plate and fan out the result into either the
     "adding vehicle" draft (persisted to /customers/{id}/vehicles later) or the
     top-level `car_*` fields on the job card itself (used for walk-ins). */
  const rdwLookupInto = async () => {
    const usingNewVeh = addingVehicle;
    const country = usingNewVeh ? newVehicle.country : form.car_country;
    const plate = usingNewVeh ? newVehicle.plate : form.car_plate;
    if (country !== "NL") return toast.error("RDW = NL only");
    const cleaned = (plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cleaned || cleaned.length < 4) return toast.error(t("rdwEnterPlate"));
    setRdwBusy(true);
    try {
      const { data } = await api.get(`/rdw/lookup?plate=${encodeURIComponent(cleaned)}`);
      if (usingNewVeh) {
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
          vehicle_type: data.suggested_type || v.vehicle_type,
        }));
      } else {
        setForm(f => ({
          ...f,
          car_plate: data.plate || f.car_plate,
          car_make: data.make || f.car_make,
          car_model: data.model || f.car_model,
          car_year: data.year || f.car_year,
          car_color: data.color || f.car_color,
          car_country: data.country || f.car_country,
          car_apk_expiry: data.apk_expiry || f.car_apk_expiry,
        }));
      }
      toast.success(`${data.make} ${data.model} ${data.year}`.trim() + " · RDW ✓");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "RDW lookup failed");
    } finally { setRdwBusy(false); }
  };

  /* Query KvK basisprofiel and merge company + address into the new-customer form.
     Mirrors the behaviour of the same lookup on the Customers page. */
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

  // Reset when opened/closed
  useEffect(() => { if (!open) { setForm(EMPTY_FORM); setAddingVehicle(false); setNewVehicle(EMPTY_VEHICLE); } }, [open]);

  // Vehicles for the picked customer — always refetch on mount so any vehicle
  // added elsewhere (Customers page, Calendar…) shows up immediately.
  const { data: cVehicles = [], refetch: refetchVehicles } = useQuery({
    queryKey: ["cust-vehicles", form.customer_id],
    enabled: !!form.customer_id,
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: () => api.get(`/customers/${form.customer_id}/vehicles`).then(r => r.data),
  });

  // Auto-fill from selected customer
  useEffect(() => {
    if (!form.customer_id) return;
    const c = customers.find(x => x.id === form.customer_id);
    if (c) setForm(f => ({ ...f, customer_name: c.name || "", customer_phone: c.phone || "" }));
  }, [form.customer_id, customers]);

  // Auto-fill from selected vehicle
  useEffect(() => {
    if (!form.vehicle_id) return;
    const v = cVehicles.find(x => x.id === form.vehicle_id);
    if (!v) return;
    setForm(f => ({
      ...f,
      car_make: v.make || "", car_model: v.model || "", car_year: v.year || "",
      car_plate: v.plate || "", car_color: v.color || "", car_km: v.km || "",
      car_country: v.country || "NL",
      car_apk_expiry: v.apk_expiry || "",
    }));
  }, [form.vehicle_id, cVehicles]);

  const linkedCust = customers.find(c => c.id === form.customer_id);
  const canPickVehicle = !!form.customer_id && cVehicles.length > 0;

  const createNewCustomer = async () => {
    const nameField = newCustomer.customer_type === "company" ? newCustomer.company_name : newCustomer.name;
    if (!nameField?.trim()) return toast.error(newCustomer.customer_type === "company" ? "Bedrijfsnaam is verplicht" : "Customer name is required");
    setBusy(true);
    try {
      // Ensure the top-level `name` field is populated for both types (used by the
      // rest of the app that keys off `name`).
      const payload = { ...newCustomer, name: nameField };
      const { data } = await api.post("/customers", payload);
      toast.success(`Customer ${data.name} added`);
      setForm(f => ({ ...f, customer_id: data.id, customer_name: data.name, customer_phone: data.phone || "" }));
      setNewCustomer(EMPTY_NEW_CUST);
      setShowNewCustomer(false);
      // Refresh the customer list dropdown so the newly-added customer appears
      // without needing a page reload.
      qc.invalidateQueries({ queryKey: ["cus"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const saveVehicle = async () => {
    if (!form.customer_id) return toast.error("Pick a customer first");
    if (!newVehicle.make && !newVehicle.plate) return toast.error("Make or plate is required");
    setBusy(true);
    try {
      const { data } = await api.post(`/customers/${form.customer_id}/vehicles`, {
        ...newVehicle,
        next_oil_change_km: null,
      });
      toast.success("Vehicle added");
      // Invalidate + refetch so the vehicle appears in this dialog AND anywhere
      // else that lists this customer's vehicles.
      await qc.invalidateQueries({ queryKey: ["cust-vehicles", form.customer_id] });
      await refetchVehicles();
      setForm(f => ({ ...f, vehicle_id: data.id }));
      setNewVehicle(EMPTY_VEHICLE);
      setAddingVehicle(false);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/repairs", {
        ...form,
        customer_id: form.customer_id || null,
        vehicle_id: form.vehicle_id || null,
        mechanic_id: form.mechanic_id || null,
        car_next_oil_change_km: null,
      });
      toast.success(`Card ${data.card_number} created`);
      onCreated?.(data);
      onOpenChange(false);
    } catch (e2) { toast.error(formatApiError(e2)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />New job card</DialogTitle>
            <DialogDescription>Pick an existing customer or add a new one — vehicles auto-fill from their record.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            {/* ---- CUSTOMER ---- */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono uppercase tracking-widest text-primary">1 · Customer</div>
                <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setShowNewCustomer(true)} data-testid="new-card-new-customer">
                  <UserPlus className="h-3.5 w-3.5 mr-1" /> New customer
                </Button>
              </div>
              <SearchableSelect
                value={form.customer_id}
                onChange={(v) => setForm(f => ({ ...f, customer_id: v, vehicle_id: "" }))}
                options={customers.map(c => ({ value: c.id, label: c.name, secondary: c.phone }))}
                emptyLabel="— walk-in / enter manually —"
                searchPlaceholder="Search customer by name or phone"
                placeholder="Pick customer or leave blank for walk-in"
                testId="new-repair-customer-select"
              />
              {linkedCust && (
                <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1" data-testid="new-card-customer-summary">
                  <div><span className="text-muted-foreground">Name: </span>{linkedCust.name}</div>
                  <div><span className="text-muted-foreground">Phone: </span>{linkedCust.phone || "—"}</div>
                  <div><span className="text-muted-foreground">Email: </span>{linkedCust.email || "—"}</div>
                </div>
              )}
              {!form.customer_id && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Customer name</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} data-testid="new-repair-name" placeholder="Walk-in / new" /></div>
                  <div className="space-y-1.5"><Label>Phone</Label><Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} data-testid="new-repair-phone" /></div>
                </div>
              )}
            </div>

            {/* ---- VEHICLE ---- */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono uppercase tracking-widest text-primary">2 · Vehicle</div>
                {form.customer_id && !addingVehicle && (
                  <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => { setAddingVehicle(true); setForm(f => ({ ...f, vehicle_id: "" })); }} data-testid="new-card-new-vehicle">
                    <Plus className="h-3.5 w-3.5 mr-1" /> New vehicle
                  </Button>
                )}
              </div>

              {canPickVehicle && !addingVehicle && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Pick from this customer's vehicles ({cVehicles.length})</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {cVehicles.map(v => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, vehicle_id: v.id }))}
                        className={`text-left rounded-md border p-3 transition-all ${form.vehicle_id === v.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                        data-testid={`new-card-veh-option-${v.id}`}
                      >
                        <div className="flex items-center gap-2">
                          <Car className="h-3.5 w-3.5 text-primary" />
                          <div className="font-medium text-sm truncate">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "Vehicle"}</div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {v.plate && <PlateBadge plate={v.plate} country={v.country || "NL"} size="xxs" />}
                          {v.km && <span className="text-[10px] font-mono text-muted-foreground">{v.km} km</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {form.customer_id && cVehicles.length === 0 && !addingVehicle && (
                <div className="rounded-md bg-amber-500/5 border border-amber-500/30 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Car className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <div className="font-semibold text-amber-800 dark:text-amber-300">Nog geen voertuig gekoppeld</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Deze klant heeft nog geen voertuig in het systeem. Voeg er nu een toe of laat het veld leeg om later te vullen.</div>
                    </div>
                  </div>
                  <Button type="button" size="sm" className="rounded-full bg-amber-500 hover:bg-amber-500/90 text-slate-950 w-full" onClick={() => setAddingVehicle(true)} data-testid="new-card-add-veh-cta">
                    <Plus className="h-4 w-4 mr-2" /> Voertuig toevoegen aan {linkedCust?.name || "klant"}
                  </Button>
                </div>
              )}

              {(addingVehicle || (!form.customer_id) || (!form.vehicle_id && cVehicles.length === 0 && form.customer_id)) && (
                <div className="space-y-3">
                  {/* RDW hero — plate + country + big search first (mirrors the Customers page) */}
                  <div className="rounded-md border border-orange-500/40 bg-orange-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                      <div className="text-[10px] font-mono uppercase tracking-widest text-orange-700 dark:text-orange-400">{t("rdwLookup")}</div>
                    </div>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4 space-y-1">
                        <Label className="text-[10px]">{t("country")}</Label>
                        <select
                          value={addingVehicle ? newVehicle.country : form.car_country}
                          onChange={(e) => addingVehicle
                            ? setNewVehicle({ ...newVehicle, country: e.target.value })
                            : setForm({ ...form, car_country: e.target.value })}
                          className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
                          data-testid="new-repair-country"
                        >
                          {COUNTRIES.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-5 space-y-1">
                        <Label className="text-[10px]">{t("plateNumber")}</Label>
                        <Input
                          value={addingVehicle ? newVehicle.plate : form.car_plate}
                          onChange={(e) => addingVehicle
                            ? setNewVehicle({ ...newVehicle, plate: e.target.value.toUpperCase() })
                            : setForm({ ...form, car_plate: e.target.value.toUpperCase() })}
                          onKeyDown={(e) => {
                            const country = addingVehicle ? newVehicle.country : form.car_country;
                            if (e.key === "Enter" && country === "NL") { e.preventDefault(); rdwLookupInto(); }
                          }}
                          placeholder="12-ABC-3"
                          className="h-10 font-mono tracking-wider"
                          data-testid="new-repair-plate"
                        />
                      </div>
                      <div className="col-span-3">
                        <Button
                          type="button"
                          className="w-full h-10 rounded-md bg-orange-500 hover:bg-orange-600 text-white shadow-sm disabled:opacity-60"
                          onClick={rdwLookupInto}
                          disabled={rdwBusy || (addingVehicle ? newVehicle.country : form.car_country) !== "NL" || !(addingVehicle ? newVehicle.plate : form.car_plate)}
                          title={(addingVehicle ? newVehicle.country : form.car_country) !== "NL" ? "RDW = NL only" : t("rdwLookup")}
                          data-testid="new-repair-rdw"
                        >
                          {rdwBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                          RDW
                        </Button>
                      </div>
                    </div>
                  </div>

                  <VehicleMakeModelYear
                    value={{
                      make: addingVehicle ? newVehicle.make : form.car_make,
                      model: addingVehicle ? newVehicle.model : form.car_model,
                      year: addingVehicle ? newVehicle.year : form.car_year,
                    }}
                    onChange={(mmy) => addingVehicle
                      ? setNewVehicle({ ...newVehicle, ...mmy })
                      : setForm({ ...form, car_make: mmy.make ?? form.car_make, car_model: mmy.model ?? form.car_model, car_year: mmy.year ?? form.car_year })
                    }
                    testIdPrefix={addingVehicle ? "new-veh" : "new-repair"}
                  />
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5"><Label className="text-xs">{t("color")}</Label>
                      <Input value={addingVehicle ? newVehicle.color : form.car_color} onChange={(e) => addingVehicle ? setNewVehicle({ ...newVehicle, color: e.target.value }) : setForm({ ...form, car_color: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("odometer")} (km)</Label>
                      <Input value={addingVehicle ? newVehicle.km : form.car_km} onChange={(e) => addingVehicle ? setNewVehicle({ ...newVehicle, km: e.target.value }) : setForm({ ...form, car_km: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("apkExpiry")}</Label>
                      <Input type="date" value={addingVehicle ? newVehicle.apk_expiry : form.car_apk_expiry} onChange={(e) => addingVehicle ? setNewVehicle({ ...newVehicle, apk_expiry: e.target.value }) : setForm({ ...form, car_apk_expiry: e.target.value })} data-testid="new-repair-apk" /></div>
                    {addingVehicle && (
                      <div className="space-y-1.5"><Label className="text-xs">{t("nextOilChangeKm")}</Label>
                        <Input type="number" value={newVehicle.next_oil_change_km} onChange={(e) => setNewVehicle({ ...newVehicle, next_oil_change_km: e.target.value })} placeholder="145000" data-testid="new-veh-oil" /></div>
                    )}
                  </div>

                  {/* Auto-imported RDW technical details — visible only when saving to a customer */}
                  {addingVehicle && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border/50">
                      <div className="space-y-1"><Label className="text-[10px]">Brandstof</Label><Input value={newVehicle.fuel} onChange={(e) => setNewVehicle({ ...newVehicle, fuel: e.target.value })} placeholder="Benzine / Diesel" /></div>
                      <div className="space-y-1"><Label className="text-[10px]">CC</Label><Input value={newVehicle.cc} onChange={(e) => setNewVehicle({ ...newVehicle, cc: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Deuren</Label><Input value={newVehicle.doors} onChange={(e) => setNewVehicle({ ...newVehicle, doors: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Zitpl.</Label><Input value={newVehicle.seats} onChange={(e) => setNewVehicle({ ...newVehicle, seats: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Gewicht (kg)</Label><Input value={newVehicle.weight} onChange={(e) => setNewVehicle({ ...newVehicle, weight: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-[10px]">Tenaamstelling</Label><Input type="date" value={newVehicle.registration_date} onChange={(e) => setNewVehicle({ ...newVehicle, registration_date: e.target.value })} /></div>
                      <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">Chassis loc.</Label><Input value={newVehicle.chassis_location} onChange={(e) => setNewVehicle({ ...newVehicle, chassis_location: e.target.value })} /></div>
                      <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">Meldcode voertuig <span className="text-[9px] text-muted-foreground">(privé — يُدخل يدوياً)</span></Label><Input value={newVehicle.meldcode} onChange={(e) => setNewVehicle({ ...newVehicle, meldcode: e.target.value })} placeholder="4-cijferige code" className="font-mono" data-testid="new-veh-meldcode" /></div>
                      <div className="space-y-1 md:col-span-2"><Label className="text-[10px]">VIN <span className="text-[9px] text-muted-foreground">(privé — يُدخل يدوياً)</span></Label><Input value={newVehicle.vin} onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value })} placeholder="17 حرف/رقم" className="font-mono" data-testid="new-veh-vin" /></div>
                    </div>
                  )}

                  {addingVehicle && (
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingVehicle(false); setNewVehicle(EMPTY_VEHICLE); }}>Cancel</Button>
                      <Button type="button" size="sm" onClick={saveVehicle} disabled={busy} className="rounded-full" data-testid="new-card-save-vehicle"><Plus className="h-3.5 w-3.5 mr-1" />Save vehicle</Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ---- ASSIGN + COMPLAINT ---- */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="text-xs font-mono uppercase tracking-widest text-primary">3 · Job details</div>
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
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || addingVehicle} className="rounded-full bg-primary" data-testid="new-repair-submit">
                {busy ? "..." : "Open card"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quick "New customer" modal — mirrors the full form on the Customers page */}
      <Dialog open={showNewCustomer} onOpenChange={(v) => { setShowNewCustomer(v); if (!v) setNewCustomer(EMPTY_NEW_CUST); }}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{t("newCustomer") || "New customer"}</DialogTitle>
            <DialogDescription>Save the customer once — later you'll just pick them from the list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Individual / Company toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-muted/40 rounded-full border border-border" data-testid="quick-cust-type-toggle">
              <button
                type="button"
                onClick={() => setNewCustomer({ ...newCustomer, customer_type: "individual" })}
                className={`h-9 rounded-full text-sm font-medium transition-colors ${newCustomer.customer_type !== "company" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="quick-cust-type-individual"
              >
                <span className="inline-flex items-center gap-1.5"><span>👤</span>{t("customerTypeIndividual")}</span>
              </button>
              <button
                type="button"
                onClick={() => setNewCustomer({ ...newCustomer, customer_type: "company" })}
                className={`h-9 rounded-full text-sm font-medium transition-colors ${newCustomer.customer_type === "company" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="quick-cust-type-company"
              >
                <span className="inline-flex items-center gap-1.5"><span>🏢</span>{t("customerTypeCompany")}</span>
              </button>
            </div>

            {/* KvK hero for companies */}
            {newCustomer.customer_type === "company" && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2" data-testid="quick-kvk-hero">
                <div className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{t("kvkLookup")}</div>
                </div>
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-9 space-y-1">
                    <Label className="text-[10px]">{t("kvkNumber")}</Label>
                    <Input
                      value={newCustomer.kvk_number}
                      onChange={(e) => setNewCustomer({ ...newCustomer, kvk_number: e.target.value.replace(/[^0-9]/g, "").slice(0, 8) })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); kvkLookup(); } }}
                      placeholder="12345678"
                      className="h-10 font-mono tracking-wider"
                      data-testid="quick-cust-kvk-input"
                    />
                  </div>
                  <div className="col-span-3">
                    <Button type="button" className="w-full h-10 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm disabled:opacity-60"
                      onClick={kvkLookup}
                      disabled={kvkBusy || !newCustomer.kvk_number}
                      data-testid="quick-cust-kvk-btn"
                    >
                      {kvkBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                      KvK
                    </Button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  اختياري — إذا لم يعمل الاستيراد التلقائي، أكمل الحقول يدوياً في الأسفل.
                </p>
              </div>
            )}

            {/* Company-only fields */}
            {newCustomer.customer_type === "company" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>{t("companyName")} *</Label>
                  <Input required value={newCustomer.company_name} onChange={(e) => setNewCustomer({ ...newCustomer, company_name: e.target.value, name: e.target.value })} data-testid="quick-cust-company-name" /></div>
                <div className="space-y-1.5"><Label>{t("vatNumber")}</Label>
                  <Input value={newCustomer.vat_number} onChange={(e) => setNewCustomer({ ...newCustomer, vat_number: e.target.value.toUpperCase() })} placeholder="NL812345678B01" className="font-mono" data-testid="quick-cust-vat-input" /></div>
                <div className="space-y-1.5 col-span-2"><Label>{t("contactPerson")}</Label>
                  <Input value={newCustomer.contact_person} onChange={(e) => setNewCustomer({ ...newCustomer, contact_person: e.target.value })} placeholder={t("contactPersonPlaceholder")} data-testid="quick-cust-contact-person" /></div>
              </div>
            )}

            {/* Name (individual) */}
            {newCustomer.customer_type !== "company" && (
              <div className="space-y-1.5"><Label>{t("name")} *</Label><Input required value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} data-testid="quick-new-customer-name" /></div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>{t("phone")}</Label><Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} data-testid="quick-new-customer-phone" /></div>
              <div className="space-y-1.5"><Label>{t("email")}</Label><Input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} data-testid="quick-new-customer-email" /></div>
            </div>

            <div className="space-y-2 p-3 rounded-md border border-border bg-muted/20">
              <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("address")}</div>
              <AddressFields
                value={{
                  postcode: newCustomer.postcode,
                  house_number: newCustomer.house_number,
                  house_number_addition: newCustomer.house_number_addition,
                  street: newCustomer.street,
                  city: newCustomer.city,
                  address_country: newCustomer.address_country,
                }}
                onChange={(a) => setNewCustomer({ ...newCustomer, ...a })}
                testIdPrefix="quick-cust-addr"
                compact
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewCustomer(false)}>{t("cancel") || "Cancel"}</Button>
            <Button onClick={createNewCustomer} disabled={busy} className="rounded-full bg-primary" data-testid="quick-new-customer-save">
              <UserPlus className="h-4 w-4 mr-2" />{busy ? "..." : (t("addCustomer") || "Add customer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
