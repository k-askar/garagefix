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
  const [exporting, setExporting] = useState(false);
  const [historyId, setHistoryId] = useState(null);
  const [downloadingHistoryId, setDownloadingHistoryId] = useState(null);

  const { data: rows = [] } = useQuery({ queryKey: [kind], queryFn: () => api.get(`/${kind}`).then((r) => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });
  const { data: history } = useQuery({
    queryKey: ["customer-history", historyId],
    queryFn: () => api.get(`/customers/${historyId}/history`).then(r => r.data),
    enabled: !!historyId && !isSup,
  });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/${kind}`, form);
      toast.success(`${label} added`);
      setForm({ name: "", email: "", phone: "", address: "", contact: "", vehicle: "" });
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
              {!isSup && <div className="space-y-1.5"><Label>{t("vehicle")}</Label><Input value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} placeholder={t("vehicleHint")} /></div>}
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
                    <Button size="icon" variant="ghost" onClick={() => del(r.id)} data-testid={`del-${kind}-${r.id}`}><Trash2 className="h-4 w-4 text-rose-400" /></Button>
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
                    { l: t("paid"), v: formatEUR(history.paid), accent: "text-emerald-400" },
                    { l: t("due"), v: formatEUR(history.unpaid), accent: history.unpaid > 0 ? "text-amber-400" : "text-emerald-400" },
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

                {/* Repairs */}
                <Card className="border-border overflow-x-auto">
                  <div className="p-4 border-b border-border font-display text-lg font-bold">{t("jobCards")}</div>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>{t("poNumber") || "#"}</TableHead>
                        <TableHead>{t("date")}</TableHead>
                        <TableHead>{t("vehicle")}</TableHead>
                        <TableHead>{t("mechanic")}</TableHead>
                        <TableHead>{t("status")}</TableHead>
                        <TableHead className="text-right">{t("parts")}</TableHead>
                        <TableHead className="text-right">{t("labor")}</TableHead>
                        <TableHead className="text-right">{t("total")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(history.repairs || []).map(r => (
                        <TableRow key={r.id} data-testid={`history-repair-${r.card_number}`}>
                          <TableCell className="font-mono text-xs">{r.card_number}</TableCell>
                          <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString(meta.locale, { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                          <TableCell>
                            <div className="text-sm">{[r.car_make, r.car_model, r.car_year].filter(Boolean).join(" ") || "—"}</div>
                            <div className="text-[11px] font-mono text-muted-foreground">{r.car_plate || ""}{r.car_km ? ` · ${r.car_km} km` : ""}</div>
                          </TableCell>
                          <TableCell className="text-sm">{r.mechanic_name || "—"}</TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] ${r.status === "completed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : r.status === "in_progress" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-blue-500/15 text-blue-400 border-blue-500/30"}`}>{r.status}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-mono text-xs">{formatEUR(r.parts_total)}</TableCell>
                          <TableCell className="text-right tabular-nums font-mono text-xs">
                            {formatEUR(r.labor_charge)}
                            {r.labor_minutes ? <div className="text-[10px] text-muted-foreground">{Math.round(r.labor_minutes)} min</div> : null}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-mono font-bold">{formatEUR(r.grand_total)}</TableCell>
                        </TableRow>
                      ))}
                      {!(history.repairs || []).length && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">{t("noRepairsOnFile")}</TableCell></TableRow>}
                    </TableBody>
                  </Table>
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
                              <Badge className={`text-[10px] ${inv.status === "paid" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-amber-500/15 text-amber-400 border-amber-500/30"}`}>{inv.status}</Badge>
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
