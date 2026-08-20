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
import { Plus, Trash2, Printer, FileDown, FileText, Eye } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";
import { downloadListReportPdf, printListReport, downloadCustomerHistoryPdf, printCustomerHistory } from "@/lib/reports";

export default function PartyPage({ kind }) {
  const qc = useQueryClient();
  const { t, meta } = useLang();
  const isSup = kind === "suppliers";
  const label = isSup ? t("supplier") : t("customer");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", contact: "", vehicle: "" });
  const [vehForm2, setVehForm2] = useState({ make: "", model: "", year: "", plate: "", color: "", km: "" });
  const [exporting, setExporting] = useState(false);
  const [historyId, setHistoryId] = useState(null);
  const [downloadingHistoryId, setDownloadingHistoryId] = useState(null);
  const [vehForm, setVehForm] = useState({ make: "", model: "", year: "", plate: "", color: "", km: "", vin: "", notes: "" });
  const [showAddVeh, setShowAddVeh] = useState(false);

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
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const deleteVehicle = async (vid) => {
    if (!window.confirm(t("deleteVehicleConfirm"))) return;
    try {
      await api.delete(`/vehicles/${vid}`);
      toast.success(t("vehicleDeleted"));
      refetchHistory();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const summaryVehicle = isSup ? "" : [vehForm2.make, vehForm2.model, vehForm2.year, vehForm2.plate].filter(Boolean).join(" ");
      const { data: created } = await api.post(`/${kind}`, { ...form, vehicle: summaryVehicle || form.vehicle });
      // If customer + at least make/plate provided, register the vehicle as a first-class record
      if (!isSup && (vehForm2.make || vehForm2.plate)) {
        try {
          await api.post(`/customers/${created.id}/vehicles`, vehForm2);
        } catch (err) { /* silent — customer is saved even if vehicle fails */ }
      }
      toast.success(`${label} added`);
      setForm({ name: "", email: "", phone: "", address: "", contact: "", vehicle: "" });
      setVehForm2({ make: "", model: "", year: "", plate: "", color: "", km: "" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: [kind] });
    } catch (e) { toast.error(formatApiError(e)); }
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
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full bg-primary hover:bg-primary/90" data-testid={`add-${kind}-button`}>
                <Plus className="h-4 w-4 mr-2" /> {isSup ? t("newSupplier") : t("newCustomer")}
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display">Add {label}</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5"><Label>{t("name")}</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid={`${kind}-name`} /></div>
              {isSup && <div className="space-y-1.5"><Label>{t("contactPerson")}</Label><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>}
              {!isSup && (
                <div className="space-y-2 p-3 rounded-md border border-border bg-muted/20">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("vehicle")} · {t("optional")}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5"><Label className="text-xs">{t("make")}</Label><Input value={vehForm2.make} onChange={(e) => setVehForm2({ ...vehForm2, make: e.target.value })} placeholder="e.g. VW, BMW, Toyota" data-testid="new-cust-veh-make" /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("model")}</Label><Input value={vehForm2.model} onChange={(e) => setVehForm2({ ...vehForm2, model: e.target.value })} placeholder="e.g. Golf, 320i" data-testid="new-cust-veh-model" /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("year")}</Label><Input value={vehForm2.year} onChange={(e) => setVehForm2({ ...vehForm2, year: e.target.value })} placeholder="2020" /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("plateNumber")}</Label><Input value={vehForm2.plate} onChange={(e) => setVehForm2({ ...vehForm2, plate: e.target.value })} placeholder="NL-XX-00" data-testid="new-cust-veh-plate" /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("color")}</Label><Input value={vehForm2.color} onChange={(e) => setVehForm2({ ...vehForm2, color: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label className="text-xs">{t("odometer")}</Label><Input value={vehForm2.km} onChange={(e) => setVehForm2({ ...vehForm2, km: e.target.value })} placeholder="km" /></div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{t("addMoreVehiclesHint")}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>{t("email")}</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("phone")}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>{t("address")}</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
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
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Input value={vehForm.make} onChange={(e) => setVehForm({ ...vehForm, make: e.target.value })} placeholder={t("make")} data-testid="veh-make" />
                        <Input value={vehForm.model} onChange={(e) => setVehForm({ ...vehForm, model: e.target.value })} placeholder={t("model")} data-testid="veh-model" />
                        <Input value={vehForm.year} onChange={(e) => setVehForm({ ...vehForm, year: e.target.value })} placeholder={t("year")} />
                        <Input value={vehForm.plate} onChange={(e) => setVehForm({ ...vehForm, plate: e.target.value })} placeholder={t("plateNumber")} data-testid="veh-plate" />
                        <Input value={vehForm.color} onChange={(e) => setVehForm({ ...vehForm, color: e.target.value })} placeholder={t("color")} />
                        <Input value={vehForm.km} onChange={(e) => setVehForm({ ...vehForm, km: e.target.value })} placeholder={t("odometer")} />
                        <Input value={vehForm.vin} onChange={(e) => setVehForm({ ...vehForm, vin: e.target.value })} placeholder={t("vin")} />
                        <Input value={vehForm.notes} onChange={(e) => setVehForm({ ...vehForm, notes: e.target.value })} placeholder={t("note")} />
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
                                {v.plate && <Badge variant="outline" className="font-mono text-[10px]">{v.plate}</Badge>}
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
                                <Button size="icon" variant="ghost" onClick={() => deleteVehicle(v.id)} data-testid={`del-vehicle-${v.id}`}>
                                  <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                                </Button>
                              )}
                            </div>
                          </div>

                          {g.repairs.length === 0 ? (
                            <div className="p-3 text-xs text-muted-foreground text-center border border-dashed border-border rounded-md">{t("noRepairsForVehicle")}</div>
                          ) : (
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
    </div>
  );
}
