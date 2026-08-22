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
    const w = window.open("", "_blank", "width=500,height=650");
    if (!w) return;
    w.document.write(`
      <html><head><title>Car Passport — ${label || vehicle?.plate || ""}</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;padding:24px;color:#111}
      h1{margin:0 0 4px;font-size:20px}h2{margin:0 0 24px;font-size:14px;font-weight:400;color:#555}
      img{width:280px;height:280px}p{font-size:11px;color:#666;margin-top:16px;word-break:break-all}
      .plate{display:inline-block;background:#FFC900;color:#000;padding:4px 10px;border:2px solid #000;border-radius:4px;font-weight:900;letter-spacing:0.08em;margin-top:8px}
      </style></head><body>
        <h1>${label || "Car passport"}</h1>
        ${vehicle?.plate ? `<div class="plate">${vehicle.plate}</div>` : ""}
        <h2>Scan to see the full service history</h2>
        <img src="${dataUrl}" />
        <p>${passportUrl}</p>
      </body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 400);
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
