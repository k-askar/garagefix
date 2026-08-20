import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLang } from "@/i18n";
import { downloadListReportPdf, printListReport } from "@/lib/reports";
import { Printer, FileDown, FileSpreadsheet, Wallet, TrendingUp, TrendingDown, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import CashMovementsPanel from "@/components/CashMovementsPanel";

function todayISO(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); }

export default function CashRegister() {
  const { t, meta } = useLang();
  const [date, setDate] = useState(todayISO(0));
  const { data } = useQuery({ queryKey: ["till", date], queryFn: () => api.get(`/cash-register?date=${date}`).then(r => r.data) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });
  const [exporting, setExporting] = useState(false);

  const exportReport = async (mode) => {
    const args = {
      title: `Cash Register · ${date}`,
      subtitle: `${data?.invoice_count || 0} paid invoices`,
      headers: ["Time", "Invoice", "Customer", "Method", "Total"],
      rows: (data?.invoices || []).map(i => [
        (i.paid_at || "").slice(11, 16),
        i.invoice_number,
        i.customer_name || "Walk-in",
        i.payment_method_name || "—",
        formatEUR(i.total),
      ]),
      summary: [
        { label: "Revenue", value: formatEUR(data?.revenue) },
        { label: "Tax", value: formatEUR(data?.tax) },
        { label: "Stock IN", value: formatEUR(data?.in_total) },
        { label: "Net flow", value: formatEUR(data?.net_flow) },
      ],
      settings, dir: meta.dir, footerNote: "End-of-day closing report — verified by owner",
    };
    if (mode === "pdf") { setExporting(true); try { await downloadListReportPdf(args); } finally { setExporting(false); } }
    else printListReport(args);
  };

  return (
    <div className="space-y-8" data-testid="till-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">End of day</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Cash Register</h1>
          <p className="text-muted-foreground mt-2">Daily till summary of paid invoices.</p>
        </div>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="space-y-1"><Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" data-testid="till-date" /></div>
          <Button variant="outline" className="rounded-full" onClick={() => setDate(todayISO(0))}>Today</Button>
          <Button variant="outline" className="rounded-full" onClick={() => exportReport("print")} data-testid="till-print"><Printer className="h-4 w-4 mr-2" /> {t("print")}</Button>
          <Button variant="outline" className="rounded-full" onClick={() => exportReport("pdf")} disabled={exporting} data-testid="till-pdf"><FileDown className="h-4 w-4 mr-2" /> {t("pdf")}</Button>
          <Button variant="outline" className="rounded-full" onClick={async () => {
            try {
              const res = await api.get(`/reports/cash-register/excel?date=${date}`, { responseType: "blob" });
              const url = URL.createObjectURL(res.data);
              const a = document.createElement("a"); a.href = url; a.download = `cash-register-${date}.xlsx`;
              document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
            } catch (e) { toast.error(formatApiError(e)); }
          }} data-testid="till-excel"><FileSpreadsheet className="h-4 w-4 mr-2" /> Excel</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Revenue", value: formatEUR(data?.revenue || 0), icon: Wallet, accent: "text-emerald-700 dark:text-emerald-400" },
          { label: "Tax", value: formatEUR(data?.tax || 0), icon: TrendingUp, accent: "text-fuchsia-700 dark:text-fuchsia-400" },
          { label: "Stock IN", value: formatEUR(data?.in_total || 0), icon: TrendingDown, accent: "text-rose-600 dark:text-rose-400" },
          { label: "Net flow", value: formatEUR(data?.net_flow || 0), icon: UsersIcon, accent: "text-primary" },
        ].map((k) => (
          <Card key={k.label} className="p-6 border-border">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">{k.label}</div>
                <div className={`font-display text-3xl font-bold tabular-nums mt-2 ${k.accent}`}>{k.value}</div>
              </div>
              <k.icon className="h-5 w-5 text-muted-foreground" />
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6 border-border overflow-x-auto" data-testid="till-by-method">
        <h3 className="font-display text-xl font-bold mb-4">{t("tillByMethod")}</h3>
        {(() => {
          const grouped = {};
          (data?.invoices || []).forEach(i => {
            const k = i.payment_method_name || "—";
            grouped[k] = grouped[k] || { name: k, count: 0, total: 0 };
            grouped[k].count += 1; grouped[k].total += i.total;
          });
          const rows = Object.values(grouped);
          return (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{t("paymentMethod")}</TableHead>
                <TableHead className="text-right">{t("invoices")}</TableHead>
                <TableHead className="text-right">{t("total")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.name}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono font-bold">{formatEUR(r.total)}</TableCell>
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">—</TableCell></TableRow>}
              </TableBody>
            </Table>
          );
        })()}
      </Card>

      <Card className="p-6 border-border overflow-x-auto">
        <h3 className="font-display text-xl font-bold mb-4">Paid invoices ({data?.invoice_count || 0})</h3>
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Time</TableHead><TableHead>Invoice</TableHead><TableHead>Customer</TableHead>
            <TableHead>{t("paymentMethod")}</TableHead>
            <TableHead className="text-right">Tax</TableHead><TableHead className="text-right">Total</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data?.invoices || []).map(i => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-xs">{(i.paid_at || "").slice(11, 16)}</TableCell>
                <TableCell className="font-mono text-xs">{i.invoice_number}</TableCell>
                <TableCell>{i.customer_name || "Walk-in"}</TableCell>
                <TableCell><span className="text-xs font-mono text-muted-foreground">{i.payment_method_name || "—"}</span></TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatEUR(i.tax || 0)}</TableCell>
                <TableCell className="text-right tabular-nums font-mono font-bold">{formatEUR(i.total)}</TableCell>
              </TableRow>
            ))}
            {!(data?.invoices || []).length && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No paid invoices for this day.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {(data?.by_customer || []).length > 0 && (
        <Card className="p-6 border-border overflow-x-auto">
          <h3 className="font-display text-xl font-bold mb-4">By customer</h3>
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Customer</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.by_customer || []).map(c => (
                <TableRow key={c.customer}><TableCell>{c.customer}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                  <TableCell className="text-right tabular-nums font-mono font-bold">{formatEUR(c.total)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <CashMovementsPanel date={date} />
    </div>
  );
}
