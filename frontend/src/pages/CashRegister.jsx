import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, formatEUR } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLang } from "@/i18n";
import CashMovementsPanel from "@/components/CashMovementsPanel";
import { Wallet, Banknote, CreditCard, ArrowLeftRight, Search, ArrowDownRight, ArrowUpRight, X, FileText, Truck, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

function todayISO(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); }

const TYPE_META = {
  cash:  { icon: Banknote,       accent: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-500/40 bg-emerald-500/5",  labelKey: "cash" },
  bank:  { icon: ArrowLeftRight, accent: "text-sky-700 dark:text-sky-400",         border: "border-sky-500/40 bg-sky-500/5",           labelKey: "bank" },
  card:  { icon: CreditCard,     accent: "text-fuchsia-700 dark:text-fuchsia-400", border: "border-fuchsia-500/40 bg-fuchsia-500/5",   labelKey: "card" },
  other: { icon: Wallet,         accent: "text-muted-foreground",                  border: "border-border",                            labelKey: "other" },
};

const REF_META = {
  invoice: { icon: FileText, cls: "text-primary" },
  po:      { icon: Truck,    cls: "text-amber-700 dark:text-amber-400" },
  repair:  { icon: FileText, cls: "text-primary" },
  opening: { icon: Wallet,   cls: "text-muted-foreground" },
  manual:  { icon: Wallet,   cls: "text-muted-foreground" },
};

export default function CashRegister() {
  const { t, meta } = useLang();
  const nav = useNavigate();
  const [dateFrom, setDateFrom] = useState(todayISO(-30));
  const [dateTo, setDateTo]     = useState(todayISO(0));
  const [methodType, setMethodType] = useState("all");
  const [direction, setDirection]   = useState("all");
  const [refType, setRefType]       = useState("all");
  const [q, setQ] = useState("");

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo)   p.set("date_to", dateTo);
    if (methodType !== "all") p.set("method_type", methodType);
    if (direction !== "all")  p.set("direction", direction);
    if (refType !== "all")    p.set("ref_type", refType);
    if (q.trim())             p.set("q", q.trim());
    return p.toString();
  }, [dateFrom, dateTo, methodType, direction, refType, q]);

  const { data, isFetching } = useQuery({
    queryKey: ["ledger", params],
    queryFn: () => api.get("/ledger?" + params).then(r => r.data),
    keepPreviousData: true,
  });

  const methods = data?.methods || [];
  const entries = data?.entries || [];

  const grouped = useMemo(() => {
    const g = { cash: [], bank: [], card: [], other: [] };
    entries.forEach(e => {
      const k = ["cash","bank","card"].includes(e.method_type) ? e.method_type : "other";
      g[k].push(e);
    });
    return g;
  }, [entries]);

  const clear = () => { setMethodType("all"); setDirection("all"); setRefType("all"); setQ(""); };

  const exportExcel = () => {
    if (!entries.length) return;
    // Build header row using current locale
    const header = [
      t("when"), t("direction"), t("type"), t("reference"),
      t("counterpart"), t("paymentMethod"), t("note"), t("amount"),
    ];
    const rowsForXlsx = entries.map((e) => [
      (e.created_at || "").slice(0, 16).replace("T", " "),
      e.direction === "in" ? "IN" : "OUT",
      e.reference_type || "",
      e.reference_no || "",
      e.counterpart || "",
      e.method_name || "",
      e.note || "",
      (e.direction === "in" ? 1 : -1) * Number(e.amount || 0),
    ]);
    // Totals row
    rowsForXlsx.push([]);
    rowsForXlsx.push([t("net"), "", "", "", "", "", "", (data?.net || 0)]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rowsForXlsx]);
    // Column widths
    ws["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 32 }, { wch: 12 }];
    // Format amount column as currency (last col)
    const lastCol = 7;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = 1; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: lastCol })];
      if (cell && typeof cell.v === "number") cell.z = '#,##0.00 "€"';
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ledger");
    const fname = `ledger-${dateFrom || "all"}_${dateTo || "all"}.xlsx`;
    XLSX.writeFile(wb, fname);
  };

  const onRowClick = (e) => {
    if (e.reference_type === "invoice" && e.reference_no) nav(`/invoices?open=${e.reference_no}`);
    // (PO/repair deep-links can be added later — keeping scope tight)
  };

  const renderSection = (typeKey) => {
    const rows = grouped[typeKey] || [];
    const meta_ = TYPE_META[typeKey] || TYPE_META.other;
    const M = meta_.icon;
    if (rows.length === 0) return null;
    const secIn  = rows.filter(r => r.direction === "in").reduce((s, r) => s + r.amount, 0);
    const secOut = rows.filter(r => r.direction === "out").reduce((s, r) => s + r.amount, 0);
    return (
      <Card className={`p-4 md:p-6 border ${meta_.border} space-y-3`} data-testid={`ledger-section-${typeKey}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <M className={`h-5 w-5 ${meta_.accent}`} />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("section")}</div>
              <div className="font-display text-xl font-bold">{t(meta_.labelKey)}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap font-mono tabular-nums text-sm">
            <span className="text-emerald-700 dark:text-emerald-400">+{formatEUR(secIn)}</span>
            <span className="text-rose-600 dark:text-rose-400">−{formatEUR(secOut)}</span>
            <span className={`font-bold ${meta_.accent}`}>{t("net")}: {formatEUR(secIn - secOut)}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="w-24">{t("when")}</TableHead>
              <TableHead className="w-20">{t("direction")}</TableHead>
              <TableHead className="w-24">{t("type")}</TableHead>
              <TableHead>{t("reference")}</TableHead>
              <TableHead>{t("counterpart")}</TableHead>
              <TableHead>{t("paymentMethod")}</TableHead>
              <TableHead>{t("note")}</TableHead>
              <TableHead className="text-right">{t("amount")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map(e => {
                const R = REF_META[e.reference_type] || REF_META.manual;
                const clickable = e.reference_type === "invoice" && e.reference_no;
                return (
                  <TableRow
                    key={e.id}
                    className={clickable ? "cursor-pointer" : ""}
                    onClick={() => clickable && onRowClick(e)}
                    data-testid={`ledger-row-${e.id}`}
                  >
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {(e.created_at || "").slice(0, 10)}<br/>{(e.created_at || "").slice(11, 16)}
                    </TableCell>
                    <TableCell>
                      {e.direction === "in"
                        ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-mono text-xs"><ArrowDownRight className="h-3 w-3" />IN</span>
                        : <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-mono text-xs"><ArrowUpRight className="h-3 w-3" />OUT</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={`inline-flex items-center gap-1 ${R.cls}`}>
                        <R.icon className="h-3 w-3" />
                        {e.reference_type ? (t("ref_" + e.reference_type) !== ("ref_" + e.reference_type) ? t("ref_" + e.reference_type) : e.reference_type) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.reference_no || "—"}</TableCell>
                    <TableCell className="text-xs">{e.counterpart || "—"}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className="text-[10px]">{e.method_name}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[280px]">{e.note || ""}</TableCell>
                    <TableCell className={`text-right tabular-nums font-mono font-bold ${e.direction === "in" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {e.direction === "in" ? "+" : "−"}{formatEUR(e.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6" data-testid="cash-register-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("workshopBooks")}</div>
        <h1 className="font-display text-4xl font-black tracking-tight">{t("cashRegister")}</h1>
        <p className="text-muted-foreground mt-2">{t("cashRegisterSub")}</p>
      </div>

      {/* Method KPI cards — cash / bank / card side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {methods.filter(m => m.active).map(m => {
          const meta_ = TYPE_META[m.type] || TYPE_META.other;
          const M = meta_.icon;
          return (
            <Card key={m.id} className={`p-4 border ${meta_.border}`} data-testid={`ledger-kpi-${m.type}-${m.id}`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t(meta_.labelKey)}</div>
                  <div className="font-medium truncate">{m.name}</div>
                  {m.note && <div className="text-[10px] text-muted-foreground truncate">{m.note}</div>}
                  <div className={`font-display text-2xl font-black tabular-nums mt-1 ${meta_.accent}`}>{formatEUR(m.balance)}</div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-1">
                    <span className="text-emerald-600 dark:text-emerald-400">+{formatEUR(m.in_total)}</span>
                    <span className="mx-1">·</span>
                    <span className="text-rose-600 dark:text-rose-400">−{formatEUR(m.out_total)}</span>
                  </div>
                </div>
                <M className={`h-5 w-5 ${meta_.accent}`} />
              </div>
            </Card>
          );
        })}
        {methods.filter(m => m.active).length === 0 && (
          <Card className="p-6 border-border text-center text-sm text-muted-foreground md:col-span-4">
            {t("noPaymentMethods")}
          </Card>
        )}
      </div>

      {/* Filters + search */}
      <Card className="p-4 border-border">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div className="space-y-1"><Label className="text-[10px] uppercase font-mono text-muted-foreground">{t("from")}</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="ledger-from" /></div>
          <div className="space-y-1"><Label className="text-[10px] uppercase font-mono text-muted-foreground">{t("to")}</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="ledger-to" /></div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-mono text-muted-foreground">{t("section")}</Label>
            <Select value={methodType} onValueChange={setMethodType}>
              <SelectTrigger data-testid="ledger-method-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allTypes")}</SelectItem>
                <SelectItem value="cash">{t("cash")}</SelectItem>
                <SelectItem value="bank">{t("bank")}</SelectItem>
                <SelectItem value="card">{t("card")}</SelectItem>
                <SelectItem value="other">{t("other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-mono text-muted-foreground">{t("direction")}</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger data-testid="ledger-direction"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all")}</SelectItem>
                <SelectItem value="in">{t("in")}</SelectItem>
                <SelectItem value="out">{t("out")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-mono text-muted-foreground">{t("type")}</Label>
            <Select value={refType} onValueChange={setRefType}>
              <SelectTrigger data-testid="ledger-ref-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("all")}</SelectItem>
                <SelectItem value="invoice">{t("ref_invoice")}</SelectItem>
                <SelectItem value="po">{t("ref_po")}</SelectItem>
                <SelectItem value="manual">{t("ref_manual")}</SelectItem>
                <SelectItem value="opening">{t("ref_opening")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-1">
            <Label className="text-[10px] uppercase font-mono text-muted-foreground">{t("search")}</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchLedgerPh")} className="pl-8" data-testid="ledger-search" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
          <div className="text-[11px] font-mono text-muted-foreground">
            {isFetching ? "…" : `${data?.count || 0} ${t("entries")}`} · <span className="text-emerald-700 dark:text-emerald-400">+{formatEUR(data?.in_total || 0)}</span> · <span className="text-rose-600 dark:text-rose-400">−{formatEUR(data?.out_total || 0)}</span> · {t("net")} <strong>{formatEUR(data?.net || 0)}</strong>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={exportExcel}
              disabled={!entries.length}
              className="rounded-full border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
              data-testid="ledger-export-excel"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> {t("exportExcel")}
            </Button>
            <Button variant="ghost" size="sm" onClick={clear} className="rounded-full" data-testid="ledger-clear-filters">
              <X className="h-3.5 w-3.5 mr-1" /> {t("clearFilters")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Sections — one per method type */}
      {renderSection("cash")}
      {renderSection("bank")}
      {renderSection("card")}
      {renderSection("other")}
      {entries.length === 0 && (
        <Card className="p-16 border-border text-center text-muted-foreground">{t("noLedgerEntries")}</Card>
      )}

      {/* Manual movement entry — still available at the bottom */}
      <CashMovementsPanel date={dateTo} />
    </div>
  );
}
