import React, { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, formatEUR } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Sparkles, FileUp, Loader2, Plus, Pause, Trash2, RefreshCw, Building2,
  FileText, Check, X, ScanLine, CircleAlert, PackageCheck, Clock,
} from "lucide-react";
import { toast } from "sonner";

const ENGINE_OPTIONS = [
  { value: "claude", label: "Claude Sonnet 5", hint: "Meest accuraat voor NL/DE facturen", tone: "bg-violet-500/15 text-violet-700 border-violet-500/30" },
  { value: "openai", label: "GPT-5.2",         hint: "Sterk in gemengde talen",           tone: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  { value: "gemini", label: "Gemini 3.1 Pro",  hint: "Snelst & goedkoopst",                tone: "bg-sky-500/15 text-sky-700 border-sky-500/30" },
];

/**
 * Two-step AI invoice / packing-slip scanner.
 *
 * Step 1 (upload):   drag-drop or pick a PDF / JPG / PNG, choose the vision
 *                    engine, watch the spinner while the backend rasterises
 *                    the PDF and calls the LLM.
 * Step 2 (review):   editable table of parsed rows.  Every row carries three
 *                    action buttons — ➕ Enter (commit to inventory),
 *                    ⏸ Wait (stash it for a later delivery), 🗑 Delete
 *                    (drop it entirely).  Barcodes that already exist in
 *                    inventory show a "🔄 UPDATE" badge so the owner knows
 *                    Enter will bump quantity instead of creating a new row.
 */
export default function InvoiceScanDialog({ open, onOpenChange, initialSessionId = null }) {
  const qc = useQueryClient();
  const [engine, setEngine] = useState("claude");
  const [uploading, setUploading] = useState(false);
  const [session, setSession] = useState(null);
  const [savingId, setSavingId] = useState(null);          // item.id currently in flight
  const [rowEdits, setRowEdits] = useState({});            // { itemId: {name, qty, ...} }
  const [partialFor, setPartialFor] = useState(null);      // {itemId, qty} — partial-enter modal
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // Auto-load a session when the parent asks us to resume one (e.g. clicking a
  // row from the "Wachtend" tab).  Cleared when the dialog is closed.
  React.useEffect(() => {
    if (!open) return;
    if (initialSessionId && (!session || session.id !== initialSessionId)) {
      api.get(`/inventory/scan/sessions/${initialSessionId}`)
        .then((r) => setSession(r.data))
        .catch((e) => toast.error(formatApiError(e)));
    }
  }, [open, initialSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setSession(null);
    setRowEdits({});
    setPartialFor(null);
    setUploading(false);
  };

  const doClose = (o) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const uploadFile = async (file) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast.error("Bestand groter dan 20 MB");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("engine", engine);
    setUploading(true);
    const tid = toast.loading(`AI leest ${file.name} met ${ENGINE_OPTIONS.find(e => e.value === engine)?.label}…`);
    try {
      const { data } = await api.post("/inventory/scan/invoice", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 180000,
      });
      setSession(data);
      toast.success(`${data.items.length} regels herkend`, { id: tid });
    } catch (err) {
      toast.error(formatApiError(err), { id: tid });
    } finally {
      setUploading(false);
    }
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f);
  }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetchSession = async () => {
    if (!session?.id) return;
    const { data } = await api.get(`/inventory/scan/sessions/${session.id}`);
    setSession(data);
    qc.invalidateQueries({ queryKey: ["inv"] });
    qc.invalidateQueries({ queryKey: ["waiting-items"] });
  };

  const patchLocal = (iid, patch) => setRowEdits((e) => ({ ...e, [iid]: { ...(e[iid] || {}), ...patch } }));

  const merged = (it) => ({ ...it, ...(rowEdits[it.id] || {}) });

  const enterRow = async (it, partialQty = null) => {
    setSavingId(it.id);
    try {
      const m = merged(it);
      const body = {
        name: m.name,
        name_ar: m.name_ar,
        barcode: m.barcode,
        sku: m.sku,
        quantity: Number(m.quantity) || 0,
        unit: m.unit,
        cost_price: Number(m.cost_price) || 0,
        selling_price: Number(m.selling_price) || 0,
        category: m.category,
      };
      if (partialQty != null) body.enter_partial_qty = Number(partialQty);
      const { data } = await api.post(`/inventory/scan/sessions/${session.id}/items/${it.id}/enter`, body);
      if (data.remaining > 0) {
        toast.success(`${data.entered_qty} ontvangen · ${data.remaining} nog in afwachting`);
      } else {
        toast.success(data.match === "update" ? "Voorraad bijgewerkt" : "Nieuw onderdeel toegevoegd");
      }
      await refetchSession();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSavingId(null); setPartialFor(null); }
  };

  const waitRow = async (it) => {
    setSavingId(it.id);
    try {
      await api.post(`/inventory/scan/sessions/${session.id}/items/${it.id}/wait`);
      toast.info("Verplaatst naar Wachtend");
      await refetchSession();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSavingId(null); }
  };

  const deleteRow = async (it) => {
    setSavingId(it.id);
    try {
      await api.post(`/inventory/scan/sessions/${session.id}/items/${it.id}/delete`);
      toast.success("Regel verwijderd");
      await refetchSession();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setSavingId(null); }
  };

  const enterAll = async () => {
    const pending = (session.items || []).filter((it) => it.status === "pending");
    if (!pending.length) return;
    if (!window.confirm(`${pending.length} openstaande regels toevoegen aan voorraad?`)) return;
    for (const it of pending) {
      try { await enterRow(it); } catch (_) { /* toast already fired */ }
    }
  };

  const supplier = session?.supplier || {};
  const items = session?.items || [];
  const pending  = items.filter(i => i.status === "pending");
  const waiting  = items.filter(i => i.status === "waiting");
  const entered  = items.filter(i => i.status === "entered");
  const deleted  = items.filter(i => i.status === "deleted");

  return (
    <Dialog open={open} onOpenChange={doClose}>
      <DialogContent
        className="max-w-6xl max-h-[94vh] overflow-y-auto"
        data-testid="invoice-scan-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Factuur / Pakbon-scan
          </DialogTitle>
          <DialogDescription>
            Upload een PDF / JPG / PNG van een leveranciers-factuur of pakbon.
            Ons AI leest alle onderdelen en jij beslist per regel: <strong>Toevoegen</strong>, <strong>Wachten</strong> (voor een volgende levering), of <strong>Verwijderen</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* ══════════════ STEP 1 — UPLOAD ══════════════ */}
        {!session && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {ENGINE_OPTIONS.map((e) => (
                <button
                  key={e.value}
                  type="button"
                  onClick={() => setEngine(e.value)}
                  data-testid={`scan-engine-${e.value}`}
                  className={`rounded-xl border-2 p-3 text-left transition ${
                    engine === e.value
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-widest ${e.tone}`}>
                    <Sparkles className="h-3 w-3" /> {e.label}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 leading-snug">{e.hint}</div>
                </button>
              ))}
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition ${
                dragActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/40 hover:bg-primary/5"
              }`}
              data-testid="scan-drop-zone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => uploadFile(e.target.files?.[0])}
                data-testid="scan-file-input"
              />
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <div className="font-mono uppercase text-xs tracking-widest text-primary">
                    AI aan het lezen · dit kan 20-40 sec duren
                  </div>
                  <div className="text-xs text-muted-foreground">Sluit dit venster niet</div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-14 w-14 rounded-full bg-primary/10 grid place-items-center">
                    <FileUp className="h-7 w-7 text-primary" />
                  </div>
                  <div className="font-display text-lg">Sleep hier je factuur of pakbon</div>
                  <div className="text-xs text-muted-foreground">of klik om een bestand te kiezen · PDF, JPG, PNG · max 20 MB</div>
                </div>
              )}
            </div>

            <div className="rounded-md bg-muted/50 border border-border/60 p-3 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-2"><CircleAlert className="h-3.5 w-3.5" /> Tips voor betere herkenning:</div>
              <ul className="pl-5 list-disc space-y-0.5">
                <li>Scan of foto moet <strong>rechtop</strong> en <strong>volledig zichtbaar</strong> zijn</li>
                <li>PDF's tot 6 pagina's worden automatisch verwerkt</li>
                <li>Meerdere onderdelen op één document? Geen probleem — AI leest alles</li>
              </ul>
            </div>
          </div>
        )}

        {/* ══════════════ STEP 2 — REVIEW ══════════════ */}
        {session && (
          <div className="space-y-4">
            {/* Header banner — supplier + doc info + counters */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" /> Leverancier
                    {supplier.suggested_supplier_id && (
                      <span className="text-emerald-600">· auto-match: {supplier.suggested_supplier_name}</span>
                    )}
                  </div>
                  <div className="font-display font-bold text-lg mt-0.5">{supplier.name || "—"}</div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
                    {supplier.kvk && <span>KvK {supplier.kvk}</span>}
                    {supplier.vat_id && <span>BTW {supplier.vat_id}</span>}
                    {supplier.iban && <span className="font-mono">{supplier.iban}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-right">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" /> Document
                  </div>
                  <div className="font-mono text-sm">{session.invoice_number || session.filename}</div>
                  <div className="text-xs text-muted-foreground">{session.invoice_date}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline" className="border-primary/40 text-primary">
                  <PackageCheck className="h-3 w-3 mr-1" /> {entered.length} toegevoegd
                </Badge>
                <Badge variant="outline" className="border-amber-500/40 text-amber-700 bg-amber-50">
                  <Clock className="h-3 w-3 mr-1" /> {waiting.length} wachtend
                </Badge>
                <Badge variant="outline" className="border-border">
                  {pending.length} openstaand
                </Badge>
                {deleted.length > 0 && (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    {deleted.length} verwijderd
                  </Badge>
                )}
                {session.confidence != null && (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    AI-vertrouwen {Math.round((session.confidence || 0) * 100)}%
                  </Badge>
                )}
                <div className="ms-auto flex gap-2">
                  {session.storage_path && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => window.open(`${process.env.REACT_APP_BACKEND_URL}/api/inventory/scan/sessions/${session.id}/file`, "_blank")}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" /> Origineel
                    </Button>
                  )}
                  {pending.length > 0 && (
                    <Button size="sm" className="rounded-full bg-primary hover:bg-primary/90" onClick={enterAll} data-testid="scan-enter-all">
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Alles toevoegen ({pending.length})
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Rows */}
            <div className="space-y-2">
              {items.map((it) => <ScanRow
                  key={it.id}
                  it={merged(it)}
                  original={it}
                  onEdit={(patch) => patchLocal(it.id, patch)}
                  busy={savingId === it.id}
                  onEnter={() => enterRow(it)}
                  onEnterPartial={(q) => enterRow(it, q)}
                  onWait={() => waitRow(it)}
                  onDelete={() => deleteRow(it)}
                  onOpenPartial={() => setPartialFor(it.id)}
                  partialOpen={partialFor === it.id}
                  onClosePartial={() => setPartialFor(null)}
                />)}
              {items.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  Geen regels herkend — probeer een scherpere foto of een ander bestand.
                </div>
              )}
            </div>

            <div className="flex justify-between pt-3 border-t border-border">
              <Button variant="ghost" onClick={reset} data-testid="scan-reset">
                <ScanLine className="h-4 w-4 mr-2" /> Nieuwe scan
              </Button>
              <Button variant="outline" onClick={() => doClose(false)}>
                <Check className="h-4 w-4 mr-2" /> Klaar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── One row in the review table.  Kept local so the parent stays readable. ─── */
function ScanRow({ it, original, onEdit, busy, onEnter, onEnterPartial, onWait, onDelete, onOpenPartial, partialOpen, onClosePartial }) {
  const [partialQty, setPartialQty] = useState(Math.max(1, Math.floor((it.quantity || 1) / 2)));
  const statusStyle = {
    pending:  "border-border bg-card",
    waiting:  "border-amber-500/40 bg-amber-50/60",
    entered:  "border-emerald-500/40 bg-emerald-50/50 opacity-80",
    deleted:  "border-border bg-muted/40 opacity-50",
  }[it.status] || "border-border";

  const isDone = it.status === "entered" || it.status === "deleted";
  const isUpdate = it.match_type === "update";

  return (
    <div className={`rounded-lg border p-3 ${statusStyle}`} data-testid={`scan-row-${original.id}`}>
      <div className="grid grid-cols-12 gap-2 items-start">
        {/* Name + Arabic + notes */}
        <div className="col-span-12 md:col-span-4 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isUpdate ? (
              <Badge variant="outline" className="border-sky-500/40 text-sky-700 bg-sky-50 text-[9px] font-mono uppercase">
                <RefreshCw className="h-2.5 w-2.5 mr-1" /> Update
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 bg-emerald-50 text-[9px] font-mono uppercase">
                <Plus className="h-2.5 w-2.5 mr-1" /> Nieuw
              </Badge>
            )}
            {it.status === "waiting" && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-800 text-[9px] font-mono uppercase">
                <Clock className="h-2.5 w-2.5 mr-1" /> Wachtend
              </Badge>
            )}
            {it.status === "entered" && (
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-800 text-[9px] font-mono uppercase">
                <Check className="h-2.5 w-2.5 mr-1" /> {it.entered_qty} toegevoegd
              </Badge>
            )}
            {it.status === "deleted" && (
              <Badge variant="outline" className="text-[9px] font-mono uppercase text-muted-foreground">Verwijderd</Badge>
            )}
          </div>
          <Input
            value={it.name || ""}
            onChange={(e) => onEdit({ name: e.target.value })}
            disabled={isDone}
            placeholder="Naam"
            className="h-8 font-medium"
            data-testid={`scan-name-${original.id}`}
          />
          <Input
            value={it.name_ar || ""}
            onChange={(e) => onEdit({ name_ar: e.target.value })}
            disabled={isDone}
            dir="rtl"
            placeholder="اسم عربي (اختياري)"
            className="h-7 text-xs"
          />
        </div>

        {/* Barcode + SKU */}
        <div className="col-span-6 md:col-span-2 space-y-1">
          <Label className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Barcode</Label>
          <Input
            value={it.barcode || ""}
            onChange={(e) => onEdit({ barcode: e.target.value })}
            disabled={isDone}
            className="h-7 font-mono text-[11px]"
            placeholder="—"
            data-testid={`scan-barcode-${original.id}`}
          />
          <Input
            value={it.sku || ""}
            onChange={(e) => onEdit({ sku: e.target.value })}
            disabled={isDone}
            className="h-7 font-mono text-[10px] text-muted-foreground"
            placeholder="SKU"
          />
        </div>

        {/* Quantity + unit */}
        <div className="col-span-3 md:col-span-1 space-y-1">
          <Label className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Aantal</Label>
          <Input
            type="number"
            min="1"
            value={it.quantity || 0}
            onChange={(e) => onEdit({ quantity: e.target.value })}
            disabled={isDone}
            className="h-7 text-right tabular-nums"
            data-testid={`scan-qty-${original.id}`}
          />
          <Input
            value={it.unit || "pcs"}
            onChange={(e) => onEdit({ unit: e.target.value })}
            disabled={isDone}
            className="h-6 text-[10px] text-center"
          />
        </div>

        {/* Prices */}
        <div className="col-span-6 md:col-span-2 space-y-1">
          <Label className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Inkoop / stuk</Label>
          <Input
            type="number"
            step="0.01"
            value={it.cost_price || 0}
            onChange={(e) => onEdit({ cost_price: e.target.value })}
            disabled={isDone}
            className="h-7 text-right tabular-nums"
            data-testid={`scan-cost-${original.id}`}
          />
          <Input
            type="number"
            step="0.01"
            value={it.selling_price || 0}
            onChange={(e) => onEdit({ selling_price: e.target.value })}
            disabled={isDone}
            className="h-7 text-right tabular-nums text-primary"
            placeholder="Verkoop"
            data-testid={`scan-sell-${original.id}`}
          />
        </div>

        {/* Category */}
        <div className="col-span-3 md:col-span-1 space-y-1">
          <Label className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Cat.</Label>
          <Input
            value={it.category || "General"}
            onChange={(e) => onEdit({ category: e.target.value })}
            disabled={isDone}
            className="h-7 text-xs"
          />
        </div>

        {/* Actions */}
        <div className="col-span-12 md:col-span-2 flex md:flex-col gap-1.5 md:items-stretch">
          {!isDone && (
            <>
              <Button
                size="sm"
                className="rounded-full bg-primary hover:bg-primary/90 h-8 flex-1 md:flex-none"
                onClick={onEnter}
                disabled={busy}
                data-testid={`scan-enter-${original.id}`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                {isUpdate ? "Bijwerken" : "Toevoegen"}
              </Button>
              {Number(it.quantity) > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full h-7 flex-1 md:flex-none text-[10px]"
                  onClick={onOpenPartial}
                  disabled={busy}
                  data-testid={`scan-partial-${original.id}`}
                  title="Gedeeltelijke levering"
                >
                  Deels…
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="rounded-full h-7 flex-1 md:flex-none border-amber-500/40 text-amber-700 hover:bg-amber-50"
                onClick={onWait}
                disabled={busy}
                data-testid={`scan-wait-${original.id}`}
              >
                <Pause className="h-3 w-3 mr-1" /> Wachten
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full h-7 flex-1 md:flex-none text-rose-600 hover:bg-rose-50"
                onClick={onDelete}
                disabled={busy}
                data-testid={`scan-delete-${original.id}`}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Verwijder
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Partial-delivery inline modal */}
      {partialOpen && (
        <div className="mt-3 rounded-lg border-2 border-primary/40 bg-primary/5 p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-primary mb-2">
            Gedeeltelijke levering — hoeveel is er nu binnengekomen?
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="number"
              min="1"
              max={it.quantity}
              value={partialQty}
              onChange={(e) => setPartialQty(e.target.value)}
              className="h-8 w-24 text-right tabular-nums"
              data-testid={`scan-partial-qty-${original.id}`}
            />
            <span className="text-xs text-muted-foreground">van {it.quantity} {it.unit}</span>
            <Button
              size="sm"
              className="rounded-full bg-primary hover:bg-primary/90 h-7 ms-auto"
              disabled={busy || !partialQty || Number(partialQty) < 1}
              onClick={() => onEnterPartial(partialQty)}
              data-testid={`scan-partial-confirm-${original.id}`}
            >
              <Check className="h-3 w-3 mr-1" /> Bevestig
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={onClosePartial}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">
            De resterende {Math.max(0, Number(it.quantity) - Number(partialQty || 0))} {it.unit} blijven staan onder <strong>Wachtend</strong> tot de rest van de zending binnenkomt.
          </div>
        </div>
      )}
    </div>
  );
}
