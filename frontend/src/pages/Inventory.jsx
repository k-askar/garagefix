import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError, money, HIDDEN_PRICE } from "@/lib/api";
import SearchableSelect from "@/components/SearchableSelect";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Pencil, Trash2, Printer, Upload, Car, Download, Tags, FileDown, Package, TrendingDown, TrendingUp, Wallet, AlertTriangle, ArrowDownRight, ArrowUpRight, Wrench, Warehouse, PackagePlus, PackageMinus, ClipboardList, User, Camera, Boxes } from "lucide-react";
import { toast } from "sonner";
import Barcode from "react-barcode";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/i18n";
import { printLabels } from "@/lib/barcode-batch";
import { downloadListReportPdf, printListReport } from "@/lib/reports";
import BarcodeScannerDialog from "@/components/BarcodeScannerDialog";
import VariantPickerDialog from "@/components/VariantPickerDialog";
import VariantsManagerDialog from "@/components/VariantsManagerDialog";

const CATEGORIES = ["Engine", "Brakes", "Filters", "Lubricants", "Electrical", "Body", "Tyres", "Suspension", "Transmission", "General"];

/* ─────────────────────────────────────────────────────────────
   ITEM FORM — create/edit a single part (used by Overview tab)
   ───────────────────────────────────────────────────────────── */
function ItemForm({ initial, suppliers, onSubmit, onCancel, t }) {
  const [data, setData] = useState(initial || {
    name: "", name_ar: "", sku: "", barcode: "", category: "General",
    description: "", notes: "",
    cost_price: 0, selling_price: 0, quantity: 0, reorder_point: 5,
    unit: "pcs", supplier_id: "", location: "", compatible_vehicles: "",
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(data); }} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>{t("partName")} *</Label>
          <Input required value={data.name} onChange={(e) => set("name", e.target.value)} placeholder="Oil Filter Bosch" data-testid="item-name-input" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("partNameAr")} <span className="text-[10px] text-muted-foreground">({t("arabicOptional")})</span></Label>
          <Input value={data.name_ar || ""} onChange={(e) => set("name_ar", e.target.value)} placeholder="فلتر زيت بوش" dir="rtl" data-testid="item-name-ar-input" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("sku")} <span className="text-[10px] text-muted-foreground">({t("autoIfEmpty")})</span></Label>
          <Input value={data.sku || ""} onChange={(e) => set("sku", e.target.value)} data-testid="item-sku-input" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("barcode")} <span className="text-[10px] text-muted-foreground">({t("autoIfEmpty")})</span></Label>
          <Input value={data.barcode || ""} onChange={(e) => set("barcode", e.target.value)} data-testid="item-barcode-input" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("category")}</Label>
          <Select value={data.category} onValueChange={(v) => set("category", v)}>
            <SelectTrigger data-testid="item-category-select"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("unit")}</Label>
          <Input value={data.unit} onChange={(e) => set("unit", e.target.value)} placeholder="pcs / L / kg" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("costPrice")} (€)</Label>
          <Input type="number" step="0.01" value={data.cost_price} onChange={(e) => set("cost_price", Number(e.target.value))} data-testid="item-cost-input" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("sellingPrice")} (€)</Label>
          <Input type="number" step="0.01" value={data.selling_price} onChange={(e) => set("selling_price", Number(e.target.value))} data-testid="item-price-input" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("quantityInStock")}</Label>
          <Input type="number" value={data.quantity} onChange={(e) => set("quantity", Number(e.target.value))} data-testid="item-qty-input" />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-600" /> {t("reorderPoint")}</Label>
          <Input type="number" value={data.reorder_point} onChange={(e) => set("reorder_point", Number(e.target.value))} data-testid="item-reorder-input" />
          <p className="text-[10px] text-muted-foreground">{t("reorderHint")}</p>
        </div>
        <div className="space-y-1.5">
          <Label>{t("supplier")}</Label>
          <SearchableSelect
            value={data.supplier_id}
            onChange={(v) => set("supplier_id", v)}
            options={suppliers.map(s => ({ value: s.id, label: s.name }))}
            emptyLabel={t("none")}
            searchPlaceholder={t("search")}
            placeholder={t("pickSupplier")}
            testId="item-supplier-select"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("locationBin")}</Label>
          <Input value={data.location || ""} onChange={(e) => set("location", e.target.value)} placeholder="Rack A-2" />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>{t("compatibleVehicles")}</Label>
          <Input value={data.compatible_vehicles || ""} onChange={(e) => set("compatible_vehicles", e.target.value)} placeholder="VW Golf 2015+, BMW 3-series..." />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>{t("description")}</Label>
          <Textarea rows={2} value={data.description || ""} onChange={(e) => set("description", e.target.value)} placeholder={t("descriptionHint")} />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label className="flex items-center gap-1.5"><ClipboardList className="h-3 w-3 text-primary" /> {t("notes")}</Label>
          <Textarea rows={3} value={data.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder={t("notesHint")} data-testid="item-notes-input" />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>{t("close")}</Button>
        <Button type="submit" data-testid="item-save-button" className="bg-primary hover:bg-primary/90 rounded-full">{t("savePart")}</Button>
      </DialogFooter>
    </form>
  );
}

function printBarcode(item) {
  const w = window.open("", "_blank", "width=420,height=320");
  const svg = document.getElementById(`barcode-svg-${item.id}`)?.outerHTML || "";
  w.document.write(`<html><head><title>${item.sku}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700&display=swap" rel="stylesheet">
    <style>
      body{font-family:sans-serif;text-align:center;padding:16px}
      h3{margin:6px 0;font-size:15px;font-weight:700}
      .ar{font-family:'Cairo','Amiri','Traditional Arabic',sans-serif;font-size:15px;font-weight:700;color:#111;direction:rtl;margin:4px 0 8px}
      p{margin:2px 0;font-size:12px;color:#333}
    </style>
    </head><body>
    <h3>${item.name}</h3>
    ${item.name_ar ? `<div class="ar">${item.name_ar}</div>` : ""}
    <p>${item.sku} · €${Number(item.selling_price).toFixed(2)}</p>
    ${svg}
    <p>${item.barcode}</p>
    </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

/* ─────────────────────────────────────────────────────────────
   WITHDRAW PANEL — the OUT workflow
   ───────────────────────────────────────────────────────────── */
function WithdrawPanel({ items, invalidate, t, canSeePrices }) {
  const { user } = useAuth();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(1);
  const [destination, setDestination] = useState("");        // "" | "garage" | repair_id
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  // When a scanned code hits a master item with variants, we pop a picker
  // dialog so the user can drill into the exact sub-item being withdrawn.
  const [pickerMaster, setPickerMaster] = useState(null);
  const [pickerVariants, setPickerVariants] = useState([]);

  const { data: openCards = [] } = useQuery({
    queryKey: ["repairs-open"],
    queryFn: () => api.get("/repairs").then(r => r.data.filter(c => ["open", "in_progress"].includes(c.status))),
  });

  const picked = items.find(i => i.id === itemId);
  const isGarage = destination === "garage";
  const isCard = destination && destination !== "garage";
  const chosenCard = openCards.find(c => c.id === destination);

  // Look up an item by scanned/typed code and either select it directly OR,
  // when the code points to a master with variants, open the picker so the
  // user drills down to the exact sub-item.
  const resolveCode = async (code) => {
    const c = (code || "").trim();
    if (!c) return;
    try {
      const { data } = await api.get(`/inventory/scan?code=${encodeURIComponent(c)}`);
      setManualCode("");
      if (data.mode === "variants") {
        setPickerMaster(data.master);
        setPickerVariants(data.variants || []);
        toast.info(`${data.master.name} · ${(data.variants || []).length} sub-artikelen — kies er één`);
        return;
      }
      // mode === "single"
      const found = data.item;
      setItemId(found.id);
      toast.success(`${found.name} · ${found.quantity} ${t("inStock")}`);
    } catch (err) {
      // Fall back to the (older) client-side search so bulk-scan flows that
      // happen while the network hiccups still resolve locally.
      const found = items.find(i => i.barcode === c || i.sku === c);
      if (!found) { toast.error(t("noMatchingBarcode")); return; }
      setItemId(found.id); setManualCode("");
      toast.success(`${found.name} · ${found.quantity} ${t("inStock")}`);
    }
  };

  const scanCode = () => resolveCode(manualCode);
  const onScannerDecoded = (text) => resolveCode(text);

  const onPickVariant = (v) => {
    // The variant may not be in the parent-filtered `items` prop — fetch its
    // freshest quantity from the picker payload directly.
    setItemId(v.id);
    toast.success(`${v.name} · ${v.quantity} ${t("inStock")}`);
  };

  const submit = async () => {
    if (!itemId) return toast.error(t("pickPart"));
    if (!destination) return toast.error(t("pickDestination"));
    if (isGarage && !reason.trim()) return toast.error(t("reasonRequired"));
    const q = Number(qty);
    if (!q || q < 1) return toast.error(t("invalidQty"));
    if (picked && q > picked.quantity) return toast.error(`${t("notEnoughStock")}: ${picked.quantity}`);
    setBusy(true);
    try {
      const body = {
        type: "OUT",
        item_id: itemId,
        quantity: q,
        unit_price: Number(picked?.selling_price || 0),
        note: isGarage ? reason.trim() : "",
        internal_use: isGarage,
        internal_reason: isGarage ? reason.trim() : "",
        repair_id: isCard ? destination : null,
      };
      await api.post("/transactions", body);
      toast.success(isGarage
        ? t("withdrawnGarage")
        : t("withdrawnCard", { card: chosenCard?.card_number || "" }));
      setItemId(""); setQty(1); setDestination(""); setReason("");
      invalidate();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-6 border-rose-500/30 bg-rose-500/5 space-y-5" data-testid="withdraw-panel">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center">
          <PackageMinus className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-xl font-bold">{t("withdrawStock")}</div>
          <p className="text-xs text-muted-foreground">{t("withdrawSub")}</p>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          <User className="h-3 w-3 mr-1" />{user?.name || user?.email || "—"}
        </Badge>
      </div>

      {/* STEP 1 — pick part (scan or search) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">1 · {t("scanOrSku")}</Label>
          <div className="flex gap-2">
            <Input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder={t("scanBarcodeOrSku")}
              onKeyDown={(e) => { if (e.key === "Enter") scanCode(); }}
              data-testid="withdraw-scan-input"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="rounded-full shrink-0 border-primary/40 text-primary hover:bg-primary/10"
              onClick={() => setScannerOpen(true)}
              title={t("scanBarcodeCamera")}
              data-testid="withdraw-open-scanner"
            >
              <Camera className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" className="rounded-full shrink-0" onClick={scanCode}>{t("load")}</Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{t("orSearchStock")}</Label>
          <SearchableSelect
            value={itemId}
            onChange={setItemId}
            options={items.filter(i => i.quantity > 0).map(i => ({
              value: i.id,
              label: i.name_ar ? `${i.name} · ${i.name_ar}` : i.name,
              secondary: `${i.sku} · ${i.quantity} ${t("inStock")} · ${money(i.selling_price, canSeePrices)}`,
            }))}
            emptyLabel={"— " + t("pickFromStock") + " —"}
            searchPlaceholder={t("searchByNameSku")}
            placeholder={t("pickPartFromStock")}
            testId="withdraw-item-select"
          />
        </div>
      </div>

      {picked && (
        <div className="rounded-md border border-border bg-background/60 p-3 flex items-center justify-between flex-wrap gap-3" data-testid="withdraw-picked">
          <div>
            <div className="font-semibold">{picked.name}</div>
            {picked.name_ar && <div className="text-xs text-muted-foreground" dir="rtl">{picked.name_ar}</div>}
            <div className="text-[11px] font-mono text-muted-foreground">{picked.sku} · {picked.quantity} {picked.unit} · {money(picked.selling_price, canSeePrices)}</div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">{t("qty")}</Label>
            <Input type="number" min="1" max={picked.quantity} value={qty} onChange={(e) => setQty(e.target.value)} className="w-24" data-testid="withdraw-qty" />
          </div>
        </div>
      )}

      {/* STEP 2 — destination */}
      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">2 · {t("destination")}</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDestination("garage")}
            className={`text-left rounded-md border p-3 transition-all ${isGarage ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}
            data-testid="withdraw-dest-garage"
          >
            <div className="flex items-center gap-2">
              <Warehouse className="h-4 w-4 text-primary" />
              <div className="font-medium text-sm">{t("forTheGarage")}</div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{t("forTheGarageHint")}</p>
          </button>
          <div>
            <SearchableSelect
              value={isCard ? destination : ""}
              onChange={(v) => setDestination(v)}
              options={openCards.map(c => ({
                value: c.id,
                label: `${c.card_number} · ${[c.car_make, c.car_model].filter(Boolean).join(" ") || t("vehicle")}`,
                secondary: `${c.customer_name || t("walkIn")} · ${c.car_plate || "—"}`,
              }))}
              emptyLabel={"— " + t("noOpenCards") + " —"}
              searchPlaceholder={t("searchCard")}
              placeholder={t("pickOpenCard")}
              testId="withdraw-dest-card"
            />
            {isCard && chosenCard && (
              <div className="text-[11px] font-mono text-primary mt-1">
                → {chosenCard.card_number} · {[chosenCard.car_make, chosenCard.car_model].filter(Boolean).join(" ")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STEP 3 — reason (garage only) */}
      {isGarage && (
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-widest font-mono text-rose-600 dark:text-rose-400">
            3 · {t("withdrawReason")} *
          </Label>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("withdrawReasonHint")}
            data-testid="withdraw-reason"
          />
        </div>
      )}

      <div className="flex justify-end">
        <Button
          className="rounded-full bg-rose-600 hover:bg-rose-600/90 min-w-[180px]"
          onClick={submit}
          disabled={busy || !itemId || !destination || (isGarage && !reason.trim())}
          data-testid="withdraw-submit"
        >
          <PackageMinus className="h-4 w-4 mr-2" /> {busy ? t("loading") : t("confirmWithdraw")}
        </Button>
      </div>

      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onDecoded={onScannerDecoded}
        elementId="withdraw-bcode-scanner"
      />

      <VariantPickerDialog
        open={!!pickerMaster}
        onOpenChange={(v) => { if (!v) { setPickerMaster(null); setPickerVariants([]); } }}
        master={pickerMaster}
        variants={pickerVariants}
        onPick={onPickVariant}
      />
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   REPORT PANEL — filterable transaction ledger
   ───────────────────────────────────────────────────────────── */
function ReportPanel({ t }) {
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const { data: txns = [], isFetching } = useQuery({
    queryKey: ["txns"],
    queryFn: () => api.get("/transactions?limit=500").then(r => r.data),
  });
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return txns.filter(x => {
      if (type !== "all" && x.type !== type) return false;
      if (!s) return true;
      return (x.item_name || "").toLowerCase().includes(s)
          || (x.item_sku || "").toLowerCase().includes(s)
          || (x.created_by_name || x.created_by || "").toLowerCase().includes(s)
          || (x.repair_number || "").toLowerCase().includes(s);
    });
  }, [txns, type, q]);

  return (
    <Card className="p-4 border-border">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchTxns")} className="pl-9" data-testid="report-search" />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-36" data-testid="report-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            <SelectItem value="IN">{t("in")}</SelectItem>
            <SelectItem value="OUT">{t("out")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-[11px] font-mono text-muted-foreground">
          {isFetching ? "…" : `${filtered.length} ${t("entries")}`}
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-24">{t("when")}</TableHead>
              <TableHead className="w-16">{t("type")}</TableHead>
              <TableHead>{t("part")}</TableHead>
              <TableHead>{t("destination")}</TableHead>
              <TableHead>{t("byEmployee")}</TableHead>
              <TableHead className="text-right">{t("qty")}</TableHead>
              <TableHead className="text-right">{t("total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(x => (
              <TableRow key={x.id} data-testid={`txn-row-${x.id}`}>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {(x.created_at || "").slice(0, 10)}<br />{(x.created_at || "").slice(11, 16)}
                </TableCell>
                <TableCell>
                  {x.type === "IN"
                    ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-mono text-xs"><ArrowDownRight className="h-3 w-3" />IN</span>
                    : <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-mono text-xs"><ArrowUpRight className="h-3 w-3" />OUT</span>}
                </TableCell>
                <TableCell>
                  <div className="text-sm">{x.item_name}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{x.item_sku}</div>
                </TableCell>
                <TableCell className="text-xs">
                  {x.type === "IN"
                    ? (x.supplier_name || t("stockIn"))
                    : x.internal_use
                      ? <span className="inline-flex items-center gap-1 text-primary"><Warehouse className="h-3 w-3" />{t("forTheGarage")}</span>
                      : x.repair_number
                        ? <span className="inline-flex items-center gap-1 text-primary"><Wrench className="h-3 w-3" />{x.repair_number}</span>
                        : "—"}
                  {x.internal_reason && <div className="text-[10px] text-muted-foreground italic">· {x.internal_reason}</div>}
                </TableCell>
                <TableCell className="text-xs font-mono">{x.created_by_name || x.created_by || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{x.quantity}</TableCell>
                <TableCell className={`text-right tabular-nums font-mono font-bold ${x.type === "IN" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {formatEUR(x.total)}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow><TableCell colSpan={7} className="text-center py-16 text-muted-foreground">—</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN INVENTORY PAGE
   ───────────────────────────────────────────────────────────── */
export default function Inventory() {
  const qc = useQueryClient();
  const { user, hasPermission } = useAuth();
  const { t, meta } = useLang();
  const isOwner = user?.role === "owner";
  const canEdit = hasPermission("inventory.edit");
  const canDelete = hasPermission("inventory.delete");
  const canImport = hasPermission("inventory.import");
  const canWithdraw = hasPermission("inventory.withdraw");
  // "prices.inventory" hides cost / selling prices + the stock-value KPI from
  // staff whose owner has withheld the permission (mask with `€ ••••`).
  const canSeePrices = hasPermission("prices.inventory");
  const fm = (v) => money(v, canSeePrices);
  const [tab, setTab] = useState("overview");
  const [q, setQ] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [cat, setCat] = useState("all");
  const [showLow, setShowLow] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [labelItem, setLabelItem] = useState(null);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [variantsFor, setVariantsFor] = useState(null);   // master item whose variants are being managed

  const { data: items = [] } = useQuery({ queryKey: ["inv"], queryFn: () => api.get("/inventory").then(r => r.data) });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["sup"],
    queryFn: () => api.get("/suppliers").then(r => r.data),
    // Only fetch suppliers if the current user can actually see them —
    // otherwise the endpoint 403s and we get noise in the console.
    enabled: hasPermission("suppliers.view"),
  });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.get("/settings").then(r => r.data) });

  const invalidate = () => qc.invalidateQueries();

  const filtered = useMemo(() => items.filter(i => {
    // Hide variant rows from the main table — they're managed via the master's
    // "Sub-artikelen" dialog.  Users still see them in the withdraw picker.
    if (i.parent_id) return false;
    const s = q.toLowerCase();
    const match = !s
      || i.name.toLowerCase().includes(s)
      || (i.name_ar || "").toLowerCase().includes(s)
      || i.sku.toLowerCase().includes(s)
      || (i.barcode || "").includes(s);
    const c = cat === "all" || i.category === cat;
    const v = !vehicle || (i.compatible_vehicles || "").toLowerCase().includes(vehicle.toLowerCase());
    const low = !showLow || i.quantity <= i.reorder_point;
    return match && c && v && low;
  }), [items, q, cat, vehicle, showLow]);

  // Group variant counts by master id so we can badge master rows without
  // requiring an extra API call per row.
  const variantCounts = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (it.parent_id) m.set(it.parent_id, (m.get(it.parent_id) || 0) + 1);
    }
    return m;
  }, [items]);

  const kpi = useMemo(() => {
    // Variants are hidden from the main list — the master row already rolls
    // them up.  Count "families" (masters + standalones) as items, but sum
    // units / value across every physical row (variants carry the real stock).
    const topLevel = items.filter(i => !i.parent_id);
    const totalItems = topLevel.length;
    const totalUnits = items.reduce((s, i) => s + (i.quantity || 0), 0);
    const stockValue = items.reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 0), 0);
    const lowCount = items.filter(i => i.quantity <= i.reorder_point).length;
    return { totalItems, totalUnits, stockValue, lowCount };
  }, [items]);

  // Roll-up qty + value + selling-price range per master so the overview and
  // the printable report show one meaningful number instead of the master's
  // own zeros.  (Masters exist to group; the physical stock lives on their
  // variants.)  Standalones without variants keep their own numbers below.
  const variantRollup = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!it.parent_id) continue;
      const cur = m.get(it.parent_id) || { qty: 0, cost: 0, minSell: Infinity, maxSell: -Infinity, count: 0 };
      const q = Number(it.quantity) || 0;
      cur.qty += q;
      cur.cost += (Number(it.cost_price) || 0) * q;
      const sp = Number(it.selling_price) || 0;
      if (sp) { cur.minSell = Math.min(cur.minSell, sp); cur.maxSell = Math.max(cur.maxSell, sp); }
      cur.count += 1;
      m.set(it.parent_id, cur);
    }
    return m;
  }, [items]);

  const save = async (data) => {
    try {
      if (editing) {
        await api.put(`/inventory/${editing.id}`, data);
        toast.success(t("partUpdated"));
      } else {
        const { data: created } = await api.post("/inventory", data);
        toast.success(t("partAdded"));
        setLabelItem(created);
      }
      setOpen(false); setEditing(null); invalidate();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm(t("delete") + "?")) return;
    try { await api.delete(`/inventory/${id}`); toast.success(t("deleted")); invalidate(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/inventory/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported: ${data.created} new, ${data.updated} updated${data.errors?.length ? ` · ${data.errors.length} errors` : ""}`);
      invalidate();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setImporting(false); }
  };

  const downloadTemplate = () => {
    const csv = "name,name_ar,sku,barcode,category,description,notes,cost_price,selling_price,quantity,reorder_point,unit,location,compatible_vehicles\nOil Filter Bosch,فلتر زيت بوش,,,Filters,Standard oil filter,,5.50,12.00,40,10,pcs,Rack A-2,VW Golf 2015+; Audi A3\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "inventory-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSel = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = () => setSelected(s => s.length === filtered.length ? [] : filtered.map(i => i.id));
  const printSelected = () => {
    const sel = items.filter(i => selected.includes(i.id));
    if (!sel.length) return toast.error(t("pickAtLeastOne"));
    printLabels(sel);
  };
  /* Print a printable sheet of barcodes for every part in the current filter
     (or the whole inventory when there is no active search). Skips parts
     that have neither a barcode nor a SKU because there is nothing to stick. */
  const printAllBarcodes = () => {
    const source = q || vehicle || cat !== "all" || showLow ? filtered : items;
    const printable = source.filter(i => i.barcode || i.sku);
    if (!printable.length) return toast.error(t("noItemsToPrint"));
    printLabels(printable);
  };

  const exportReport = async (mode) => {
    // For masters with variants, roll variants up into a single line so the
    // printable report shows one meaningful number per family instead of a
    // master with 0 stock + its variants scattered below.
    const rollupRow = (i) => {
      const r = variantRollup.get(i.id);
      if (!r) {
        return [
          i.name_ar ? `${i.name} · ${i.name_ar}` : i.name,
          i.sku, i.category,
          formatEUR(i.cost_price), formatEUR(i.selling_price),
          i.quantity,
          formatEUR((i.cost_price || 0) * (i.quantity || 0)),
        ];
      }
      const avgCost = r.qty ? r.cost / r.qty : 0;
      const sellRange = r.minSell === r.maxSell
        ? formatEUR(r.minSell === Infinity ? 0 : r.minSell)
        : `${formatEUR(r.minSell)} – ${formatEUR(r.maxSell)}`;
      return [
        `${i.name_ar ? `${i.name} · ${i.name_ar}` : i.name}  (${r.count} sub)`,
        i.sku, i.category,
        formatEUR(avgCost), sellRange,
        r.qty,
        formatEUR(r.cost),
      ];
    };
    const args = {
      title: t("inventory"),
      subtitle: `${filtered.length} ${t("items")}`,
      headers: [t("part"), t("sku"), t("category"), t("costPrice"), t("sellingPrice"), t("qty"), t("value")],
      rows: filtered.map(rollupRow),
      summary: [
        { label: t("stockValueCost"), value: formatEUR(kpi.stockValue) },
        { label: t("lowStock"), value: kpi.lowCount },
      ],
      settings, dir: meta.dir, lang: meta.locale?.slice(0, 2),
    };
    if (mode === "pdf") {
      setExporting(true);
      try { await downloadListReportPdf(args); } finally { setExporting(false); }
    } else printListReport(args);
  };

  return (
    <div className="space-y-6" data-testid="inventory-page">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("workshopStore")}</div>
          <h1 className="font-display text-4xl font-black tracking-tight">{t("inventory")}</h1>
          <p className="text-muted-foreground mt-2">{t("inventorySub")}</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 border-border" data-testid="kpi-total-items">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("totalParts")}</div>
              <div className="font-display text-2xl font-black tabular-nums mt-1">{kpi.totalItems}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{kpi.totalUnits} {t("units")}</div>
            </div>
            <Package className="h-5 w-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4 border-emerald-500/40 bg-emerald-500/5" data-testid="kpi-stock-value">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("stockValueCost")}</div>
              <div className="font-display text-2xl font-black tabular-nums mt-1 text-emerald-700 dark:text-emerald-400" data-testid="kpi-stock-value">{fm(kpi.stockValue)}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{t("atCostPrice")}</div>
            </div>
            <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
        </Card>
        <Card
          className={`p-4 cursor-pointer transition-all ${kpi.lowCount ? "border-amber-500/50 bg-amber-500/10" : "border-border"}`}
          onClick={() => { setShowLow(v => !v); setTab("overview"); }}
          data-testid="kpi-low-stock"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("belowReorder")}</div>
              <div className={`font-display text-2xl font-black tabular-nums mt-1 ${kpi.lowCount ? "text-amber-700 dark:text-amber-400" : ""}`}>{kpi.lowCount}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{showLow ? t("filterActive") : t("clickToFilter")}</div>
            </div>
            <AlertTriangle className={`h-5 w-5 ${kpi.lowCount ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
          </div>
        </Card>
        <Card className="p-4 border-border" data-testid="kpi-user">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("signedInAs")}</div>
              <div className="font-display text-base font-bold mt-1 truncate">{user?.name || user?.email}</div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase">{user?.role}</div>
            </div>
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid grid-cols-3 max-w-lg">
          <TabsTrigger value="overview" data-testid="tab-overview"><Package className="h-3.5 w-3.5 mr-1.5" />{t("overview")}</TabsTrigger>
          <TabsTrigger value="withdraw" data-testid="tab-withdraw" disabled={!canWithdraw} className={!canWithdraw ? "opacity-40 cursor-not-allowed" : ""}><PackageMinus className="h-3.5 w-3.5 mr-1.5" />{t("withdraw")}</TabsTrigger>
          <TabsTrigger value="report" data-testid="tab-report"><ClipboardList className="h-3.5 w-3.5 mr-1.5" />{t("report")}</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW ─────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card className="border-border">
            <div className="p-4 flex flex-wrap gap-3 items-center border-b border-border">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchNameSkuBarcode")} className="pl-9" data-testid="inventory-search" />
              </div>
              <div className="relative w-56">
                <Car className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder='VW Golf 2018' className="pl-9" data-testid="inventory-vehicle-filter" />
              </div>
              <Select value={cat} onValueChange={setCat}>
                <SelectTrigger className="w-40" data-testid="inventory-filter-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allCategories")}</SelectItem>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
                <div className="flex items-center gap-2 flex-wrap ms-auto">
                  {selected.length > 0 && (
                    <Button variant="outline" size="sm" className="rounded-full" onClick={printSelected} data-testid="batch-print-button">
                      <Tags className="h-4 w-4 mr-2" /> {t("printNLabels", { n: selected.length })}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="rounded-full border-primary/40 text-primary hover:bg-primary/10" onClick={printAllBarcodes} disabled={!items.length} title={t("printAllBarcodesHint")} data-testid="print-all-barcodes">
                    <Printer className="h-4 w-4 mr-2" /> {t("printAllBarcodes")}
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => exportReport("pdf")} disabled={exporting} data-testid="inventory-pdf-button">
                    <FileDown className="h-4 w-4 mr-2" /> {exporting ? t("loading") : t("pdf")}
                  </Button>
                  {canImport && (
                    <>
                      <Button variant="outline" size="sm" className="rounded-full" onClick={downloadTemplate}>
                        <Download className="h-4 w-4 mr-2" /> {t("template")}
                      </Button>
                      <label>
                        <input type="file" accept=".csv" className="hidden" onChange={importCsv} data-testid="import-csv-input" />
                        <Button asChild variant="outline" size="sm" className="rounded-full" disabled={importing}>
                          <span className="cursor-pointer"><Upload className="h-4 w-4 mr-2" /> {importing ? t("loading") : t("importCsv")}</span>
                        </Button>
                      </label>
                    </>
                  )}
                  {canEdit && (
                    <DialogTrigger asChild>
                      <Button size="sm" className="rounded-full bg-primary hover:bg-primary/90" data-testid="add-item-button">
                        <Plus className="h-4 w-4 mr-2" /> {t("newPart")}
                      </Button>
                    </DialogTrigger>
                  )}
                </div>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader><DialogTitle className="font-display">{editing ? t("editPart") : t("newPart")}</DialogTitle></DialogHeader>
                  <ItemForm initial={editing} suppliers={suppliers} onSubmit={save} onCancel={() => { setOpen(false); setEditing(null); }} t={t} />
                </DialogContent>
              </Dialog>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox checked={selected.length > 0 && selected.length === filtered.length} onCheckedChange={toggleAll} data-testid="select-all-checkbox" />
                    </TableHead>
                    <TableHead>{t("part")}</TableHead>
                    <TableHead>{t("sku")}</TableHead>
                    <TableHead>{t("category")}</TableHead>
                    <TableHead className="text-right">{t("costPrice")}</TableHead>
                    <TableHead className="text-right">{t("sellingPrice")}</TableHead>
                    <TableHead className="text-right">{t("qty")}</TableHead>
                    <TableHead className="text-right">{t("reorderPt")}</TableHead>
                    <TableHead className="text-right w-32">{t("actionsLabel")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(i => {
                    const rollup = variantRollup.get(i.id);
                    // For masters, the displayed qty / value is the roll-up
                    // of every variant beneath them.  Low-stock threshold
                    // compares against the master's own reorder_point (owner
                    // sets it as "when the whole family should be reordered").
                    const rowQty = rollup ? rollup.qty : (i.quantity || 0);
                    const rowValue = rollup ? rollup.cost : ((i.cost_price || 0) * (i.quantity || 0));
                    const low = rowQty <= (i.reorder_point || 0);
                    const sellingDisplay = rollup
                      ? (rollup.minSell === rollup.maxSell
                          ? fm(rollup.minSell === Infinity ? 0 : rollup.minSell)
                          : (canSeePrices ? `${formatEUR(rollup.minSell)} – ${formatEUR(rollup.maxSell)}` : HIDDEN_PRICE))
                      : fm(i.selling_price);
                    const costDisplay = rollup
                      ? fm(rollup.qty ? rollup.cost / rollup.qty : 0)
                      : fm(i.cost_price);
                    return (
                      <TableRow key={i.id} data-testid={`inventory-row-${i.sku}`} className={low ? "bg-amber-500/5" : ""}>
                        <TableCell>
                          <Checkbox checked={selected.includes(i.id)} onCheckedChange={() => toggleSel(i.id)} data-testid={`select-${i.sku}`} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium flex items-center gap-2">
                            {i.name}
                            {variantCounts.get(i.id) > 0 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-mono border-primary/40 text-primary bg-primary/10 gap-1"
                                data-testid={`master-badge-${i.sku}`}
                              >
                                <Boxes className="h-2.5 w-2.5" /> {variantCounts.get(i.id)} sub
                              </Badge>
                            )}
                          </div>
                          {i.name_ar && <div className="text-xs text-muted-foreground" dir="rtl">{i.name_ar}</div>}
                          <div className="text-[10px] font-mono text-muted-foreground">{i.barcode}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{i.sku}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{i.category}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{costDisplay}</TableCell>
                        <TableCell className="text-right tabular-nums">{sellingDisplay}</TableCell>
                        <TableCell className="text-right">
                          <span className={`tabular-nums font-bold ${low ? "text-amber-700 dark:text-amber-400" : ""}`}>{rowQty}</span>
                          <div className="text-[10px] font-mono text-muted-foreground">
                            {i.unit}{rollup ? ` · ${fm(rowValue)}` : ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {i.reorder_point}
                          {low && <div className="text-[10px] text-amber-700 dark:text-amber-400 font-mono">↓ {t("belowReorder")}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" onClick={() => setLabelItem(i)} data-testid={`print-${i.sku}`}><Printer className="h-4 w-4" /></Button>
                            {canEdit && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setVariantsFor(i)}
                                title="Sub-artikelen beheren"
                                data-testid={`variants-${i.sku}`}
                                className={variantCounts.get(i.id) > 0 ? "text-primary" : ""}
                              >
                                <Boxes className="h-4 w-4" />
                              </Button>
                            )}
                            {canEdit && <Button size="icon" variant="ghost" onClick={() => { setEditing(i); setOpen(true); }} data-testid={`edit-${i.sku}`}><Pencil className="h-4 w-4" /></Button>}
                            {canDelete && <Button size="icon" variant="ghost" onClick={() => del(i.id)} data-testid={`delete-${i.sku}`}><Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" /></Button>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center py-16 text-muted-foreground">{t("noPartsYet")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="withdraw" className="mt-4">
          <WithdrawPanel items={items} invalidate={invalidate} t={t} canSeePrices={canSeePrices} />
        </TabsContent>

        <TabsContent value="report" className="mt-4">
          <ReportPanel t={t} />
        </TabsContent>
      </Tabs>

      {/* Barcode label modal */}
      <Dialog open={!!labelItem} onOpenChange={(o) => !o && setLabelItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">{t("barcodeLabel")}</DialogTitle></DialogHeader>
          {labelItem && (
            <div className="p-4 border border-border rounded-md bg-white text-black text-center space-y-1">
              <div className="text-sm font-semibold">{labelItem.name}</div>
              {labelItem.name_ar ? (
                <div
                  className="text-base font-bold text-gray-800"
                  dir="rtl"
                  style={{ fontFamily: "'Cairo','Amiri','Traditional Arabic',sans-serif" }}
                  data-testid="barcode-label-name-ar"
                >
                  {labelItem.name_ar}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setEditing(labelItem); setLabelItem(null); setOpen(true); }}
                  className="text-[11px] text-primary hover:underline"
                  data-testid="barcode-add-ar-name"
                >
                  + {t("addArabicName") || "أضف الاسم العربي"}
                </button>
              )}
              <div className="text-xs">{labelItem.sku} · {money(labelItem.selling_price, canSeePrices)}</div>
              <div className="flex justify-center">
                <Barcode id={`barcode-svg-${labelItem.id}`} value={labelItem.barcode} height={60} fontSize={12} margin={4} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLabelItem(null)}>{t("close")}</Button>
            <Button className="rounded-full" onClick={() => printBarcode(labelItem)}>
              <Printer className="h-4 w-4 mr-2" /> {t("print")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Variants (sub-items) manager */}
      <VariantsManagerDialog
        open={!!variantsFor}
        onOpenChange={(v) => { if (!v) setVariantsFor(null); }}
        master={variantsFor}
      />
    </div>
  );
}
