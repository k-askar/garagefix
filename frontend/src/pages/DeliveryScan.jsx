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
import { Camera, CameraOff, Truck, Search, Plus, ArrowRight, ScanText, Loader2, Sparkles, Upload } from "lucide-react";
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

  const onA4Chosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
      toast.error(t("ocrUnsupportedFormat"));
      return;
    }
    setOcrBusy(true); setOcrResult(null); setDetected(null); setTargetCard(null);
    try {
      const { base64, previewUrl } = await shrinkImage(file, 1600, 0.82);
      setOcrPreview(previewUrl);
      const { data } = await api.post("/special-parts/ocr-delivery-note", {
        image_base64: base64,
        mime: "image/jpeg",
      });
      setOcrResult(data);

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
      setOcrPreview(null); setOcrResult(null);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
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
            onClick={() => fileInputRef.current?.click()}
            disabled={ocrBusy}
            data-testid="delivery-scan-a4"
          >
            {ocrBusy
              ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("ocrReading")}</>)
              : (<><ScanText className="h-4 w-4 mr-2" /> {t("scanA4Btn")}</>)}
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
              <div className="text-xs font-mono space-y-1 flex-1 min-w-[200px]" data-testid="delivery-a4-result">
                <div><span className="text-muted-foreground">{t("detectedPlate")}:</span> <strong>{ocrResult.plate || "—"}</strong></div>
                <div><span className="text-muted-foreground">{t("partName")}:</span> <strong>{ocrResult.part_name || "—"}</strong></div>
                <div><span className="text-muted-foreground">{t("partNumber")}:</span> <strong>{ocrResult.part_number || "—"}</strong></div>
                <div><span className="text-muted-foreground">{t("costPerUnit")}:</span> <strong>€ {Number(ocrResult.unit_cost || 0).toFixed(2)}</strong></div>
                <div><span className="text-muted-foreground">{t("sellPerUnit")}:</span> <strong>€ {Number(ocrResult.unit_price || 0).toFixed(2)}</strong></div>
                <div><span className="text-muted-foreground">{t("qty")}:</span> <strong>{ocrResult.quantity}</strong></div>
                {ocrResult.supplier_name && <div><span className="text-muted-foreground">{t("supplier")}:</span> <strong>{ocrResult.supplier_name}</strong></div>}
                <div className="pt-1 text-[10px] text-muted-foreground">{t("ocrConfidence")}: {Math.round((ocrResult.confidence || 0) * 100)}%</div>
                {ocrResult.notes && <div className="text-amber-600 dark:text-amber-400">⚠ {ocrResult.notes}</div>}
              </div>
            )}
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
            <Button className="rounded-full bg-primary" onClick={addPart} disabled={busy} data-testid="delivery-add-run">
              <Plus className="h-4 w-4 mr-2" /> {busy ? t("adding") : t("addToCard")}
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => nav(`/repairs?card=${targetCard.card_number}`)}>
              {t("openCardBtn")} <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
