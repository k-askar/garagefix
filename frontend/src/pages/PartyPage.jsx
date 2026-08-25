import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, formatEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Printer, FileDown, FileText, Eye, Pencil, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";
import { downloadListReportPdf, printListReport, downloadCustomerHistoryPdf, printCustomerHistory } from "@/lib/reports";
import PlateBadge from "@/components/PlateBadge";
import AddressFields from "@/components/AddressFields";
import VehicleMakeModelYear from "@/components/VehicleMakeModelYear";
import CustomerVehiclesEditor from "@/components/CustomerVehiclesEditor";
import CarPassportQrDialog from "@/components/CarPassportQrDialog";
import CsvImportDialog from "@/components/CsvImportDialog";
import { Progress } from "@/components/ui/progress";
import { QrCode, Gift, Upload } from "lucide-react";

export default function PartyPage({ kind }) {
  const qc = useQueryClient();
  const { t, meta } = useLang();
  const isSup = kind === "suppliers";
  const label = isSup ? t("supplier") : t("customer");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState(null);   // when set, the same dialog is used to update
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", contact: "", vehicle: "", postcode: "", house_number: "", house_number_addition: "", street: "", city: "", address_country: "NL" });
  const [vehForm2, setVehForm2] = useState({ make: "", model: "", year: "", plate: "", color: "", km: "", country: "NL", apk_expiry: "", next_oil_change_km: "" });
  const [exporting, setExporting] = useState(false);
  const [historyId, setHistoryId] = useState(null);
  const [downloadingHistoryId, setDownloadingHistoryId] = useState(null);
  const [vehForm, setVehForm] = useState({ make: "", model: "", year: "", plate: "", color: "", km: "", vin: "", notes: "", country: "NL", apk_expiry: "", next_oil_change_km: "" });
  const [showAddVeh, setShowAddVeh] = useState(false);
  const [passportVehicle, setPassportVehicle] = useState(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [rdwBusy, setRdwBusy] = useState("");   // "new-cust" | "add-veh" | ""

  /* Query RDW open data and merge the result into a form-state setter.
     Never overwrites existing values with blanks. */
  const rdwLookupInto = async (plate, country, applyPatch, key) => {
    if (country !== "NL") return toast.error("RDW = NL only");
    const cleaned = (plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!cleaned || cleaned.length < 4) return toast.error(t("rdwEnterPlate"));
    setRdwBusy(key);
    try {
      const { data } = await api.get(`/rdw/lookup?plate=${encodeURIComponent(cleaned)}`);
      const patch = {};
      ["make", "model", "year", "color", "country", "apk_expiry"].forEach(k => { if (data[k]) patch[k] = data[k]; });
      patch.plate = data.plate;
      const extras = [];
      if (data.fuel) extras.push(data.fuel);
      if (data.cc) extras.push(`${data.cc}cc`);
      if (data.doors) extras.push(`${data.doors}-drs`);
      if (data.chassis_location) extras.push(`VIN @ ${data.chassis_location}`);
      if (extras.length) patch.notes = extras.join(" · ");
      applyPatch(patch);
      toast.success(`${data.make} ${data.model} ${data.year}`.trim() + " · RDW ✓");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "RDW lookup failed");
    } finally { setRdwBusy(""); }
  };

  const { data: loyalty } = useQuery({
    queryKey: ["customer-loyalty", historyId],
    queryFn: () => api.get(`/customers/${historyId}/loyalty`).then(r => r.data),
    enabled: !!historyId && !isSup,
  });

  const { data: rows = [] } = useQuery({ queryKey: [kind], queryFn: () => api.get(`/${kind}`).then((r) => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });
  const { data: history, refetch: refetchHistory } = useQuery({
    queryKey: ["customer-history", historyId],
    queryFn: () => api.get(`/customers/${historyId}/history`).then(r => r.data),
    enabled: !!historyId && !isSup,
  });

  const addVehicle = async (e) => {
    e.preventDefault();
    if (!vehForm.make && !vehForm.plate) return toast.error(t("nameRequired"));
    try {
      await api.post(`/customers/${historyId}/vehicles`, vehForm);
      toast.success(t("vehicleAdded"));
      setVehForm({ make: "", model: "", year: "", plate: "", color: "", km: "", vin: "", notes: "" });
      setShowAddVeh(false);
      refetchHistory();
      // Also invalidate the vehicle queries used elsewhere (job-card dialog, calendar…)
      qc.invalidateQueries({ queryKey: ["cust-vehicles", historyId] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const deleteVehicle = async (vid) => {
    if (!window.confirm(t("deleteVehicleConfirm"))) return;
    try {
      await api.delete(`/vehicles/${vid}`);
      toast.success(t("vehicleDeleted"));
      refetchHistory();
      qc.invalidateQueries({ queryKey: ["cust-vehicles", historyId] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editId) {
        // UPDATE
        const patch = { ...form };
        if (isSup) delete patch.vehicle;
        await api.put(`/${kind}/${editId}`, patch);
        toast.success(t("updated"));
      } else {
        const summaryVehicle = isSup ? "" : [vehForm2.make, vehForm2.model, vehForm2.year, vehForm2.plate].filter(Boolean).join(" ");
        const { data: created } = await api.post(`/${kind}`, { ...form, vehicle: summaryVehicle || form.vehicle });
        if (!isSup && (vehForm2.make || vehForm2.plate)) {
          try {
            await api.post(`/customers/${created.id}/vehicles`, vehForm2);
            // Warm the vehicle cache for the newly-created customer so the
            // job-card dialog sees the vehicle immediately.
            qc.invalidateQueries({ queryKey: ["cust-vehicles", created.id] });
          } catch (err) { /* silent — customer is saved even if vehicle fails */ }
        }
        toast.success(`${label} added`);
      }
      setForm({ name: "", email: "", phone: "", address: "", contact: "", vehicle: "", postcode: "", house_number: "", house_number_addition: "", street: "", city: "", address_country: "NL" });
      setVehForm2({ make: "", model: "", year: "", plate: "", color: "", km: "" });
      setEditId(null);
      setOpen(false);
      qc.invalidateQueries({ queryKey: [kind] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      name: row.name || "",
      email: row.email || "",
      phone: row.phone || "",
      address: row.address || "",
      contact: row.contact || "",
      vehicle: row.vehicle || "",
      postcode: row.postcode || "",
      house_number: row.house_number || "",
      house_number_addition: row.house_number_addition || "",
      street: row.street || "",
      city: row.city || "",
      address_country: row.address_country || "NL",
    });
    setVehForm2({ make: "", model: "", year: "", plate: "", color: "", km: "" });
    setOpen(true);
  };

  const del = async (id) => {
    if (!window.confirm(`Delete this ${label.toLowerCase()}?`)) return;
    try { await api.delete(`/${kind}/${id}`); toast.success("Deleted"); qc.invalidateQueries({ queryKey: [kind] }); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const historyLabels = () => ({
    customerReport: t("customerReport"), customer: t("customer"), phone: t("phone"), email: t("email"),
    address: t("address"), vehicle: t("vehicle"),
    firstVisit: t("firstVisit"), lastVisit: t("lastVisit"),
    repairs: t("jobCards"), invoices: t("invoices"), parts: t("parts"), labor: t("labor"),
    lifetimeSpend: t("lifetimeSpend"), paid: t("paid"), unpaid: t("due"),
    jobCard: t("jobCards"), date: t("date"), vehicleCol: t("vehicle"), mechanic: t("mechanic"),
    status: t("status"), partsCol: t("parts") + " (€)", laborCol: t("labor") + " (€)", totalCol: t("total") + " (€)",
    complaint: t("customerComplaint"), workDone: t("workPerformed"), partsUsed: t("partsUsed"),
    minutes: t("minutes") || "min", noRepairs: t("noRepairsOnFile"),
    invoiceNumber: t("invoiceNumber"), invoiceStatus: t("status"), invoiceTotal: t("total"),
    invoiceDate: t("createdAt"), paidAt: t("paidAt"), method: t("paymentMethod"),
    footerNote: t("customerHistoryFooter"),
    visits: t("visits"), lastServiced: t("lastServiced"), perVehicleTimeline: t("perVehicleTimeline"),
  });

  const downloadCustomerPdf = async (cid) => {
    setDownloadingHistoryId(cid);
    try {
      const { data } = await api.get(`/customers/${cid}/history`);
      await downloadCustomerHistoryPdf(data, settings, meta.dir, historyLabels());
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setDownloadingHistoryId(null); }
  };

  const printCustomerReport = async () => {
    if (!history) return;
    printCustomerHistory(history, settings, meta.dir, historyLabels());
  };

  const exportReport = async (mode) => {
    const args = {
      title: isSup ? t("suppliers") : t("customers"),
      subtitle: `${rows.length} ${isSup ? t("suppliersOnFile") : t("customersOnFile")}`,
      headers: [t("name"), isSup ? t("contact") : t("vehicle"), t("email"), t("phone"), t("address")],
      rows: rows.map(r => [r.name, isSup ? (r.contact || "—") : (r.vehicle || "—"), r.email || "—", r.phone || "—", r.address || "—"]),
      settings, dir: meta.dir, lang: meta.locale?.slice(0, 2),
    };
    if (mode === "pdf") {
      setExporting(true);
      try { await downloadListReportPdf(args); } finally { setExporting(false); }
    } else printListReport(args);
  };

  return (
    <div className="space-y-8" data-testid={`${kind}-page`}>
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("directory")}</div>
          <h1 className="font-display text-4xl font-black tracking-tight">{isSup ? t("suppliers") : t("customers")}</h1>
          <p className="text-muted-foreground mt-2">{rows.length} {isSup ? t("suppliersOnFile") : t("customersOnFile")}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="rounded-full" onClick={() => exportReport("print")} data-testid={`${kind}-print-button`}>
            <Printer className="h-4 w-4 mr-2" /> {t("print")}
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => exportReport("pdf")} disabled={exporting} data-testid={`${kind}-pdf-button`}>
            <FileDown className="h-4 w-4 mr-2" /> {exporting ? t("loading") : t("pdf")}
          </Button>
          {!isSup && (
            <Button variant="outline" className="rounded-full" onClick={() => setCsvOpen(true)} data-testid="customers-csv-import">
              <Upload className="h-4 w-4 mr-2" /> Import CSV
            </Button>
          )}
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setForm({ name: "", email: "", phone: "", address: "", contact: "", vehicle: "", postcode: "", house_number: "", house_number_addition: "", street: "", city: "", address_country: "NL" }); } }}>
            <DialogTrigger asChild>
              <Button className="rounded-full bg-primary hover:bg-primary/90" data-testid={`add-${kind}-button`}>
                <Plus className="h-4 w-4 mr-2" /> {isSup ? t("newSupplier") : t("newCustomer")}
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display">{editId ? (isSup ? t("editSupplier") : t("editCustomer")) : `Add ${label}`}</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5"><Label>{t("name")}</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid={`${kind}-name`} /></div>
              {isSup && <div className="space-y-1.5"><Label>{t("contactPerson")}</Label><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>}
              {!isSup && editId && (
                <CustomerVehiclesEditor customerId={editId} />
              )}
              {!isSup && !editId && (
                <div className="space-y-2 p-3 rounded-md border border-border bg-muted/20">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("vehicle")} · {t("optional")}</div>

                  {/* RDW hero — plate + country + big search first */}
                  <div className="rounded-md border border-orange-500/40 bg-orange-500/5 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                      <div className="text-[10px] font-mono uppercase tracking-widest text-orange-700 dark:text-orange-400">{t("rdwLookup")}</div>
                    </div>
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4 space-y-1">
                        <Label className="text-[10px]">{t("country")}</Label>
                        <select value={vehForm2.country} onChange={(e) => setVehForm2({ ...vehForm2, country: e.target.value })} className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm" data-testid="new-cust-veh-country">
                          <option value="NL">NL</option><option value="DE">DE</option><option value="BE">BE</option><option value="FR">FR</option>
                          <option value="IT">IT</option><option value="ES">ES</option><option value="PL">PL</option><option value="TR">TR</option>
                          <option value="MA">MA</option><option value="SY">SY</option><option value="LB">LB</option><option value="JO">JO</option>
                          <option value="IQ">IQ</option><option value="EG">EG</option><option value="SA">SA</option><option value="AE">AE</option>
                          <option value="GB">GB</option><option value="OTHER">Other</option>
                        </select>
                      </div>
                      <div className="col-span-5 space-y-1">
                        <Label className="text-[10px]">{t("plateNumber")}</Label>
                        <Input value={vehForm2.plate} onChange={(e) => setVehForm2({ ...vehForm2, plate: e.target.value.toUpperCase() })}
                          onKeyDown={(e) => { if (e.key === "Enter" && vehForm2.country === "NL") { e.preventDefault(); rdwLookupInto(vehForm2.plate, vehForm2.country, (p) => setVehForm2(f => ({ ...f, ...p })), "new-cust"); } }}
                          placeholder="12-ABC-3" className="h-10 font-mono tracking-wider" data-testid="new-cust-veh-plate" />
                      </div>
                      <div className="col-span-3">
                        <Button type="button" className="w-full h-10 rounded-md bg-orange-500 hover:bg-orange-600 text-white shadow-sm disabled:opacity-60"
                          onClick={() => rdwLookupInto(vehForm2.plate, vehForm2.country, (p) => setVehForm2(f => ({ ...f, ...p })), "new-cust")}
                          disabled={rdwBusy === "new-cust" || vehForm2.country !== "NL" || !vehForm2.plate}
                          title={vehForm2.country !== "NL" ? "RDW = NL only" : t("rdwLookup")}
                          data-testid="new-cust-veh-rdw"
                        >
                          {rdwBusy === "new-cust" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                          RDW
                        </Button>
                      </div>
                    </div>
                  </div>

                  <VehicleMakeModelYear
                    value={{ make: vehForm2.make, model: vehForm2.model, year: vehForm2.year }}
                    onChange={(mmy) => setVehForm2({ ...vehForm2, ...mmy })}
                    testIdPrefix="new-cust-veh"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label className="text-xs">{t("color")}</Label><Input value={vehForm2.color} onChange={(e) => setVehForm2({ ...vehForm2, color: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("odometer")}</Label><Input value={vehForm2.km} onChange={(e) => setVehForm2({ ...vehForm2, km: e.target.value })} placeholder="km" /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("apkExpiry")}</Label><Input type="date" value={vehForm2.apk_expiry} onChange={(e) => setVehForm2({ ...vehForm2, apk_expiry: e.target.value })} data-testid="new-cust-veh-apk" /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("nextOilChangeKm")}</Label><Input type="number" value={vehForm2.next_oil_change_km} onChange={(e) => setVehForm2({ ...vehForm2, next_oil_change_km: e.target.value })} placeholder="e.g. 145000" data-testid="new-cust-veh-oil" /></div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{t("addMoreVehiclesHint")}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>{t("email")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
              <div className="space-y-2 p-3 rounded-md border border-border bg-muted/20">
                <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("address")}</div>
                <AddressFields
                  value={{
                    postcode: form.postcode,
                    house_number: form.house_number,
                    house_number_addition: form.house_number_addition,
                    street: form.street,
                    city: form.city,
                    address_country: form.address_country,
                  }}
                  onChange={(a) => setForm({ ...form, ...a })}
                  testIdPrefix={`${kind}-addr`}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
                <Button type="submit" className="rounded-full" data-testid={`${kind}-save`}>{t("save")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>{isSup ? "Contact" : "Vehicle"}</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-right w-20">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={!isSup ? "cursor-pointer hover:bg-accent/40" : ""} onClick={() => !isSup && setHistoryId(r.id)} data-testid={`${kind}-row-${r.id}`}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-muted-foreground">{isSup ? r.contact : r.vehicle}</TableCell>
                <TableCell className="text-muted-foreground">{r.email}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">{r.phone}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{r.address}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {!isSup && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => setHistoryId(r.id)} data-testid={`view-customer-${r.id}`} title={t("viewHistory")}><Eye className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" disabled={downloadingHistoryId === r.id} onClick={() => downloadCustomerPdf(r.id)} data-testid={`pdf-customer-${r.id}`} title={t("customerReport")}><FileText className="h-4 w-4 text-primary" /></Button>
                      </>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)} data-testid={`edit-${kind}-${r.id}`} title={isSup ? t("editSupplier") : t("editCustomer")}><Pencil className="h-4 w-4 text-primary" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(r.id)} data-testid={`del-${kind}-${r.id}`}><Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-16 text-muted-foreground">No {kind} yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {!isSup && (
        <Dialog open={!!historyId} onOpenChange={(v) => { if (!v) setHistoryId(null); }}>
          <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="customer-history-dialog">
            <DialogHeader>
              <DialogTitle className="font-display flex items-center gap-3">
                <span>{t("customerReport")}</span>
                <span className="text-primary">·</span>
                <span className="font-mono text-sm text-muted-foreground">{history?.customer?.name}</span>
              </DialogTitle>
            </DialogHeader>
            {!history ? (
              <div className="py-16 text-center text-muted-foreground text-sm">{t("loading")}</div>
            ) : (
              <div className="space-y-6">
                {/* Header */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Card className="p-4 border-border">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("customer")}</div>
                    <div className="font-display text-lg font-bold mt-1">{history.customer?.name}</div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <div>{history.customer?.phone} {history.customer?.email && `· ${history.customer.email}`}</div>
                      <div>{history.customer?.address || ""}</div>
                    </div>
                  </Card>
                  <Card className="p-4 border-border">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("vehicle")}</div>
                    <div className="font-display text-lg font-bold mt-1">{history.customer?.vehicle || "—"}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <div>{t("firstVisit")}: {history.first_visit ? new Date(history.first_visit).toLocaleDateString(meta.locale) : "—"}</div>
                      <div>{t("lastVisit")}: {history.last_visit ? new Date(history.last_visit).toLocaleDateString(meta.locale) : "—"}</div>
                    </div>
                  </Card>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { l: t("jobCards"), v: history.repair_count, mono: true },
                    { l: t("invoices"), v: history.invoice_count, mono: true },
                    { l: t("paid"), v: formatEUR(history.paid), accent: "text-emerald-700 dark:text-emerald-400" },
                    { l: t("due"), v: formatEUR(history.unpaid), accent: history.unpaid > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400" },
                    { l: t("parts"), v: formatEUR(history.total_parts) },
                    { l: t("labor"), v: formatEUR(history.total_labor) },
                    { l: t("lifetimeSpend"), v: formatEUR(history.total_spent), accent: "text-primary", wide: true },
                  ].map((k, i) => (
                    <Card key={i} className={`p-4 border-border ${k.wide ? "md:col-span-2 border-primary/30 bg-primary/5" : ""}`}>
                      <div className={`text-[10px] font-mono uppercase tracking-widest ${k.wide ? "text-primary" : "text-muted-foreground"}`}>{k.l}</div>
                      <div className={`font-display text-2xl font-bold tabular-nums mt-1 ${k.accent || ""} ${k.mono ? "font-mono" : ""}`}>{k.v}</div>
                    </Card>
                  ))}
                </div>

                {/* Loyalty progress */}
                {loyalty?.enabled && (
                  <Card className={`p-4 border ${loyalty.pending_rewards > 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-primary/30 bg-primary/5"}`} data-testid="loyalty-card">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${loyalty.pending_rewards > 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-primary/15 text-primary"}`}>
                          <Gift className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Loyalty</div>
                          {loyalty.pending_rewards > 0 ? (
                            <div className="font-display text-lg font-bold text-emerald-700 dark:text-emerald-400" data-testid="loyalty-pending">
                              {loyalty.pending_rewards} reward{loyalty.pending_rewards > 1 ? "s" : ""} ready · {formatEUR(loyalty.discount_eur)} off next invoice{loyalty.pending_rewards > 1 ? "s" : ""}
                            </div>
                          ) : (
                            <div className="font-display text-lg font-bold" data-testid="loyalty-progress">
                              {loyalty.progress_in_cycle} / {loyalty.threshold} paid invoices · {loyalty.next_reward_in} to next {formatEUR(loyalty.discount_eur)} reward
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="min-w-[160px] flex-1 md:max-w-[240px]">
                        <Progress
                          value={(loyalty.progress_in_cycle / Math.max(loyalty.threshold, 1)) * 100}
                          className="h-2"
                        />
                        <div className="text-[10px] font-mono text-muted-foreground mt-1 text-right">
                          {loyalty.redeemed_rewards} previously redeemed
                        </div>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Vehicles + per-vehicle timeline */}
                <Card className="border-border overflow-hidden">
                  <div className="p-4 border-b border-border flex items-center justify-between">
                    <div>
                      <div className="font-display text-lg font-bold">{t("vehicles")} · {history.vehicles?.length || 0}</div>
                      <div className="text-xs text-muted-foreground">{t("perVehicleTimeline")}</div>
                    </div>
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => setShowAddVeh(true)} data-testid="add-vehicle-btn">
                      <Plus className="h-3.5 w-3.5 mr-1" /> {t("addVehicle")}
                    </Button>
                  </div>

                  {showAddVeh && (
                    <form onSubmit={addVehicle} className="p-4 border-b border-border bg-muted/20 space-y-3" data-testid="add-vehicle-form">
                      {/* RDW hero */}
                      <div className="rounded-md border border-orange-500/40 bg-orange-500/5 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Search className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
                          <div className="text-[10px] font-mono uppercase tracking-widest text-orange-700 dark:text-orange-400">{t("rdwLookup")}</div>
                        </div>
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-4 space-y-1">
                            <Label className="text-[10px]">{t("country")}</Label>
                            <select value={vehForm.country} onChange={(e) => setVehForm({ ...vehForm, country: e.target.value })} className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm" data-testid="veh-country">
                              <option value="NL">NL</option><option value="DE">DE</option><option value="BE">BE</option><option value="FR">FR</option>
                              <option value="IT">IT</option><option value="ES">ES</option><option value="PL">PL</option><option value="TR">TR</option>
                              <option value="MA">MA</option><option value="SY">SY</option><option value="LB">LB</option><option value="JO">JO</option>
                              <option value="IQ">IQ</option><option value="EG">EG</option><option value="SA">SA</option><option value="AE">AE</option>
                              <option value="GB">GB</option><option value="OTHER">Other</option>
                            </select>
                          </div>
                          <div className="col-span-5 space-y-1">
                            <Label className="text-[10px]">{t("plateNumber")}</Label>
                            <Input value={vehForm.plate} onChange={(e) => setVehForm({ ...vehForm, plate: e.target.value.toUpperCase() })}
                              onKeyDown={(e) => { if (e.key === "Enter" && vehForm.country === "NL") { e.preventDefault(); rdwLookupInto(vehForm.plate, vehForm.country, (p) => setVehForm(f => ({ ...f, ...p })), "add-veh"); } }}
                              placeholder="12-ABC-3" className="h-10 font-mono tracking-wider" data-testid="veh-plate" />
                          </div>
                          <div className="col-span-3">
                            <Button type="button" className="w-full h-10 rounded-md bg-orange-500 hover:bg-orange-600 text-white shadow-sm disabled:opacity-60"
                              onClick={() => rdwLookupInto(vehForm.plate, vehForm.country, (p) => setVehForm(f => ({ ...f, ...p })), "add-veh")}
                              disabled={rdwBusy === "add-veh" || vehForm.country !== "NL" || !vehForm.plate}
                              data-testid="veh-rdw">
                              {rdwBusy === "add-veh" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                              RDW
                            </Button>
                          </div>
                        </div>
                      </div>

                      <VehicleMakeModelYear
                        value={{ make: vehForm.make, model: vehForm.model, year: vehForm.year }}
                        onChange={(mmy) => setVehForm({ ...vehForm, ...mmy })}
                        testIdPrefix="veh"
                      />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Input value={vehForm.color} onChange={(e) => setVehForm({ ...vehForm, color: e.target.value })} placeholder={t("color")} />
                        <Input value={vehForm.km} onChange={(e) => setVehForm({ ...vehForm, km: e.target.value })} placeholder={t("odometer")} />
                        <Input type="date" value={vehForm.apk_expiry} onChange={(e) => setVehForm({ ...vehForm, apk_expiry: e.target.value })} placeholder={t("apkExpiry")} title={t("apkExpiry")} data-testid="veh-apk" />
                        <Input type="number" value={vehForm.next_oil_change_km} onChange={(e) => setVehForm({ ...vehForm, next_oil_change_km: e.target.value })} placeholder={t("nextOilChangeKm")} title={t("nextOilChangeKm")} data-testid="veh-oil" />
                        <Input value={vehForm.vin} onChange={(e) => setVehForm({ ...vehForm, vin: e.target.value })} placeholder={`${t("vin")} — يُدخل يدوياً`} className="md:col-span-2" data-testid="veh-vin" />
                        <Input value={vehForm.notes} onChange={(e) => setVehForm({ ...vehForm, notes: e.target.value })} placeholder={t("note")} className="md:col-span-2" />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddVeh(false)}>{t("cancel")}</Button>
                        <Button type="submit" size="sm" className="rounded-full" data-testid="veh-save">{t("save")}</Button>
                      </div>
                    </form>
                  )}

                  <div className="divide-y divide-border">
                    {!(history.by_vehicle || []).length && (
                      <div className="p-8 text-center text-sm text-muted-foreground">{t("noVehicles")}</div>
                    )}
                    {(history.by_vehicle || []).map((g, i) => {
                      const v = g.vehicle || {};
                      const registered = !!v.id;
                      return (
                        <div key={v.id || `orphan-${i}`} className="p-4 space-y-3" data-testid={`vehicle-group-${v.plate || i}`}>
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-display text-base font-bold">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}</div>
                                {v.plate && <PlateBadge plate={v.plate} country={v.country || "NL"} size="xs" />}
                                {v.apk_expiry && (
                                  <Badge variant="outline" className="text-[10px] font-mono" title={`APK expiry: ${v.apk_expiry}`}>APK · {v.apk_expiry}</Badge>
                                )}
                                {v.next_oil_change_km && (
                                  <Badge variant="outline" className="text-[10px] font-mono" title={`Next oil change at ${v.next_oil_change_km} km`}>OIL · {v.next_oil_change_km} km</Badge>
                                )}
                                {!registered && <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[10px]">{t("walkInVehicle")}</Badge>}
                              </div>
                              <div className="text-[11px] text-muted-foreground font-mono mt-1 flex gap-3 flex-wrap">
                                {v.color && <span>{v.color}</span>}
                                {v.vin && <span>VIN: {v.vin}</span>}
                                {v.km && <span>{v.km} km</span>}
                                <span>{t("visits")}: {g.repair_count}</span>
                                {g.first_visit && <span>{t("firstVisit")}: {new Date(g.first_visit).toLocaleDateString(meta.locale)}</span>}
                                {g.last_visit && <span>{t("lastServiced")}: {new Date(g.last_visit).toLocaleDateString(meta.locale)}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("total")}</div>
                                <div className="font-mono font-bold text-lg tabular-nums text-primary">{formatEUR(g.total_spent)}</div>
                              </div>
                              {registered && (
                                <Button size="icon" variant="ghost" onClick={() => setPassportVehicle(v)} data-testid={`veh-qr-${v.id}`} title="Car passport QR">
                                  <QrCode className="h-4 w-4 text-primary" />
                                </Button>
                              )}
                              {registered && (
                                <Button size="icon" variant="ghost" onClick={() => deleteVehicle(v.id)} data-testid={`del-vehicle-${v.id}`}>
                                  <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                                </Button>
                              )}
                            </div>
                          </div>

                          {g.repairs.length === 0 ? (
                            <div className="p-3 text-xs text-muted-foreground text-center border border-dashed border-border rounded-md">{t("noRepairsForVehicle")}</div>
                          ) : (
                            <>
                              {registered && v.id && <VehicleServiceHistory vehicleId={v.id} />}
                              <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow className="hover:bg-transparent">
                                    <TableHead className="text-[10px]">#</TableHead>
                                    <TableHead className="text-[10px]">{t("date")}</TableHead>
                                    <TableHead className="text-[10px]">{t("customerComplaint")}</TableHead>
                                    <TableHead className="text-[10px]">{t("workPerformed")}</TableHead>
                                    <TableHead className="text-[10px]">{t("mechanic")}</TableHead>
                                    <TableHead className="text-[10px]">{t("status")}</TableHead>
                                    <TableHead className="text-[10px] text-right">{t("total")}</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {g.repairs.map(r => (
                                    <TableRow key={r.id} data-testid={`veh-repair-${r.card_number}`}>
                                      <TableCell className="font-mono text-[11px]">{r.card_number}</TableCell>
                                      <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleDateString(meta.locale, { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                                      <TableCell className="text-xs max-w-[180px] truncate" title={r.complaint || ""}>{r.complaint || "—"}</TableCell>
                                      <TableCell className="text-xs max-w-[220px] truncate" title={r.work_done || ""}>{r.work_done || "—"}</TableCell>
                                      <TableCell className="text-xs">{r.mechanic_name || "—"}</TableCell>
                                      <TableCell>
                                        <Badge className={`text-[10px] ${r.status === "completed" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" : r.status === "in_progress" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"}`}>{r.status}</Badge>
                                      </TableCell>
                                      <TableCell className="text-right tabular-nums font-mono font-bold text-xs">{formatEUR(r.grand_total)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Invoices */}
                {(history.invoices || []).length > 0 && (
                  <Card className="border-border overflow-x-auto">
                    <div className="p-4 border-b border-border font-display text-lg font-bold">{t("invoices")}</div>
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>{t("invoiceNumber")}</TableHead>
                          <TableHead>{t("createdAt")}</TableHead>
                          <TableHead>{t("paidAt")}</TableHead>
                          <TableHead>{t("paymentMethod")}</TableHead>
                          <TableHead>{t("status")}</TableHead>
                          <TableHead className="text-right">{t("total")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.invoices.map(inv => (
                          <TableRow key={inv.id} data-testid={`history-invoice-${inv.invoice_number}`}>
                            <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                            <TableCell className="text-xs">{new Date(inv.created_at).toLocaleDateString(meta.locale, { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                            <TableCell className="text-xs">{inv.paid_at ? new Date(inv.paid_at).toLocaleString(meta.locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{inv.payment_method_name || "—"}</TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] ${inv.status === "paid" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" : "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"}`}>{inv.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-mono font-bold">{formatEUR(inv.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setHistoryId(null)}>{t("close")}</Button>
              <Button variant="outline" className="rounded-full" onClick={printCustomerReport} disabled={!history} data-testid="customer-history-print">
                <Printer className="h-4 w-4 mr-2" /> {t("print")}
              </Button>
              <Button className="rounded-full bg-primary hover:bg-primary/90" onClick={() => downloadCustomerPdf(historyId)} disabled={!history || downloadingHistoryId === historyId} data-testid="customer-history-pdf">
                <FileDown className="h-4 w-4 mr-2" /> {t("pdf")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {!isSup && (
        <>
          <CarPassportQrDialog
            vehicle={passportVehicle}
            open={!!passportVehicle}
            onOpenChange={(v) => { if (!v) setPassportVehicle(null); }}
          />
          <CsvImportDialog
            open={csvOpen}
            onOpenChange={setCsvOpen}
            onDone={() => { qc.invalidateQueries({ queryKey: ["customers"] }); qc.invalidateQueries({ queryKey: [kind] }); }}
          />
        </>
      )}
    </div>
  );
}

/* Tiny inline component that fetches + renders the APK/oil timeline for a vehicle. */
function VehicleServiceHistory({ vehicleId }) {
  const { data } = useQuery({
    queryKey: ["veh-history", vehicleId],
    queryFn: () => api.get(`/vehicles/${vehicleId}/history`).then(r => r.data),
    enabled: !!vehicleId,
  });
  const events = data?.events || [];
  if (events.length === 0) return null;
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-1.5" data-testid={`veh-history-${vehicleId}`}>
      <div className="text-[10px] font-mono uppercase tracking-widest text-primary mb-1">Service history · {events.length} event(s)</div>
      <ul className="space-y-1">
        {events.map((e) => (
          <li key={e.id} className="text-[11px] font-mono flex items-center gap-2 flex-wrap">
            <span className={`inline-block h-2 w-2 rounded-full ${e.kind === "apk_renewal" ? "bg-emerald-500" : "bg-sky-500"}`} />
            <span className="text-muted-foreground">{new Date(e.at).toLocaleDateString()}</span>
            <span className="font-semibold uppercase">{e.kind === "apk_renewal" ? "APK renewed" : "Oil change"}</span>
            {e.km && <span className="text-muted-foreground">at {e.km} km</span>}
            <span>→ <strong>{e.new_value}</strong></span>
            {e.previous_value && <span className="text-muted-foreground">(was {e.previous_value})</span>}
            {e.card_number && <span className="text-muted-foreground">· {e.card_number}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
