import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";

const CATEGORIES = ["deposit", "withdrawal", "expense", "other"];

export default function CashMovementsPanel({ date }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [form, setForm] = useState({ direction: "OUT", amount: "", category: "expense", note: "", payment_method_id: "" });
  const [saving, setSaving] = useState(false);

  const { data: movements = [] } = useQuery({
    queryKey: ["cash-movements", date],
    queryFn: () => api.get(`/cash-movements?date=${date}`).then(r => r.data),
  });
  const { data: pm } = useQuery({ queryKey: ["pay-summary"], queryFn: () => api.get("/payments/summary").then(r => r.data) });
  const methods = (pm?.methods || []).filter(m => m.active);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.amount) return;
    setSaving(true);
    try {
      await api.post("/cash-movements", {
        date,
        direction: form.direction,
        amount: Number(form.amount),
        category: form.category,
        note: form.note,
        payment_method_id: form.payment_method_id || null,
      });
      toast.success(t("cashMovementSaved"));
      setForm({ direction: "OUT", amount: "", category: "expense", note: "", payment_method_id: "" });
      qc.invalidateQueries({ queryKey: ["cash-movements", date] });
      qc.invalidateQueries({ queryKey: ["till", date] });
      qc.invalidateQueries({ queryKey: ["pay-summary"] });
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!window.confirm(t("delete") + "?")) return;
    try {
      await api.delete(`/cash-movements/${id}`);
      qc.invalidateQueries({ queryKey: ["cash-movements", date] });
      qc.invalidateQueries({ queryKey: ["till", date] });
      qc.invalidateQueries({ queryKey: ["pay-summary"] });
      toast.success(t("delete"));
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <Card className="p-6 border-border" data-testid="cash-movements-panel">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-primary">{t("manualCashMoves")}</div>
          <h3 className="font-display text-xl font-bold">{t("manualCashMovesTitle")}</h3>
        </div>
      </div>

      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
        <div className="space-y-1">
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("direction")}</Label>
          <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
            <SelectTrigger data-testid="cash-direction"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="IN">{t("cashIn")}</SelectItem>
              <SelectItem value="OUT">{t("cashOut")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("amount")} €</Label>
          <Input required type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="cash-amount" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("category")}</Label>
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
            <SelectTrigger data-testid="cash-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{t(`cashCat_${c}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("paymentMethod")}</Label>
          <Select value={form.payment_method_id || "none"} onValueChange={(v) => setForm({ ...form, payment_method_id: v === "none" ? "" : v })}>
            <SelectTrigger data-testid="cash-method"><SelectValue placeholder={t("pickMethod")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {methods.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 md:col-span-1">
          <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("note")}</Label>
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="cash-note" />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={saving} className="rounded-full w-full bg-primary hover:bg-primary/90" data-testid="cash-save">
            <Plus className="h-4 w-4 mr-1" /> {t("add")}
          </Button>
        </div>
      </form>

      <Table>
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead className="w-20">{t("direction")}</TableHead>
          <TableHead>{t("category")}</TableHead>
          <TableHead>{t("paymentMethod")}</TableHead>
          <TableHead>{t("note")}</TableHead>
          <TableHead className="text-right">{t("amount")}</TableHead>
          <TableHead className="w-10" />
        </TableRow></TableHeader>
        <TableBody>
          {movements.map(m => (
            <TableRow key={m.id} data-testid={`cash-row-${m.id}`}>
              <TableCell>
                {m.direction === "IN"
                  ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-mono text-xs"><ArrowDownRight className="h-3 w-3" />IN</span>
                  : <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-mono text-xs"><ArrowUpRight className="h-3 w-3" />OUT</span>}
              </TableCell>
              <TableCell className="text-xs">{t(`cashCat_${m.category}`) || m.category}</TableCell>
              <TableCell className="text-xs font-mono text-muted-foreground">{m.payment_method_name || "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{m.note}</TableCell>
              <TableCell className={`text-right tabular-nums font-mono font-bold ${m.direction === "IN" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {m.direction === "IN" ? "+" : "−"}{formatEUR(m.amount)}
              </TableCell>
              <TableCell><Button size="icon" variant="ghost" onClick={() => del(m.id)}><Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" /></Button></TableCell>
            </TableRow>
          ))}
          {!movements.length && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">—</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}
