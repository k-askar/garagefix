import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { CheckCircle2, Printer, Trash2, Plus, MessageCircle, Archive, FileSpreadsheet, FileDown, Bell, AlertTriangle, Mail } from "lucide-react";
import { toast } from "sonner";
import { whatsappShare } from "@/lib/whatsapp";
import { useLang } from "@/i18n";
import { downloadInvoicesZip } from "@/lib/invoice-zip";
import { renderInvoiceHtml } from "@/lib/invoice-render";
import { downloadHtmlAsPdf, printHtml, htmlToPdfBlob } from "@/lib/pdf";
import SearchableSelect from "@/components/SearchableSelect";

// Extract a Dutch-style plate (letters/digits joined by hyphens) from a free-text note
function extractPlate(note) {
  if (!note) return null;
  const matches = String(note).match(/\b[A-Z0-9]+(?:-[A-Z0-9]+){1,3}\b/gi) || [];
  const candidates = matches.filter(m => !/^JOB-/i.test(m));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

async function printInvoice(inv, settings) {
  const html = await renderInvoiceHtml(inv, settings);
  printHtml(html, { title: inv.invoice_number });
}

/** Turn a Blob into a base64 string (without the data:… prefix) so we can
    ship it inside a JSON body to the backend for email attachments etc. */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export default function Invoices() {
  const qc = useQueryClient();
  const { t } = useLang();
  const [showCreate, setShowCreate] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [taxRate, setTaxRate] = useState(0);
  const [note, setNote] = useState("");
  const [selectedTxns, setSelectedTxns] = useState([]);
  const [payTarget, setPayTarget] = useState(null);
  const [payMethodId, setPayMethodId] = useState("");
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 });
  const [sendingReminders, setSendingReminders] = useState(false);
  const [emailTarget, setEmailTarget] = useState(null);
  const [emailForm, setEmailForm] = useState({ to: "", subject: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);

  const { data: overdue = [] } = useQuery({
    queryKey: ["overdue-invoices"],
    queryFn: () => api.get("/invoices/overdue").then(r => r.data),
    refetchInterval: 60_000,
  });
  const overdueIds = new Set(overdue.map(i => i.id));
  const todayISO = new Date().toISOString().slice(0, 10);

  const sendOverdueReminders = async () => {
    if (!window.confirm(`Send email reminders to customers on ${overdue.length} overdue invoice(s)?`)) return;
    setSendingReminders(true);
    try {
      const res = await api.post("/invoices/overdue/send-reminders");
      toast.success(`Sent ${res.data.sent} · ${res.data.skipped ?? res.data.skipped_no_email ?? 0} skipped`);
      qc.invalidateQueries({ queryKey: ["overdue-invoices"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSendingReminders(false); }
  };

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: () => api.get("/invoices").then(r => r.data) });
  const { data: customers = [] } = useQuery({ queryKey: ["cus"], queryFn: () => api.get("/customers").then(r => r.data) });
  const { data: txns = [] } = useQuery({ queryKey: ["txns"], queryFn: () => api.get("/transactions?limit=500").then(r => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });
  const { data: pmSummary } = useQuery({ queryKey: ["pay-summary"], queryFn: () => api.get("/payments/summary").then(r => r.data) });
  const methods = (pmSummary?.methods || []).filter(m => m.active);

  const eligible = txns.filter(t => t.type === "OUT" && !t.invoice_id && (!customerId || t.customer_id === customerId));

  const toggle = (id) => setSelectedTxns(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async () => {
    if (!selectedTxns.length) return toast.error("Pick at least one transaction");
    try {
      const { data } = await api.post("/invoices/from-transactions", {
        customer_id: customerId || null,
        transaction_ids: selectedTxns,
        tax_rate: Number(taxRate),
        note,
      });
      toast.success(`Invoice ${data.invoice_number} created`, {
        action: { label: "Print", onClick: () => { printInvoice(data, settings); } },
      });
      setShowCreate(false); setSelectedTxns([]); setCustomerId(""); setNote(""); setTaxRate(0);
      qc.invalidateQueries();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const markPaid = async (id) => {
    try {
      await api.post(`/invoices/${id}/mark-paid`, { payment_method_id: payMethodId || null });
      toast.success(t("markPaidWith"));
      setPayTarget(null); setPayMethodId("");
      qc.invalidateQueries();
    }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const openEmail = (inv) => {
    const cust = customers.find(c => c.id === inv.customer_id);
    setEmailTarget(inv);
    setEmailForm({
      to: cust?.email || "",
      subject: `Invoice ${inv.invoice_number} from ${settings?.name || "our garage"}`,
      message: "",
    });
  };

  const sendEmail = async () => {
    if (!emailTarget) return;
    if (!emailForm.to?.trim()) return toast.error(t("recipientRequired"));
    setSendingEmail(true);
    try {
      // Render the invoice to a PDF blob so the customer receives a real
      // attachment they can save/print — same look as the "Download PDF" button.
      let attachment_base64, attachment_filename;
      try {
        const html = await renderInvoiceHtml(emailTarget, settings);
        const blob = await htmlToPdfBlob(html);
        attachment_base64 = await blobToBase64(blob);
        attachment_filename = `${emailTarget.invoice_number}.pdf`;
      } catch (pdfErr) {
        // Non-fatal — fall back to the text-only email so the customer at
        // least gets the invoice details.
        console.warn("PDF attach failed, sending without PDF:", pdfErr);
      }
      await api.post(`/invoices/${emailTarget.id}/email`, {
        to: emailForm.to.trim(),
        subject: emailForm.subject?.trim() || undefined,
        message: emailForm.message || undefined,
        attachment_base64,
        attachment_filename,
      });
      toast.success(t("sentTo", { to: emailForm.to }));
      setEmailTarget(null);
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSendingEmail(false); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete invoice?")) return;
    try { await api.delete(`/invoices/${id}`); toast.success("Deleted"); qc.invalidateQueries(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  // running balance per customer
  const balances = customers.map(c => {
    const custInvs = invoices.filter(i => i.customer_id === c.id);
    return {
      ...c,
      unpaid: custInvs.filter(i => i.status !== "paid").reduce((s, i) => s + i.total, 0),
      paid: custInvs.filter(i => i.status === "paid").reduce((s, i) => s + i.total, 0),
      count: custInvs.length,
    };
  }).filter(c => c.count > 0);

  return (
    <div className="space-y-8" data-testid="invoices-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("billing")}</div>
          <h1 className="font-display text-4xl font-black tracking-tight">{t("invoices")}</h1>
          <p className="text-muted-foreground mt-2" dir="ltr" style={{ unicodeBidi: "isolate" }}>
            {t("invoicesSub", {
              count: invoices.length,
              out: formatEUR(invoices.filter(i => i.status !== "paid").reduce((s, i) => s + i.total, 0)),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {overdue.length > 0 && (
            <Button
              variant="outline"
              className="rounded-full border-rose-500/50 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
              disabled={sendingReminders}
              onClick={sendOverdueReminders}
              data-testid="invoices-overdue-remind"
            >
              <Bell className="h-4 w-4 mr-2" /> {sendingReminders ? "..." : t("remindNOverdue", { n: overdue.length })}
            </Button>
          )}
          <Button
            variant="outline"
            className="rounded-full"
            disabled={zipping || invoices.length === 0}
            onClick={async () => {
              setZipping(true);
              setZipProgress({ done: 0, total: 0 });
              try {
                const list = selectedInvoices.length > 0 ? invoices.filter(i => selectedInvoices.includes(i.id)) : invoices;
                await downloadInvoicesZip(
                  list, settings,
                  `invoices-${new Date().toISOString().slice(0, 10)}.zip`,
                  (done, total) => setZipProgress({ done, total })
                );
                toast.success(t("zipDownloaded"));
              } catch (e) { toast.error(formatApiError(e)); }
              finally { setZipping(false); setZipProgress({ done: 0, total: 0 }); }
            }}
            data-testid="invoices-zip-button"
          >
            <Archive className="h-4 w-4 mr-2" />
            {zipping
              ? (zipProgress.total ? `${zipProgress.done}/${zipProgress.total}...` : "...")
              : (selectedInvoices.length > 0 ? t("pdfsZipN", { n: selectedInvoices.length }) : t("allPdfsZip"))}
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={async () => {
              try {
                const res = await api.get("/reports/invoices/excel", { responseType: "blob" });
                const url = URL.createObjectURL(res.data);
                const a = document.createElement("a"); a.href = url; a.download = `invoices-${new Date().toISOString().slice(0, 10)}.xlsx`;
                document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
              } catch (e) { toast.error(formatApiError(e)); }
            }}
            data-testid="invoices-excel-button"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" /> {t("excel")}
          </Button>
          <Button className="rounded-full bg-primary hover:bg-primary/90" onClick={() => setShowCreate(true)} data-testid="invoice-create-button">
            <Plus className="h-4 w-4 mr-2" /> {t("newInvoice")}
          </Button>
        </div>
      </div>

      {balances.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {balances.map(c => (
            <Card key={c.id} className="p-4 border-border card-hover">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs font-mono text-muted-foreground">{c.count} invoices</div>
                </div>
                {c.unpaid > 0
                  ? <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15">{t("owesLabel", { n: formatEUR(c.unpaid) })}</Badge>
                  : <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">{t("settledLabel")}</Badge>}
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{t("paidLifetime")}</span>
                <span className="font-mono">{formatEUR(c.paid)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={invoices.length > 0 && selectedInvoices.length === invoices.length}
                  onCheckedChange={(v) => setSelectedInvoices(v ? invoices.map(i => i.id) : [])}
                  data-testid="invoices-select-all"
                />
              </TableHead>
              <TableHead>{t("invoiceNumber")}</TableHead>
              <TableHead>{t("customer")}</TableHead>
              <TableHead>{t("lines")}</TableHead>
              <TableHead className="text-right">{t("total")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("createdAt")}</TableHead>
              <TableHead className="text-right w-40">{t("actionsLabel")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(inv => (
              <TableRow key={inv.id} data-testid={`invoice-row-${inv.invoice_number}`}>
                <TableCell>
                  <Checkbox
                    checked={selectedInvoices.includes(inv.id)}
                    onCheckedChange={() => setSelectedInvoices(s => s.includes(inv.id) ? s.filter(x => x !== inv.id) : [...s, inv.id])}
                    data-testid={`invoice-select-${inv.invoice_number}`}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                <TableCell>{inv.customer_name || "Walk-in"}</TableCell>
                <TableCell className="text-muted-foreground">{inv.lines.length}</TableCell>
                <TableCell className="text-right tabular-nums font-mono">{formatEUR(inv.total)}</TableCell>
                <TableCell>
                  {inv.status === "paid"
                    ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">{t("invoiceStatusPaid")}</Badge>
                    : overdueIds.has(inv.id)
                      ? (
                        <div className="flex flex-col gap-1 items-start">
                          <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/40 hover:bg-rose-500/15" data-testid={`invoice-overdue-${inv.invoice_number}`}><AlertTriangle className="h-3 w-3 mr-1" />{t("invoiceStatusOverdue")}</Badge>
                          {inv.reminder_stage > 0 && (
                            <span
                              className={`text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                                inv.reminder_stage === 1 ? "border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/10" :
                                inv.reminder_stage === 2 ? "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10" :
                                "border-rose-500/50 text-rose-700 dark:text-rose-300 bg-rose-500/10"
                              }`}
                              data-testid={`invoice-reminder-stage-${inv.invoice_number}`}
                              title={inv.reminder_sent_at ? `Last sent: ${new Date(inv.reminder_sent_at).toLocaleString()}` : ""}
                            >
                              {inv.reminder_stage === 1 && t("notice1")}
                              {inv.reminder_stage === 2 && t("notice2")}
                              {inv.reminder_stage === 3 && t("notice3")}
                            </span>
                          )}
                        </div>
                      )
                      : <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15">{t("invoiceStatusDue")}</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs font-mono">
                  {new Date(inv.created_at).toLocaleDateString("en-GB")}
                  {inv.due_date && inv.status !== "paid" && (
                    <div className={`text-[10px] mt-0.5 ${overdueIds.has(inv.id) ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>
                      due {inv.due_date}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { printInvoice(inv, settings); }} data-testid={`invoice-print-${inv.invoice_number}`}><Printer className="h-4 w-4" /></Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={t("downloadPdf")}
                      data-testid={`invoice-pdf-${inv.invoice_number}`}
                      onClick={async () => {
                        try {
                          const html = await renderInvoiceHtml(inv, settings);
                          await downloadHtmlAsPdf(html, `${inv.invoice_number}.pdf`);
                        } catch (e) { toast.error(formatApiError(e)); }
                      }}
                    ><FileDown className="h-4 w-4" /></Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={t("emailInvoice")}
                      data-testid={`invoice-email-${inv.invoice_number}`}
                      onClick={() => openEmail(inv)}
                    ><Mail className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300" onClick={async () => {
                      const cust = customers.find(c => c.id === inv.customer_id);
                      let pdfUrl = "";
                      // Try to attach a real downloadable PDF link to the WhatsApp
                      // message so the customer can open the invoice with one tap.
                      const tid = toast.loading("Preparing PDF...");
                      try {
                        const html = await renderInvoiceHtml(inv, settings);
                        const blob = await htmlToPdfBlob(html);
                        const b64 = await blobToBase64(blob);
                        const { data } = await api.post(`/invoices/${inv.id}/public-pdf`, {
                          content_base64: b64,
                          filename: `${inv.invoice_number}.pdf`,
                        });
                        pdfUrl = data?.url || "";
                      } catch (err) { console.warn("Public PDF upload failed:", err); }
                      finally { toast.dismiss(tid); }
                      whatsappShare({
                        phone: cust?.phone, garageName: settings?.name,
                        header: `Invoice ${inv.invoice_number}`,
                        lines: inv.lines.map(l => `• ${l.name} × ${l.quantity} — ${l.total.toFixed(2)}€`),
                        total: inv.total,
                        note: inv.status === "paid" ? "PAID" : "Please settle at your earliest.",
                        url: pdfUrl || undefined,
                      });
                    }} data-testid={`invoice-wa-${inv.invoice_number}`}><MessageCircle className="h-4 w-4" /></Button>
                    {inv.status !== "paid" && <Button size="sm" variant="outline" className="rounded-full" onClick={() => { setPayTarget(inv); setPayMethodId(methods[0]?.id || ""); }} data-testid={`invoice-paid-${inv.invoice_number}`}><CheckCircle2 className="h-3 w-3 mr-1" />Paid</Button>}
                    <Button size="icon" variant="ghost" onClick={() => del(inv.id)}><Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {invoices.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-16 text-muted-foreground">No invoices yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Bundle transactions into an invoice</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <SearchableSelect
                  value={customerId}
                  onChange={(v) => { setCustomerId(v); setSelectedTxns([]); }}
                  options={customers.map(c => ({ value: c.id, label: c.name }))}
                  emptyLabel="Walk-in / any"
                  searchPlaceholder="Search customer"
                  placeholder="Any / walk-in"
                  testId="invoice-customer-select"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tax rate (%)</Label>
                <Input type="number" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} data-testid="invoice-tax-input" />
              </div>
            </div>
            <div className="border border-border rounded-md max-h-72 overflow-y-auto">
              {eligible.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No unbilled OUT transactions for this filter.</div>}
              {eligible.map(t => (
                <label key={t.id} className="flex items-center gap-3 p-3 border-b border-border last:border-0 cursor-pointer hover:bg-accent">
                  <Checkbox checked={selectedTxns.includes(t.id)} onCheckedChange={() => toggle(t.id)} data-testid={`invoice-txn-${t.id}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.item_name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{t.item_sku} · {new Date(t.created_at).toLocaleDateString("en-GB")} · {t.customer_name || "walk-in"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono">{t.quantity} × {formatEUR(t.unit_price)}</div>
                    <div className="text-xs font-mono font-bold">{formatEUR(t.total)}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="space-y-1.5"><Label>Note</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="p-3 rounded-md bg-muted/40 border border-border flex justify-between">
              <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Selected</span>
              <span className="font-mono font-bold">{selectedTxns.length} · {formatEUR(eligible.filter(t => selectedTxns.includes(t.id)).reduce((s, t) => s + t.total, 0))}</span>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={submit} className="rounded-full" data-testid="invoice-submit">Create invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!payTarget} onOpenChange={(v) => { if (!v) { setPayTarget(null); setPayMethodId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">{t("markPaidWith")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {payTarget && (
              <div className="p-3 rounded-md border border-border bg-muted/40">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("invoiceNumber")}</div>
                <div className="font-mono font-bold">{payTarget.invoice_number} · {payTarget.customer_name || t("walkIn")}</div>
                <div className="mt-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("total")}</div>
                <div className="font-display text-2xl font-bold">{formatEUR(payTarget.total)}</div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("paymentMethod")}</Label>
              <Select value={payMethodId || "none"} onValueChange={(v) => setPayMethodId(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="invoice-paymethod-select"><SelectValue placeholder={t("pickMethod")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("payMethodNone")}</SelectItem>
                  {methods.map(m => <SelectItem key={m.id} value={m.id}>{m.name} · {formatEUR(m.balance)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { setPayTarget(null); setPayMethodId(""); }}>{t("cancel")}</Button>
            <Button className="rounded-full bg-emerald-500 hover:bg-emerald-500/90" onClick={() => markPaid(payTarget.id)} data-testid="invoice-paid-confirm">
              <CheckCircle2 className="h-4 w-4 mr-2" /> {t("paid")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!emailTarget} onOpenChange={(v) => { if (!v) setEmailTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">{t("emailInvoiceTitle", { inv: emailTarget?.invoice_number || "" })}</DialogTitle>
            <DialogDescription>{t("emailInvoice")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("recipientEmail")}</Label>
              <Input
                type="email"
                value={emailForm.to}
                onChange={(e) => setEmailForm(f => ({ ...f, to: e.target.value }))}
                placeholder="customer@example.com"
                data-testid="invoice-email-to"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("subject")}</Label>
              <Input
                value={emailForm.subject}
                onChange={(e) => setEmailForm(f => ({ ...f, subject: e.target.value }))}
                data-testid="invoice-email-subject"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("messageOptional")}</Label>
              <Textarea
                rows={3}
                value={emailForm.message}
                onChange={(e) => setEmailForm(f => ({ ...f, message: e.target.value }))}
                data-testid="invoice-email-message"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEmailTarget(null)}>{t("cancel")}</Button>
            <Button
              className="rounded-full bg-primary"
              disabled={sendingEmail}
              onClick={sendEmail}
              data-testid="invoice-email-send"
            >
              <Mail className="h-4 w-4 mr-2" />{sendingEmail ? t("sending") : t("sendEmail")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
