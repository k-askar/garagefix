import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, Banknote, CreditCard, Coins, Plus, ArrowUpRight, ArrowDownLeft, Trash2, FileDown, Printer, Pencil, Power, Receipt } from "lucide-react";
import { toast } from "sonner";
import { downloadListReportPdf, printListReport } from "@/lib/reports";

const TYPE_META = {
  cash: { icon: Coins, accent: "text-emerald-400", ring: "border-emerald-500/40 bg-emerald-500/10" },
  bank: { icon: Banknote, accent: "text-sky-400", ring: "border-sky-500/40 bg-sky-500/10" },
  card: { icon: CreditCard, accent: "text-fuchsia-400", ring: "border-fuchsia-500/40 bg-fuchsia-500/10" },
  other: { icon: Wallet, accent: "text-primary", ring: "border-primary/40 bg-primary/10" },
};

function todayISO(off = 0) { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); }

export default function Accounts() {
  const qc = useQueryClient();
  const { t, meta } = useLang();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  const [showMethod, setShowMethod] = useState(false);
  const [editing, setEditing] = useState(null);
  const [mForm, setMForm] = useState({ name: "", type: "cash", opening_balance: 0, note: "", active: true });

  const [showEntry, setShowEntry] = useState(false);
  const [entry, setEntry] = useState({ method_id: "", direction: "in", amount: "", counterpart: "", note: "" });

  const [activeMethodId, setActiveMethodId] = useState(null);
  const [range, setRange] = useState({ start: todayISO(-30), end: todayISO(0) });

  const { data: summary } = useQuery({
    queryKey: ["pay-summary"],
    queryFn: () => api.get("/payments/summary").then(r => r.data),
  });
  const methods = summary?.methods || [];

  const { data: statement } = useQuery({
    queryKey: ["pay-stmt", activeMethodId, range.start, range.end],
    queryFn: () => api.get(`/payment-methods/${activeMethodId}/statement?start=${range.start}&end=${range.end}`).then(r => r.data),
    enabled: !!activeMethodId,
  });

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });

  const openNewMethod = () => {
    setEditing(null);
    setMForm({ name: "", type: "cash", opening_balance: 0, note: "", active: true });
    setShowMethod(true);
  };
  const openEditMethod = (m) => {
    setEditing(m);
    setMForm({ name: m.name, type: m.type, opening_balance: m.opening_balance, note: m.note || "", active: m.active });
    setShowMethod(true);
  };

  const saveMethod = async (e) => {
    e.preventDefault();
    if (!mForm.name.trim()) return toast.error(t("nameRequired"));
    try {
      if (editing) {
        await api.put(`/payment-methods/${editing.id}`, { ...mForm, opening_balance: Number(mForm.opening_balance) });
        toast.success(t("methodUpdated"));
      } else {
        await api.post("/payment-methods", { ...mForm, opening_balance: Number(mForm.opening_balance) });
        toast.success(t("methodCreated"));
      }
      setShowMethod(false); qc.invalidateQueries();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const toggleActive = async (m) => {
    try {
      await api.put(`/payment-methods/${m.id}`, { active: !m.active });
      qc.invalidateQueries();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const deleteMethod = async (m) => {
    if (!window.confirm(`${t("delete")} ${m.name}?`)) return;
    try {
      await api.delete(`/payment-methods/${m.id}`);
      toast.success(t("deleted"));
      if (activeMethodId === m.id) setActiveMethodId(null);
      qc.invalidateQueries();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const saveEntry = async (e) => {
    e.preventDefault();
    if (!entry.method_id) return toast.error(t("pickMethod"));
    const amt = Number(entry.amount);
    if (!amt || amt <= 0) return toast.error(t("invalidAmount"));
    try {
      await api.post("/payment-entries", {
        method_id: entry.method_id, direction: entry.direction,
        amount: amt, counterpart: entry.counterpart, note: entry.note,
      });
      toast.success(t("entryLogged"));
      setShowEntry(false);
      setEntry({ method_id: entry.method_id, direction: "in", amount: "", counterpart: "", note: "" });
      qc.invalidateQueries();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const deleteEntry = async (eid) => {
    if (!window.confirm(t("deleteEntryConfirm"))) return;
    try {
      await api.delete(`/payment-entries/${eid}`);
      toast.success(t("deleted"));
      qc.invalidateQueries();
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const activeMethod = methods.find(m => m.id === activeMethodId);
  const totalBalance = summary?.total_balance || 0;

  const exportStatement = async (mode) => {
    if (!statement) return;
    const args = {
      title: `${t("statement")} · ${statement.method?.name || ""}`,
      subtitle: `${range.start} → ${range.end}`,
      headers: [t("date"), t("reference"), t("type"), t("counterpart"), t("note"), t("in"), t("out"), t("balance")],
      rows: (statement.entries || []).map(e => [
        (e.created_at || "").slice(0, 16).replace("T", " "),
        e.reference_no || t(refTypeKey(e.reference_type)),
        t(refTypeKey(e.reference_type)),
        e.counterpart || "—",
        e.note || "",
        e.direction === "in" ? formatEUR(e.amount) : "",
        e.direction === "out" ? formatEUR(e.amount) : "",
        formatEUR(e.balance_after),
      ]),
      summary: [
        { label: t("periodOpening"), value: formatEUR(statement.period_opening) },
        { label: t("totalIn"), value: formatEUR(statement.total_in) },
        { label: t("totalOut"), value: formatEUR(statement.total_out) },
        { label: t("closingBalance"), value: formatEUR(statement.closing_balance) },
      ],
      settings, dir: meta.dir,
      footerNote: `${t("statementFooter")} — ${statement.method?.name || ""}`,
    };
    if (mode === "pdf") await downloadListReportPdf(args);
    else printListReport(args);
  };

  return (
    <div className="space-y-8" data-testid="accounts-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("finance")}</div>
          <h1 className="font-display text-4xl font-black tracking-tight">{t("accounts")}</h1>
          <p className="text-muted-foreground mt-2">{t("accountsSub", { total: formatEUR(totalBalance), n: methods.length })}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="rounded-full" onClick={() => { setEntry(e => ({ ...e, method_id: activeMethodId || methods[0]?.id || "" })); setShowEntry(true); }} data-testid="accounts-new-entry">
            <ArrowUpRight className="h-4 w-4 mr-2" /> {t("addEntry")}
          </Button>
          {isOwner && (
            <Button className="rounded-full bg-primary hover:bg-primary/90" onClick={openNewMethod} data-testid="accounts-new-method">
              <Plus className="h-4 w-4 mr-2" /> {t("newMethod")}
            </Button>
          )}
        </div>
      </div>

      {/* Grand total */}
      <Card className={`p-6 border ${TYPE_META.other.ring}`} data-testid="accounts-total-card">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{t("grandBalance")}</div>
            <div className="font-display text-4xl font-black tabular-nums mt-1 text-primary" data-testid="accounts-total-value">{formatEUR(totalBalance)}</div>
          </div>
          <Wallet className="h-8 w-8 text-primary" />
        </div>
      </Card>

      {/* Method cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {methods.map(m => {
          const meta = TYPE_META[m.type] || TYPE_META.other;
          const Icon = meta.icon;
          const isActive = activeMethodId === m.id;
          return (
            <Card key={m.id} className={`p-5 border cursor-pointer transition-all ${isActive ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-primary/40"} ${!m.active && "opacity-60"}`}
                  onClick={() => setActiveMethodId(m.id)}
                  data-testid={`method-card-${m.id}`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`h-10 w-10 rounded-md border flex items-center justify-center ${meta.ring}`}>
                  <Icon className={`h-5 w-5 ${meta.accent}`} />
                </div>
                <div className="flex gap-1">
                  {isOwner && (
                    <>
                      <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); openEditMethod(m); }} data-testid={`method-edit-${m.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); toggleActive(m); }} data-testid={`method-toggle-${m.id}`}>
                        <Power className={`h-4 w-4 ${m.active ? "text-emerald-400" : "text-muted-foreground"}`} />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); deleteMethod(m); }} data-testid={`method-delete-${m.id}`}>
                        <Trash2 className="h-4 w-4 text-rose-400" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="font-semibold text-base">{m.name}</div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-1">{t("type_" + m.type)}</div>
              <div className={`font-display text-3xl font-black tabular-nums mt-4 ${meta.accent}`}>{formatEUR(m.balance)}</div>
              <div className="text-xs text-muted-foreground mt-1">{t("opening")}: {formatEUR(m.opening_balance)}</div>
            </Card>
          );
        })}
      </div>

      {/* Statement */}
      {activeMethod && statement && (
        <Card className="p-6 border-border overflow-x-auto space-y-4" data-testid="statement-card">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-display text-2xl font-bold">{t("statement")} · {activeMethod.name}</h3>
              <p className="text-xs text-muted-foreground font-mono">{range.start} → {range.end}</p>
            </div>
            <div className="flex gap-2 items-end flex-wrap">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{t("from")}</Label>
                <Input type="date" value={range.start} onChange={(e) => setRange(r => ({ ...r, start: e.target.value }))} className="w-40" data-testid="stmt-start" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{t("to")}</Label>
                <Input type="date" value={range.end} onChange={(e) => setRange(r => ({ ...r, end: e.target.value }))} className="w-40" data-testid="stmt-end" />
              </div>
              <Button variant="outline" className="rounded-full" onClick={() => exportStatement("print")} data-testid="stmt-print">
                <Printer className="h-4 w-4 mr-2" /> {t("print")}
              </Button>
              <Button variant="outline" className="rounded-full" onClick={() => exportStatement("pdf")} data-testid="stmt-pdf">
                <FileDown className="h-4 w-4 mr-2" /> {t("pdf")}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { l: t("periodOpening"), v: formatEUR(statement.period_opening), a: "text-muted-foreground" },
              { l: t("totalIn"), v: formatEUR(statement.total_in), a: "text-emerald-400" },
              { l: t("totalOut"), v: formatEUR(statement.total_out), a: "text-rose-400" },
              { l: t("closingBalance"), v: formatEUR(statement.closing_balance), a: "text-primary" },
            ].map((k, i) => (
              <div key={i} className="p-3 rounded-md border border-border">
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{k.l}</div>
                <div className={`font-mono font-bold text-lg tabular-nums ${k.a}`}>{k.v}</div>
              </div>
            ))}
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("date")}</TableHead>
                <TableHead>{t("reference")}</TableHead>
                <TableHead>{t("counterpart")}</TableHead>
                <TableHead>{t("note")}</TableHead>
                <TableHead className="text-right">{t("in")}</TableHead>
                <TableHead className="text-right">{t("out")}</TableHead>
                <TableHead className="text-right">{t("balance")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(statement.entries || []).map(e => (
                <TableRow key={e.id} data-testid={`entry-row-${e.id}`}>
                  <TableCell className="font-mono text-xs">{(e.created_at || "").slice(0, 16).replace("T", " ")}</TableCell>
                  <TableCell>
                    <div className="text-xs font-mono">{e.reference_no || "—"}</div>
                    <Badge variant="outline" className="mt-1 text-[10px]">{t(refTypeKey(e.reference_type))}</Badge>
                  </TableCell>
                  <TableCell>{e.counterpart || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs max-w-[200px] truncate">{e.note || ""}</TableCell>
                  <TableCell className="text-right tabular-nums font-mono text-emerald-400">
                    {e.direction === "in" ? formatEUR(e.amount) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-mono text-rose-400">
                    {e.direction === "out" ? formatEUR(e.amount) : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-mono font-bold">{formatEUR(e.balance_after)}</TableCell>
                  <TableCell className="text-right">
                    {isOwner && (e.reference_type === "manual" || e.reference_type === "opening") && (
                      <Button size="icon" variant="ghost" onClick={() => deleteEntry(e.id)}>
                        <Trash2 className="h-4 w-4 text-rose-400" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!(statement.entries || []).length && (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">{t("noEntries")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Payment method dialog */}
      <Dialog open={showMethod} onOpenChange={setShowMethod}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">{editing ? t("editMethod") : t("newMethod")}</DialogTitle></DialogHeader>
          <form onSubmit={saveMethod} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("methodName")}</Label>
              <Input value={mForm.name} onChange={(e) => setMForm({ ...mForm, name: e.target.value })} data-testid="method-name-input" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("type")}</Label>
                <Select value={mForm.type} onValueChange={(v) => setMForm({ ...mForm, type: v })}>
                  <SelectTrigger data-testid="method-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t("type_cash")}</SelectItem>
                    <SelectItem value="bank">{t("type_bank")}</SelectItem>
                    <SelectItem value="card">{t("type_card")}</SelectItem>
                    <SelectItem value="other">{t("type_other")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("openingBalance")}</Label>
                <Input type="number" step="0.01" value={mForm.opening_balance} onChange={(e) => setMForm({ ...mForm, opening_balance: e.target.value })} data-testid="method-opening-input" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("note")}</Label>
              <Textarea rows={2} value={mForm.note} onChange={(e) => setMForm({ ...mForm, note: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowMethod(false)}>{t("cancel")}</Button>
              <Button type="submit" className="rounded-full" data-testid="method-save">{t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manual entry dialog */}
      <Dialog open={showEntry} onOpenChange={setShowEntry}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">{t("addEntry")}</DialogTitle></DialogHeader>
          <form onSubmit={saveEntry} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("paymentMethod")}</Label>
              <Select value={entry.method_id || undefined} onValueChange={(v) => setEntry({ ...entry, method_id: v })}>
                <SelectTrigger data-testid="entry-method-select"><SelectValue placeholder={t("pickMethod")} /></SelectTrigger>
                <SelectContent>
                  {methods.filter(m => m.active).map(m => <SelectItem key={m.id} value={m.id}>{m.name} · {formatEUR(m.balance)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={entry.direction === "in" ? "default" : "outline"} className={`rounded-full ${entry.direction === "in" ? "bg-emerald-500 hover:bg-emerald-500/90" : ""}`} onClick={() => setEntry({ ...entry, direction: "in" })} data-testid="entry-in-btn">
                <ArrowDownLeft className="h-4 w-4 mr-2" /> {t("deposit")}
              </Button>
              <Button type="button" variant={entry.direction === "out" ? "default" : "outline"} className={`rounded-full ${entry.direction === "out" ? "bg-rose-500 hover:bg-rose-500/90" : ""}`} onClick={() => setEntry({ ...entry, direction: "out" })} data-testid="entry-out-btn">
                <ArrowUpRight className="h-4 w-4 mr-2" /> {t("withdraw")}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>{t("amount")}</Label>
              <Input type="number" step="0.01" min="0.01" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} data-testid="entry-amount-input" required />
            </div>
            <div className="space-y-1.5">
              <Label>{t("counterpart")}</Label>
              <Input value={entry.counterpart} onChange={(e) => setEntry({ ...entry, counterpart: e.target.value })} placeholder={t("counterpartHint")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("note")}</Label>
              <Textarea rows={2} value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowEntry(false)}>{t("cancel")}</Button>
              <Button type="submit" className="rounded-full" data-testid="entry-save">{t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function refTypeKey(t) {
  return "ref_" + (t || "manual");
}
