import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Printer, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Modal that displays a printable QR code linking to the public Car Passport page.
 * Uses the frontend's own origin so the customer opens a friendly React page — not JSON.
 */
export default function CarPassportQrDialog({ vehicle, open, onOpenChange }) {
  const [token, setToken] = useState(null);
  const [dataUrl, setDataUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);

  const passportUrl = token ? `${window.location.origin}/passport/${token}` : "";

  useEffect(() => {
    if (!open || !vehicle?.id) return;
    setBusy(true);
    api.get(`/vehicles/${vehicle.id}/passport/token`)
      .then(r => setToken(r.data.passport_token))
      .catch(() => toast.error("Could not load passport token"))
      .finally(() => setBusy(false));
  }, [open, vehicle?.id]);

  useEffect(() => {
    if (!token) return;
    QRCode.toDataURL(passportUrl, { width: 320, margin: 2 }).then(setDataUrl);
  }, [token, passportUrl]);

  const rotate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/vehicles/${vehicle.id}/passport/rotate`);
      setToken(data.passport_token);
      toast.success("New QR code generated — the old one is invalid now.");
    } catch (e) { toast.error("Rotate failed"); }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(passportUrl); toast.success("Passport link copied"); }
    catch { toast.error("Copy failed"); }
  };

  const printQr = () => {
    if (!dataUrl) return;
    const label = [vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(" ");
    const w = window.open("", "_blank", "width=500,height=700");
    if (!w) return;
    // Modern sticker layout — full-bleed accent band on top, giant QR, plate
    // badge underneath, and a "SCAN VOOR SERVICEGESCHIEDENIS" strapline in
    // Dutch (matches the invoice PDFs which are always Dutch).
    w.document.write(`
      <html><head><title>QR sticker — ${label || vehicle?.plate || ""}</title>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;900&display=swap" rel="stylesheet">
      <style>
        @page { margin: 8mm; size: A5; }
        *{box-sizing:border-box;-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
        body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;margin:0;padding:0;color:#0f172a;background:#fff}
        .sticker{border:3px solid #0f172a;border-radius:18px;overflow:hidden;max-width:380px;margin:12px auto;
                 box-shadow:0 8px 24px rgba(15,23,42,0.15)}
        .band{background:#0EA5E9;color:#fff;padding:14px 18px;text-align:center;font-weight:800;
              letter-spacing:.16em;text-transform:uppercase;font-size:12px}
        .band .brand{font-size:15px;letter-spacing:.06em;margin-bottom:2px;text-transform:none;font-weight:900}
        .body{padding:20px 20px 22px;text-align:center;background:#fff}
        .plate{display:inline-block;background:#FFCB05;color:#000;padding:6px 14px 6px 34px;
               border:2.5px solid #000;border-radius:5px;font-family:'Arial Black',Impact,sans-serif;
               font-weight:900;font-size:20px;letter-spacing:.16em;position:relative;margin-bottom:12px}
        .plate::before{content:'NL';position:absolute;left:0;top:0;bottom:0;background:#003399;color:#FFCB05;
                       padding:0 6px;font-size:9px;display:flex;align-items:center;letter-spacing:.05em;
                       border-right:2px solid #000;border-radius:2px 0 0 2px}
        h1{margin:2px 0 4px;font-size:18px;font-weight:900;line-height:1.2}
        .subtitle{color:#64748b;font-size:11px;margin:0 0 16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
        .qr{border:2px solid #0f172a;padding:10px;border-radius:12px;display:inline-block;background:#fff}
        .qr img{width:240px;height:240px;display:block}
        .scan-line{margin-top:14px;font-weight:900;font-size:16px;color:#0EA5E9;letter-spacing:.08em}
        .scan-line-ar{font-family:'Cairo',sans-serif;font-size:14px;color:#334155;margin-top:4px;direction:rtl;font-weight:700}
        .footer{padding:12px 16px;background:#f1f5f9;text-align:center;font-family:monospace;
                font-size:9px;color:#64748b;word-break:break-all;border-top:1px solid #e2e8f0}
        @media print{ body{background:#fff} .sticker{box-shadow:none;margin:0 auto} }
      </style></head><body>
        <div class="sticker">
          <div class="band">
            <div class="brand">🔧 Servicedossier</div>
            <div>Scan met uw telefoon</div>
          </div>
          <div class="body">
            ${vehicle?.plate ? `<div class="plate">${vehicle.plate}</div>` : ""}
            <h1>${label || "Voertuig"}</h1>
            <p class="subtitle">${vehicle?.color ? vehicle.color + ' · ' : ''}${vehicle?.vin ? 'VIN ' + vehicle.vin : ''}</p>
            <div class="qr"><img src="${dataUrl}" alt="passport QR" /></div>
            <div class="scan-line">Scan voor volledige historie</div>
            <div class="scan-line-ar">امسح لعرض سجل الصيانة الكامل</div>
          </div>
          <div class="footer">${passportUrl}</div>
        </div>
      </body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 700);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="passport-qr-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">Car passport QR</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground -mt-2">
          The customer scans this code with their phone to see the full service timeline of{" "}
          <strong>{[vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(" ") || vehicle?.plate}</strong>.
        </div>
        <div className="flex flex-col items-center gap-3 py-4">
          {busy && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
          {!busy && dataUrl && <img src={dataUrl} alt="passport QR" className="w-64 h-64 rounded-md border border-border bg-white p-2" data-testid="passport-qr-image" />}
          {passportUrl && (
            <div className="w-full text-center">
              <div className="text-[10px] font-mono text-muted-foreground break-all px-4">{passportUrl}</div>
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={copyLink} className="rounded-full" data-testid="passport-copy-link">
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy link
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={rotate} className="rounded-full" data-testid="passport-rotate">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Rotate
            </Button>
          </div>
          <Button type="button" onClick={printQr} className="rounded-full bg-primary" data-testid="passport-print">
            <Printer className="h-3.5 w-3.5 mr-1" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
