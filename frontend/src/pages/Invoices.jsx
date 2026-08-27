import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError, money, HIDDEN_PRICE } from "@/lib/api";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CheckCircle2, Printer, Trash2, MessageCircle, Archive, FileSpreadsheet, FileDown, Bell, AlertTriangle, Mail, ClipboardList, ArrowRight, Wrench, Loader2, Car, User } from "lucide-react";
import { toast } from "sonner";
import { whatsappShare } from "@/lib/whatsapp";
import { useLang } from "@/i18n";
import { downloadInvoicesZip } from "@/lib/invoice-zip";
import { renderInvoiceHtml } from "@/lib/invoice-render";
import { downloadHtmlAsPdf, printHtml, htmlToPdfBlob } from "@/lib/pdf";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";

// Extract a Dutch-style plate (letters/digits joined by hyphens) from a free-text note
function extractPlate(note) {
  if (!note) return null;
  const matches = String(note).match(/\b[A-Z0-9]+(?:-[A-Z0-9]+){1,3}\b/gi) || [];
  const candidates = matches.filter(m => !/^JOB-/i.test(m));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

async function printInvoice(inv, settings, lang, extras = {}) {
  // We ignore the caller's `lang` — invoice PDFs must always be in Dutch.
  const html = await renderInvoiceHtml(inv, settings, extras);
  printHtml(html, { title: inv.invoice_number });
}

/** Look up the full customer + best-matching vehicle so the PDF can render
    the modern "Customer / Vehicle" block with real address + plate details
    instead of relying on the invoice-time snapshot. */
async function enrichInvoiceForPdf(inv, customers) {
  const customer = customers?.find(c => c.id === inv.customer_id) || null;
  let vehicle = null;
  if (customer?.id) {
    try {
      const { data } = await api.get(`/customers/${customer.id}/vehicles`);
      const list = Array.isArray(data) ? data : [];
      if (inv.car_plate) {
        vehicle = list.find(v => (v.plate || "").toUpperCase() === (inv.car_plate || "").toUpperCase()) || null;
      }
      if (!vehicle && list.length === 1) vehicle = list[0];
    } catch { /* silent — falls back to invoice snapshot */ }
  }
  return { customer, vehicle };
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
  const nav = useNavigate();
  const { t, lang } = useLang();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("invoices.create");
  const canMarkPaid = hasPermission("invoices.mark_paid");
  const canDelete = hasPermission("invoices.delete");
  const canSend = hasPermission("invoices.send");
  const canRemind = hasPermission("reminders.send");
  // Staff without "prices.invoices" see € amounts masked as `€ ••••` — the
  // rest of the invoice (customer, plate, dates, status) stays visible so
  // they can still hand out reminders or copies.
  const canSeePrices = hasPermission("prices.invoices");
  const fm = (v) => money(v, canSeePrices);
  const [payTarget, setPayTarget] = useState(null);
  const [payMethodId, setPayMethodId] = useState("");
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState({ done: 0, total: 0 });
  const [sendingReminders, setSendingReminders] = useState(false);
  const [emailTarget, setEmailTarget] = useState(null);
  const [emailForm, setEmailForm] = useState({ to: "", subject: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);
  // Which repair card is currently being turned into an invoice (button spinner).
  const [invoicingId, setInvoicingId] = useState(null);
  // Confirm dialog for a repair that ISN'T marked completed yet.
  const [confirmRepair, setConfirmRepair] = useState(null);
  const [cardsFilter, setCardsFilter] = useState("ready");   // ready | in_progress | open

  const { data: overdue = [] } = useQuery({
    queryKey: ["overdue-invoices"],
    queryFn: () => api.get("/invoices/overdue").then(r => r.data),
    refetchInterval: 60_000,
  });
  const overdueIds = new Set(overdue.map(i => i.id));
  const todayISO = new Date().toISOString().slice(0, 10);

  const sendOverdueReminders = async () => {
    if (!window.confirm(t("confirmSendReminders", { count: overdue.length }))) return;
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
  // Every repair card in the tenant.  We split them into "ready" (completed &
  // not invoiced), "in progress" and "open" so the operator always creates an
  // invoice by picking a work card — never by bundling raw stock transactions.
  const { data: repairs = [] } = useQuery({ queryKey: ["repairs"], queryFn: () => api.get("/repairs").then(r => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });
  const { data: pmSummary } = useQuery({ queryKey: ["pay-summary"], queryFn: () => api.get("/payments/summary").then(r => r.data) });
  const methods = (pmSummary?.methods || []).filter(m => m.active);

  // Split repair cards into buckets for the "Ready to invoice" section.
  // - ready: completed AND not invoiced (green big CTA)
  // - in_progress: still on the bench (yellow, warn before invoicing)
  // - open: not started yet (grey, warn before invoicing)
  const cardBuckets = useMemo(() => {
    const ready = [], inProgress = [], open = [];
    for (const c of repairs) {
      if (c.invoice_id) continue;                       // already invoiced
      if (c.status === "completed") ready.push(c);
      else if (c.status === "in_progress") inProgress.push(c);
      else open.push(c);
    }
    // Newest first — mirrors the Repairs page ordering.
    const byDate = (a, b) => new Date(b.created_at) - new Date(a.created_at);
    return { ready: ready.sort(byDate), in_progress: inProgress.sort(byDate), open: open.sort(byDate) };
  }, [repairs]);

  const visibleCards = cardBuckets[cardsFilter] || [];

  /** Turn a completed repair card into an invoice with one click. */
  const createInvoiceFromRepair = async (repair) => {
    if (!canCreate) return toast.error(t("noPermission") || "No permission");
    setInvoicingId(repair.id);
    try {
      const { data } = await api.post(`/repairs/${repair.id}/invoice`);
      toast.success(t("invoiceCreated", { number: data.invoice_number }), {
        action: { label: t("print"), onClick: () => printInvoice(data, settings, lang) },
      });
      qc.invalidateQueries();
      setConfirmRepair(null);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setInvoicingId(null); }
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
      subject: t("invoiceEmailSubject", { number: inv.invoice_number, garage: settings?.name || t("ourGarage") }),
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
    if (!window.confirm(t("deleteInvoiceConfirm"))) return;
    try { await api.delete(`/invoices/${id}`); toast.success(t("deleted")); qc.invalidateQueries(); }
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
              out: fm(invoices.filter(i => i.status !== "paid").reduce((s, i) => s + i.total, 0)),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {overdue.length > 0 && canRemind && (
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
                  (done, total) => setZipProgress({ done, total }),
                  lang,
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
          {canCreate && (
            <Button
              className="rounded-full bg-primary hover:bg-primary/90"
              onClick={() => { setCardsFilter("ready"); document.getElementById("job-cards-section")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              data-testid="invoice-from-card-jump"
            >
              <ClipboardList className="h-4 w-4 mr-2" /> {t("invoiceFromCard") || "Invoice from job card"}
            </Button>
          )}
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
                  ? <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15">{t("owesLabel", { n: fm(c.unpaid) })}</Badge>
                  : <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">{t("settledLabel")}</Badge>}
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{t("paidLifetime")}</span>
                <span className="font-mono">{fm(c.paid)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Job cards → invoice.  This is the ONLY way to create an invoice in
          the app: every invoice must be tied to a work card.  Bundling raw
          transactions is intentionally removed. */}
      <Card id="job-cards-section" className="border-border p-5 space-y-4" data-testid="job-cards-section">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-primary mb-1 flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5" /> {t("invoiceFromCardHeader") || "Create invoice from a job card"}
            </div>
            <h2 className="font-display text-2xl font-bold">{t("workCards") || "Work cards"}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("invoiceFromCardSub") || "One-click invoicing from any job card. Every invoice must originate from a card — no orphan bills."}
            </p>
          </div>
          <Tabs value={cardsFilter} onValueChange={setCardsFilter} className="w-auto">
            <TabsList>
              <TabsTrigger value="ready" data-testid="cards-tab-ready">
                {t("readyToInvoice") || "Ready"} <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">{cardBuckets.ready.length}</span>
              </TabsTrigger>
              <TabsTrigger value="in_progress" data-testid="cards-tab-progress">
                {t("inProgress") || "In progress"} <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold">{cardBuckets.in_progress.length}</span>
              </TabsTrigger>
              <TabsTrigger value="open" data-testid="cards-tab-open">
                {t("statusOpen") || "Open"} <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-slate-500/20 text-slate-700 dark:text-slate-400 text-[10px] font-bold">{cardBuckets.open.length}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {visibleCards.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground border-2 border-dashed border-border rounded-lg" data-testid="cards-empty">
            {cardsFilter === "ready"
              ? (t("noReadyCards") || "No completed job cards waiting for an invoice.")
              : cardsFilter === "in_progress"
                ? (t("noInProgressCards") || "No cards currently in the workshop.")
                : (t("noOpenCards") || "No open cards.")}
            <div className="mt-3">
              <Button variant="outline" className="rounded-full" onClick={() => nav("/repairs")} data-testid="cards-goto-repairs">
                <ArrowRight className="h-3.5 w-3.5 mr-1.5" /> {t("openRepairs") || "Open Job cards"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="cards-grid">
            {visibleCards.map(c => {
              const isReady = c.status === "completed";
              const partsTotal = (c.parts_lines || []).reduce((s, l) => s + (Number(l.total) || 0), 0);
              const laborTotal = Number(c.labor_total || 0);
              const specialTotal = (c.special_parts || []).reduce((s, l) => s + (Number(l.total) || 0), 0);
              const grand = partsTotal + laborTotal + specialTotal;
              return (
                <Card key={c.id} className={`p-4 border card-hover flex flex-col gap-3 ${isReady ? "border-emerald-500/40 bg-emerald-500/5" : "border-border"}`} data-testid={`card-tile-${c.card_number}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-bold text-primary tracking-wider">{c.card_number}</div>
                      <div className="font-semibold truncate flex items-center gap-1.5 mt-0.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {c.customer_name || t("walkIn") || "Walk-in"}
                      </div>
                      {(c.car_plate || c.car_make) && (
                        <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                          <Car className="h-3 w-3 shrink-0" />
                          {c.car_plate || ""} {c.car_make || ""} {c.car_model || ""}
                        </div>
                      )}
                    </div>
                    <Badge className={
                      isReady ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/20"
                      : c.status === "in_progress" ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/20"
                      : "bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-500/40 hover:bg-slate-500/20"
                    }>
                      {isReady ? (t("completed") || "Completed") : c.status === "in_progress" ? (t("inProgress") || "In progress") : (t("statusOpen") || "Open")}
                    </Badge>
                  </div>

                  {c.complaint && <div className="text-xs text-muted-foreground line-clamp-2 italic">"{c.complaint}"</div>}

                  <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                    <div className="rounded-md bg-muted/40 px-2 py-1.5">
                      <div className="uppercase tracking-widest text-[9px] text-muted-foreground">{t("parts") || "Parts"}</div>
                      <div className="font-bold tabular-nums">{fm(partsTotal + specialTotal)}</div>
                    </div>
                    <div className="rounded-md bg-muted/40 px-2 py-1.5">
                      <div className="uppercase tracking-widest text-[9px] text-muted-foreground">{t("labor") || "Labor"}</div>
                      <div className="font-bold tabular-nums">{fm(laborTotal)}</div>
                    </div>
                    <div className="rounded-md bg-primary/10 px-2 py-1.5">
                      <div className="uppercase tracking-widest text-[9px] text-primary/80">{t("total")}</div>
                      <div className="font-bold text-primary tabular-nums">{fm(grand)}</div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-auto pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full flex-1"
                      onClick={() => nav(`/repairs?card=${c.id}`)}
                      data-testid={`card-open-${c.card_number}`}
                    >
                      <Wrench className="h-3.5 w-3.5 mr-1.5" /> {t("openCard") || "Open card"}
                    </Button>
                    {canCreate && (
                      <Button
                        size="sm"
                        className={`rounded-full flex-1 ${isReady ? "bg-emerald-500 hover:bg-emerald-500/90 text-white" : "bg-primary hover:bg-primary/90"}`}
                        disabled={invoicingId === c.id}
                        onClick={() => isReady ? createInvoiceFromRepair(c) : setConfirmRepair(c)}
                        data-testid={`card-invoice-${c.card_number}`}
                      >
                        {invoicingId === c.id
                          ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> ...</>
                          : <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> {t("createInvoice") || "Create invoice"}</>}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {t("existingInvoices") || "Invoices"} · {invoices.length}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

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
                <TableCell className="text-right tabular-nums font-mono">{fm(inv.total)}</TableCell>
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
                    <Button size="icon" variant="ghost" onClick={async () => {
                      const extras = await enrichInvoiceForPdf(inv, customers);
                      printInvoice(inv, settings, undefined, extras);
                    }} data-testid={`invoice-print-${inv.invoice_number}`}><Printer className="h-4 w-4" /></Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={t("downloadPdf")}
                      data-testid={`invoice-pdf-${inv.invoice_number}`}
                      onClick={async () => {
                        try {
                          const extras = await enrichInvoiceForPdf(inv, customers);
                          const html = await renderInvoiceHtml(inv, settings, extras);
                          await downloadHtmlAsPdf(html, `${inv.invoice_number}.pdf`);
                        } catch (e) { toast.error(formatApiError(e)); }
                      }}
                    ><FileDown className="h-4 w-4" /></Button>
                    {canSend && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t("emailInvoice")}
                        data-testid={`invoice-email-${inv.invoice_number}`}
                        onClick={() => openEmail(inv)}
                      ><Mail className="h-4 w-4" /></Button>
                    )}
                    <Button size="icon" variant="ghost" className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300" onClick={async () => {
                      const cust = customers.find(c => c.id === inv.customer_id);
                      let pdfUrl = "";
                      // Try to attach a real downloadable PDF link to the WhatsApp
                      // message so the customer can open the invoice with one tap.
                      const tid = toast.loading(t("preparingPdf"));
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
                        header: `${t("invoice")} ${inv.invoice_number}`,
                        lines: inv.lines.map(l => `• ${l.name} × ${l.quantity} — ${l.total.toFixed(2)}€`),
                        total: inv.total,
                        note: inv.status === "paid" ? t("paidStatusText") : t("waPleaseSettle"),
                        url: pdfUrl || undefined,
                      });
                    }} data-testid={`invoice-wa-${inv.invoice_number}`}><MessageCircle className="h-4 w-4" /></Button>
                    {inv.status !== "paid" && canMarkPaid && <Button size="sm" variant="outline" className="rounded-full" onClick={() => { setPayTarget(inv); setPayMethodId(methods[0]?.id || ""); }} data-testid={`invoice-paid-${inv.invoice_number}`}><CheckCircle2 className="h-3 w-3 mr-1" />{t("markPaid")}</Button>}
                    {canDelete && <Button size="icon" variant="ghost" onClick={() => del(inv.id)}><Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {invoices.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-16 text-muted-foreground">No invoices yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {/* Confirm-invoicing-a-non-completed card. */}
      <Dialog open={!!confirmRepair} onOpenChange={(v) => { if (!v) setConfirmRepair(null); }}>
        <DialogContent className="max-w-md" data-testid="card-invoice-confirm-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t("invoiceIncompleteTitle") || "Invoice a card that isn't completed?"}
            </DialogTitle>
            <DialogDescription>
              {t("invoiceIncompleteDesc") ||
                "Best practice is to mark the card as Completed first. If you continue, the card will be marked Completed and invoiced right now."}
            </DialogDescription>
          </DialogHeader>
          {confirmRepair && (
            <div className="p-3 rounded-md border border-border bg-muted/40 text-sm">
              <div className="font-mono text-xs text-primary">{confirmRepair.card_number}</div>
              <div className="font-semibold">{confirmRepair.customer_name || t("walkIn")}</div>
              <div className="text-xs text-muted-foreground">{confirmRepair.car_plate} {confirmRepair.car_make} {confirmRepair.car_model}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRepair(null)} data-testid="card-invoice-cancel">{t("cancel")}</Button>
            <Button
              className="rounded-full bg-emerald-500 hover:bg-emerald-500/90 text-white"
              disabled={invoicingId === confirmRepair?.id}
              onClick={() => confirmRepair && createInvoiceFromRepair(confirmRepair)}
              data-testid="card-invoice-confirm"
            >
              {invoicingId === confirmRepair?.id
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> ...</>
                : <><CheckCircle2 className="h-4 w-4 mr-2" /> {t("invoiceAnyway") || "Complete & invoice"}</>}
            </Button>
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
