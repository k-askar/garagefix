import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, CameraOff, Truck, Search, Plus, ArrowRight, ScanText, Loader2, Sparkles, Upload, X, Aperture } from "lucide-react";
import { toast } from "sonner";
import SearchableSelect from "@/components/SearchableSelect";
import PlateBadge from "@/components/PlateBadge";
import { useLang } from "@/i18n";

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => {
    const s = String(r.result || "");
    resolve(s.includes(",") ? s.split(",")[1] : s);
  };
  r.onerror = reject;
  r.readAsDataURL(file);
});

// Downscale a phone photo before uploading — capped at ~1600 px on the long side.
async function shrinkImage(file, maxSide = 1600, quality = 0.82) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  const blob = await new Promise(res => c.toBlob(res, "image/jpeg", quality));
  const b64 = await fileToBase64(blob);
  return { base64: b64, previewUrl: URL.createObjectURL(blob) };
}

export default function DeliveryScan() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { t } = useLang();
  const scannerRef = useRef(null);
  const fileInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [manual, setManual] = useState("");
  const [detected, setDetected] = useState(null);
  const [targetCard, setTargetCard] = useState(null);
  const [form, setForm] = useState({ name: "", part_number: "", quantity: 1, unit_price: "", unit_cost: "", tax_exempt: false, supplier_id: "" });
  const [busy, setBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPreview, setOcrPreview] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  // Multi-line pakbon → user picks which OCR-detected parts to import.
  // Every part starts checked so "Add N to card" is one click.
  const [ocrRowChecked, setOcrRowChecked] = useState({});
  const [bulkBusy, setBulkBusy] = useState(false);
  // Live A4 camera modal state
  const [a4CamOpen, setA4CamOpen] = useState(false);
  const [a4CamErr, setA4CamErr] = useState("");
  const a4VideoRef = useRef(null);
  const a4StreamRef = useRef(null);

  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/suppliers").then(r => r.data) });

  useEffect(() => {
    if (!scanning) return;
    const id = "delivery-scan-cam";
    scannerRef.current = new Html5Qrcode(id);
    scannerRef.current.start(
      { facingMode: "environment" },
      { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.85, 520), height: Math.min(h * 0.55, 300) }) },
      (text) => { setScanning(false); onScanned(text); },
      () => {}
    ).catch((e) => { setScanError(String(e?.message || e)); setScanning(false); });
    return () => { try { scannerRef.current?.stop().then(() => scannerRef.current?.clear()).catch(() => {}); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const onScanned = async (code) => {
    setBusy(true); setDetected(null); setTargetCard(null);
    try {
      const { data } = await api.post("/special-parts/scan-delivery", { code });
      setDetected(data);
      if (data.matched && data.matches.length === 1) {
        setTargetCard(data.matches[0]);
      } else if (data.matched && data.matches.length > 1) {
        toast(t("multipleCardsMatch"));
      } else {
        toast(t("noCardMatch", { plate: data.detected_plate || code }));
      }
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const pickA4 = () => fileInputRef.current?.click();
  const pickGallery = () => galleryInputRef.current?.click();

  // ── Live camera capture for the A4 delivery note ──────────────────────────
  // Requests the rear camera at high resolution, streams it into a <video>,
  // then draws the current frame to a canvas → blob → File and hands it off
  // to the existing OCR pipeline (onA4Chosen).  Falls back to the hidden
  // file input when getUserMedia is unavailable or denied.
  const openA4Camera = async () => {
    setA4CamErr("");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      // Legacy browser or insecure context → fall back to the file picker.
      return pickA4();
    }
    setA4CamOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      a4StreamRef.current = stream;
      // Wait for the <video> element to mount, then attach.
      requestAnimationFrame(() => {
        if (a4VideoRef.current) {
          a4VideoRef.current.srcObject = stream;
          a4VideoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setA4CamErr(String(err?.message || err));
    }
  };

  const closeA4Camera = () => {
    const s = a4StreamRef.current;
    if (s) {
      s.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      a4StreamRef.current = null;
    }
    setA4CamOpen(false);
    setA4CamErr("");
  };

  const captureA4 = async () => {
    const v = a4VideoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width  = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    if (!blob) { setA4CamErr("Capture failed"); return; }
    const file = new File([blob], `a4-${Date.now()}.jpg`, { type: "image/jpeg" });
    closeA4Camera();
    // Reuse the existing onA4Chosen pipeline with a synthetic event
    await onA4Chosen({ target: { files: [file], value: "" } });
  };

  // Stop the stream if the component unmounts while the modal is open.
  useEffect(() => () => {
    const s = a4StreamRef.current;
    if (s) s.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
  }, []);

  const onA4Chosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
      toast.error(t("ocrUnsupportedFormat"));
      return;
    }
    setOcrBusy(true); setOcrResult(null); setDetected(null); setTargetCard(null); setOcrRowChecked({});
    try {
      const { base64, previewUrl } = await shrinkImage(file, 1600, 0.82);
      setOcrPreview(previewUrl);
      const { data } = await api.post("/special-parts/ocr-delivery-note", {
        image_base64: base64,
        mime: "image/jpeg",
      });
      setOcrResult(data);
      // Pre-check every detected row so the default "Add N" button is one-click.
      const partsList = Array.isArray(data.parts) && data.parts.length ? data.parts : [];
      const initial = {};
      partsList.forEach((_, i) => { initial[i] = true; });
      setOcrRowChecked(initial);

      // Populate the manual single-part form with the FIRST detected line —
      // still useful for the classic "one part" flow / manual correction.
      setForm(f => ({
        ...f,
        name: data.part_name || f.name,
        part_number: data.part_number || f.part_number,
        quantity: data.quantity || f.quantity || 1,
        unit_price: data.unit_price || f.unit_price,
        unit_cost: data.unit_cost || f.unit_cost,
      }));

      if (data.plate) {
        const { data: match } = await api.post("/special-parts/scan-delivery", { code: data.plate });
        setDetected(match);
        if (match.matched && match.matches.length === 1) {
          setTargetCard(match.matches[0]);
          toast.success(t("ocrMatchedCard", { card: match.matches[0].card_number }));
        } else if (match.matched && match.matches.length > 1) {
          toast(t("multipleCardsMatch"));
        } else {
          toast(t("ocrPickCard"));
        }
      } else {
        toast(t("ocrNoPlateFound"));
        const { data: match } = await api.post("/special-parts/scan-delivery", { code: "unknown" });
        setDetected(match);
      }
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setOcrBusy(false);
    }
  };

  const manualLoad = () => { if (!manual.trim()) return; onScanned(manual.trim()); };

  const addPart = async () => {
    if (!targetCard) return toast.error(t("pickCardFirst"));
    if (!form.name.trim()) return toast.error(t("partNameRequired"));
    setBusy(true);
    try {
      const { data: updated } = await api.post(`/repairs/${targetCard.id}/special-parts`, {
        name: form.name.trim(),
        quantity: Number(form.quantity) || 1,
        unit_price: Number(form.unit_price) || 0,
        unit_cost: Number(form.unit_cost) || 0,
        tax_exempt: !!form.tax_exempt,
        supplier_id: form.supplier_id || null,
        part_number: form.part_number || "",
        status: "arrived",
      });
      toast.success(t("addedTo", { card: updated.card_number }));
      qc.invalidateQueries();
      setForm({ name: "", part_number: "", quantity: 1, unit_price: "", unit_cost: "", tax_exempt: false, supplier_id: "" });
      setTargetCard(null); setDetected(null); setManual("");
      setOcrPreview(null); setOcrResult(null); setOcrRowChecked({});
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  /** Bulk-add EVERY checked pakbon line to the currently selected card.  The
   *  backend accepts one special-part per call so we loop; toast a single
   *  "N parts added" summary at the end. */
  const bulkAddParts = async () => {
    if (!targetCard) return toast.error(t("pickCardFirst"));
    const parts = ocrResult?.parts || [];
    const checkedIdxs = parts
      .map((_, i) => i)
      .filter((i) => ocrRowChecked[i] && (parts[i].part_name || parts[i].part_number));
    if (checkedIdxs.length === 0) return toast.error(t("noPartsSelected"));
    setBulkBusy(true);
    let ok = 0; let fail = 0; let lastCard = null;
    for (const i of checkedIdxs) {
      const p = parts[i];
      try {
        const { data: updated } = await api.post(`/repairs/${targetCard.id}/special-parts`, {
          name: (p.part_name || p.part_number || "Part").trim(),
          quantity: Number(p.quantity) || 1,
          unit_price: Number(p.unit_price) || 0,
          unit_cost: Number(p.unit_cost) || 0,
          tax_exempt: !!form.tax_exempt,
          supplier_id: form.supplier_id || null,
          part_number: p.part_number || "",
          status: "arrived",
        });
        lastCard = updated;
        ok += 1;
      } catch (_e) { fail += 1; }
    }
    if (ok > 0) {
      toast.success(t("bulkAdded", { count: ok, card: lastCard?.card_number || targetCard.card_number }));
    }
    if (fail > 0) {
      toast.error(t("bulkAddFailed", { count: fail }));
    }
    qc.invalidateQueries();
    if (ok > 0 && fail === 0) {
      setForm({ name: "", part_number: "", quantity: 1, unit_price: "", unit_cost: "", tax_exempt: false, supplier_id: "" });
      setTargetCard(null); setDetected(null); setManual("");
      setOcrPreview(null); setOcrResult(null); setOcrRowChecked({});
    }
    setBulkBusy(false);
  };

  const candidates = detected?.matched ? detected.matches : (detected?.candidates || []);
  const pickerLabel = detected?.matched ? t("matchingCards") : t("openCardsPick");

  return (
    <div className="space-y-6" data-testid="delivery-scan-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("supplierDelivery")}</div>
        <h1 className="font-display text-4xl font-black tracking-tight">{t("scanDeliveryNote")}</h1>
        <p className="text-muted-foreground mt-2">{t("scanDeliveryHintV2")}</p>
      </div>

      <Card className="p-6 border-primary/40 bg-primary/5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display text-lg font-bold">{t("scanA4Title")}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("scanA4Sub")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="rounded-full bg-primary hover:bg-primary/90"
            onClick={openA4Camera}
            disabled={ocrBusy}
            data-testid="delivery-scan-a4"
          >
            {ocrBusy
              ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("ocrReading")}</>)
              : (<><Camera className="h-4 w-4 mr-2" /> {t("scanA4Btn")}</>)}
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => galleryInputRef.current?.click()} disabled={ocrBusy} data-testid="delivery-gallery">
            <Upload className="h-4 w-4 mr-2" /> {t("uploadFromGallery")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            onChange={onA4Chosen}
            data-testid="delivery-a4-file"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={onA4Chosen}
            data-testid="delivery-gallery-file"
          />
        </div>
        {ocrPreview && (
          <div className="flex gap-4 items-start pt-2 flex-wrap">
            <img
              src={ocrPreview}
              alt="A4 preview"
              className="w-40 h-auto rounded-md border border-border"
              data-testid="delivery-a4-preview"
            />
            {ocrResult && (
              <div className="text-xs font-mono space-y-1 flex-1 min-w-[240px]" data-testid="delivery-a4-result">
                <div><span className="text-muted-foreground">{t("detectedPlate")}:</span> <strong>{ocrResult.plate || "—"}</strong></div>
                {ocrResult.supplier_name && <div><span className="text-muted-foreground">{t("supplier")}:</span> <strong>{ocrResult.supplier_name}</strong></div>}
                <div className="pt-1 text-[10px] text-muted-foreground">{t("ocrConfidence")}: {Math.round((ocrResult.confidence || 0) * 100)}%</div>
                {ocrResult.notes && <div className="text-amber-600 dark:text-amber-400">⚠ {ocrResult.notes}</div>}
              </div>
            )}
          </div>
        )}
        {ocrResult && Array.isArray(ocrResult.parts) && ocrResult.parts.length > 0 && (
          <div className="pt-3" data-testid="ocr-parts-list">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
                {t("ocrPartsDetected", { count: ocrResult.parts.length })}
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    const all = {};
                    ocrResult.parts.forEach((_, i) => { all[i] = true; });
                    setOcrRowChecked(all);
                  }}
                  data-testid="ocr-check-all"
                >{t("selectAll")}</button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={() => setOcrRowChecked({})}
                  data-testid="ocr-uncheck-all"
                >{t("selectNone")}</button>
              </div>
            </div>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px]">
                  <tr>
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2 text-left">{t("partName")}</th>
                    <th className="px-2 py-2 text-left">{t("partNumber")}</th>
                    <th className="px-2 py-2 text-right">{t("qty")}</th>
                    <th className="px-2 py-2 text-right">{t("costPerUnit")}</th>
                    <th className="px-2 py-2 text-right">{t("sellPerUnit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ocrResult.parts.map((p, i) => (
                    <tr key={i} className="border-t border-border" data-testid={`ocr-part-row-${i}`}>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={!!ocrRowChecked[i]}
                          onChange={(e) => setOcrRowChecked((r) => ({ ...r, [i]: e.target.checked }))}
                          data-testid={`ocr-check-${i}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-xs"
                          value={p.part_name}
                          onChange={(e) => setOcrResult((r) => ({
                            ...r,
                            parts: r.parts.map((row, idx) => idx === i ? { ...row, part_name: e.target.value } : row),
                          }))}
                          data-testid={`ocr-name-${i}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="h-7 text-xs font-mono"
                          value={p.part_number}
                          onChange={(e) => setOcrResult((r) => ({
                            ...r,
                            parts: r.parts.map((row, idx) => idx === i ? { ...row, part_number: e.target.value } : row),
                          }))}
                          data-testid={`ocr-pn-${i}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 w-20">
                        <Input
                          type="number" min="1"
                          className="h-7 text-xs text-right"
                          value={p.quantity}
                          onChange={(e) => setOcrResult((r) => ({
                            ...r,
                            parts: r.parts.map((row, idx) => idx === i ? { ...row, quantity: Number(e.target.value) || 1 } : row),
                          }))}
                          data-testid={`ocr-qty-${i}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 w-24">
                        <Input
                          type="number" step="0.01"
                          className="h-7 text-xs text-right font-mono"
                          value={p.unit_cost}
                          onChange={(e) => setOcrResult((r) => ({
                            ...r,
                            parts: r.parts.map((row, idx) => idx === i ? { ...row, unit_cost: Number(e.target.value) || 0 } : row),
                          }))}
                          data-testid={`ocr-cost-${i}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 w-24">
                        <Input
                          type="number" step="0.01"
                          className="h-7 text-xs text-right font-mono"
                          value={p.unit_price}
                          onChange={(e) => setOcrResult((r) => ({
                            ...r,
                            parts: r.parts.map((row, idx) => idx === i ? { ...row, unit_price: Number(e.target.value) || 0 } : row),
                          }))}
                          data-testid={`ocr-price-${i}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {t("ocrPartsHint")}
            </p>
          </div>
        )}
      </Card>

      <Card className="p-6 border-border space-y-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("orBarcodeScan")}</div>
        <div className="flex items-center gap-2 flex-wrap">
          {!scanning ? (
            <Button variant="outline" className="rounded-full" onClick={() => { setScanning(true); setScanError(""); }} data-testid="delivery-scan-open">
              <Camera className="h-4 w-4 mr-2" /> {t("startCamera")}
            </Button>
          ) : (
            <Button variant="outline" className="rounded-full" onClick={() => setScanning(false)}>
              <CameraOff className="h-4 w-4 mr-2" /> {t("stop")}
            </Button>
          )}
          <div className="flex-1 min-w-[220px] flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t("orTypePlateCode")} className="pl-9" data-testid="delivery-manual" onKeyDown={(e) => { if (e.key === "Enter") manualLoad(); }} />
            </div>
            <Button variant="outline" onClick={manualLoad} className="rounded-full" data-testid="delivery-manual-load">{t("load")}</Button>
          </div>
        </div>
        {scanning && (
          <div>
            <div id="delivery-scan-cam" style={{ width: "100%", minHeight: 320, background: "#000", borderRadius: 8 }} />
            <div className="text-[11px] font-mono text-muted-foreground mt-2">{t("aimCameraBarcode")}</div>
          </div>
        )}
        {scanError && <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2"><CameraOff className="h-4 w-4" /> {scanError}</div>}
      </Card>

      {detected && (
        <Card className="p-6 border-border space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{t("detectedPlate")}</div>
            <div className="font-display text-2xl font-bold">{detected.detected_plate || <span className="text-muted-foreground italic">— {t("none")} —</span>}</div>
            {detected.matched
              ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40" data-testid="delivery-matched-badge">{t("matched")}</Badge>
              : <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40" data-testid="delivery-unmatched-badge">{t("noAutoMatch")}</Badge>}
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">{pickerLabel}</div>
            {candidates.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">{t("noOpenCards")}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {candidates.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setTargetCard(c)}
                    className={`text-left rounded-md border p-3 transition-all ${targetCard?.id === c.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                    data-testid={`delivery-card-${c.card_number}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-mono text-[11px] text-muted-foreground">{c.card_number}</div>
                      {c.car_plate && <PlateBadge plate={c.car_plate} country="NL" size="xxs" />}
                    </div>
                    <div className="font-medium text-sm mt-1 truncate">{[c.car_make, c.car_model].filter(Boolean).join(" ") || t("vehicle")}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{c.customer_name || t("walkIn")}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {targetCard && (
        <Card className="p-6 border-border space-y-4" data-testid="delivery-add-form">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary">
            <Truck className="h-3.5 w-3.5" /> {t("addPartTo")} {targetCard.card_number}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5 md:col-span-2">
              <Label className="text-xs">{t("partName")} *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Brake pads BMW E90" data-testid="delivery-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("partNumber")}</Label>
              <Input value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} placeholder="34116794300" data-testid="delivery-partnum" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("supplier")}</Label>
              <SearchableSelect
                value={form.supplier_id}
                onChange={(v) => setForm({ ...form, supplier_id: v })}
                options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                emptyLabel={"— " + t("none") + " —"}
                placeholder={t("pickSupplier")}
                testId="delivery-supplier"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("qty")}</Label>
              <Input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} data-testid="delivery-qty" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sellPerUnit")}</Label>
              <Input type="number" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} data-testid="delivery-price" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("costPerUnit")}</Label>
              <Input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} data-testid="delivery-cost" />
            </div>
            <div className="md:col-span-3 flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <Label className="cursor-pointer text-xs">{t("taxExemptUsed")}</Label>
              <Switch checked={form.tax_exempt} onCheckedChange={(v) => setForm({ ...form, tax_exempt: v })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 flex-wrap">
            <Button variant="ghost" onClick={() => setTargetCard(null)}>{t("back")}</Button>
            {ocrResult && Array.isArray(ocrResult.parts) && ocrResult.parts.length > 1 && (
              <Button
                className="rounded-full bg-primary"
                onClick={bulkAddParts}
                disabled={bulkBusy}
                data-testid="delivery-bulk-add"
              >
                <Plus className="h-4 w-4 mr-2" />
                {bulkBusy
                  ? t("adding")
                  : t("bulkAddButton", { count: Object.values(ocrRowChecked).filter(Boolean).length })}
              </Button>
            )}
            <Button className="rounded-full bg-primary" onClick={addPart} disabled={busy} data-testid="delivery-add-run">
              <Plus className="h-4 w-4 mr-2" /> {busy ? t("adding") : t("addToCard")}
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => nav(`/repairs?card=${targetCard.card_number}`)}>
              {t("openCardBtn")} <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </Card>
      )}

      {/* ── Live A4 camera dialog ─────────────────────────────────────────── */}
      <Dialog open={a4CamOpen} onOpenChange={(o) => { if (!o) closeA4Camera(); }}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black text-white border-black" data-testid="a4-camera-dialog">
          <DialogHeader className="px-4 py-3 bg-black/80 border-b border-white/10">
            <DialogTitle className="flex items-center gap-2 text-white text-sm font-mono uppercase tracking-widest">
              <Camera className="h-4 w-4" /> {t("scanA4Title")}
            </DialogTitle>
          </DialogHeader>
          <div className="relative bg-black">
            {a4CamErr ? (
              <div className="p-10 text-center space-y-4">
                <CameraOff className="h-10 w-10 text-rose-400 mx-auto" />
                <div className="text-sm text-rose-300 font-mono break-all" data-testid="a4-camera-error">{a4CamErr}</div>
                <div className="flex justify-center gap-2 flex-wrap">
                  <Button variant="outline" className="rounded-full border-white/40 text-white hover:bg-white/10" onClick={() => { closeA4Camera(); pickA4(); }}>
                    <Upload className="h-4 w-4 mr-2" /> {t("uploadFromGallery")}
                  </Button>
                  <Button variant="ghost" className="rounded-full text-white hover:bg-white/10" onClick={closeA4Camera}>
                    {t("close")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <video
                  ref={a4VideoRef}
                  playsInline
                  muted
                  autoPlay
                  className="w-full h-[60vh] object-contain bg-black"
                  data-testid="a4-camera-video"
                />
                {/* A4 framing guide overlay */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="border-2 border-white/60 rounded-md" style={{ width: "62%", height: "84%", aspectRatio: "1 / 1.414" }}>
                    <div className="w-full h-full flex items-end justify-center pb-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-white/80 bg-black/40 px-2 py-0.5 rounded">
                        {t("a4CamGuide")}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 px-4 py-3 bg-black/80 border-t border-white/10">
            <Button
              variant="outline"
              className="rounded-full border-white/40 text-white hover:bg-white/10"
              onClick={() => { closeA4Camera(); pickGallery(); }}
              data-testid="a4-camera-gallery"
            >
              <Upload className="h-4 w-4 mr-2" /> {t("uploadFromGallery")}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="rounded-full text-white hover:bg-white/10"
                onClick={closeA4Camera}
                data-testid="a4-camera-close"
              >
                <X className="h-4 w-4 mr-1" /> {t("close")}
              </Button>
              <Button
                className="rounded-full bg-primary hover:bg-primary/90 min-w-[140px]"
                onClick={captureA4}
                disabled={!!a4CamErr}
                data-testid="a4-camera-capture"
              >
                <Aperture className="h-4 w-4 mr-2" /> {t("captureNow")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
