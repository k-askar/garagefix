import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Printer, FileDown } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";
import { downloadListReportPdf, printListReport } from "@/lib/reports";

export default function PartyPage({ kind }) {
  const qc = useQueryClient();
  const { t, meta } = useLang();
  const isSup = kind === "suppliers";
  const label = isSup ? t("supplier") : t("customer");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", contact: "", vehicle: "" });
  const [exporting, setExporting] = useState(false);

  const { data: rows = [] } = useQuery({ queryKey: [kind], queryFn: () => api.get(`/${kind}`).then((r) => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });

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
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-muted-foreground">{isSup ? r.contact : r.vehicle}</TableCell>
                <TableCell className="text-muted-foreground">{r.email}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">{r.phone}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{r.address}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => del(r.id)} data-testid={`del-${kind}-${r.id}`}><Trash2 className="h-4 w-4 text-rose-400" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-16 text-muted-foreground">No {kind} yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
