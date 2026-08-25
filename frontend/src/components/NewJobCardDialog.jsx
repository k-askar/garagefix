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
import { UserPlus, Car, Plus, Sparkles } from "lucide-react";
import SearchableSelect from "@/components/SearchableSelect";
import PlateBadge from "@/components/PlateBadge";
import AddressFields from "@/components/AddressFields";
import VehicleMakeModelYear from "@/components/VehicleMakeModelYear";
import { toast } from "sonner";

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

const EMPTY_VEHICLE = { make: "", model: "", year: "", plate: "", color: "", km: "", country: "NL", apk_expiry: "" };

/**
 * NewJobCardDialog — a smarter, sectioned dialog for creating job cards.
 *  Step 1: Pick / create the CUSTOMER (auto-fills name + phone)
 *  Step 2: Pick / create the VEHICLE (auto-fills make/model/year/plate/km/country/apk)
 *  Step 3: Mechanic + complaint
 */
export default function NewJobCardDialog({ open, onOpenChange, customers, users, onCreated }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", email: "", address: "", postcode: "", house_number: "", house_number_addition: "", street: "", city: "", address_country: "NL" });
  const [newVehicle, setNewVehicle] = useState(EMPTY_VEHICLE);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [busy, setBusy] = useState(false);

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
    if (!newCustomer.name?.trim()) return toast.error("Customer name is required");
    setBusy(true);
    try {
      const { data } = await api.post("/customers", newCustomer);
      toast.success(`Customer ${data.name} added`);
      setForm(f => ({ ...f, customer_id: data.id, customer_name: data.name, customer_phone: data.phone || "" }));
      setNewCustomer({ name: "", phone: "", email: "", address: "", postcode: "", house_number: "", house_number_addition: "", street: "", city: "", address_country: "NL" });
      setShowNewCustomer(false);
      // Refresh the customer list dropdown so the newly-added customer appears
      // without needing a page reload.
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
                <div className="text-xs text-muted-foreground italic p-3 bg-muted/30 rounded-md">
                  This customer has no vehicles yet. Use <strong>+ New vehicle</strong> to add one.
                </div>
              )}

              {(addingVehicle || (!form.customer_id) || (!form.vehicle_id && cVehicles.length === 0 && form.customer_id)) && (
                <div className="space-y-3">
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
                    <div className="space-y-1.5"><Label className="text-xs">Plate</Label><Input value={addingVehicle ? newVehicle.plate : form.car_plate} onChange={(e) => addingVehicle ? setNewVehicle({ ...newVehicle, plate: e.target.value }) : setForm({ ...form, car_plate: e.target.value })} data-testid="new-repair-plate" /></div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Country</Label>
                      <select value={addingVehicle ? newVehicle.country : form.car_country} onChange={(e) => addingVehicle ? setNewVehicle({ ...newVehicle, country: e.target.value }) : setForm({ ...form, car_country: e.target.value })} className="w-full h-10 rounded-md border border-input bg-transparent px-3 text-sm" data-testid="new-repair-country">
                        {COUNTRIES.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5"><Label className="text-xs">Odometer (km)</Label><Input value={addingVehicle ? newVehicle.km : form.car_km} onChange={(e) => addingVehicle ? setNewVehicle({ ...newVehicle, km: e.target.value }) : setForm({ ...form, car_km: e.target.value })} /></div>
                    <div className="space-y-1.5 md:col-span-2"><Label className="text-xs">APK expiry</Label><Input type="date" value={addingVehicle ? newVehicle.apk_expiry : form.car_apk_expiry} onChange={(e) => addingVehicle ? setNewVehicle({ ...newVehicle, apk_expiry: e.target.value }) : setForm({ ...form, car_apk_expiry: e.target.value })} data-testid="new-repair-apk" /></div>
                    {addingVehicle && (
                      <div className="md:col-span-3 flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingVehicle(false); setNewVehicle(EMPTY_VEHICLE); }}>Cancel</Button>
                        <Button type="button" size="sm" onClick={saveVehicle} disabled={busy} className="rounded-full" data-testid="new-card-save-vehicle"><Plus className="h-3.5 w-3.5 mr-1" />Save vehicle</Button>
                      </div>
                    )}
                  </div>
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

      {/* Quick "New customer" modal */}
      <Dialog open={showNewCustomer} onOpenChange={setShowNewCustomer}>
        <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">New customer</DialogTitle>
            <DialogDescription>Save the customer once — later you'll just pick them from the list.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Name *</Label><Input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} data-testid="quick-new-customer-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Phone</Label><Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} data-testid="quick-new-customer-phone" /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} data-testid="quick-new-customer-email" /></div>
            </div>
            <div className="space-y-2 p-3 rounded-md border border-border bg-muted/20">
              <div className="text-[10px] font-mono uppercase tracking-widest text-primary">Address</div>
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
            <Button variant="ghost" onClick={() => setShowNewCustomer(false)}>Cancel</Button>
            <Button onClick={createNewCustomer} disabled={busy} className="rounded-full bg-primary" data-testid="quick-new-customer-save">
              <UserPlus className="h-4 w-4 mr-2" />{busy ? "..." : "Add customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
