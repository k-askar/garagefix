import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff, X } from "lucide-react";
import { useLang } from "@/i18n";

/**
 * Live barcode / QR scanner dialog.
 * Uses the phone's rear camera via html5-qrcode. On first successful decode it
 * calls onDecoded(text) then closes itself.
 */
export default function BarcodeScannerDialog({ open, onOpenChange, onDecoded, elementId = "bcode-scanner" }) {
  const { t } = useLang();
  const scannerRef = useRef(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr("");
    let active = true;
    // Give the <div> a tick to mount, then start the camera stream.
    const startTimer = setTimeout(() => {
      try {
        scannerRef.current = new Html5Qrcode(elementId);
        scannerRef.current
          .start(
            { facingMode: "environment" },
            {
              fps: 12,
              qrbox: (w, h) => ({ width: Math.min(w * 0.85, 520), height: Math.min(h * 0.55, 300) }),
            },
            (text) => {
              if (!active) return;
              active = false;
              onDecoded?.(text);
              onOpenChange?.(false);
            },
            () => {}
          )
          .catch((e) => setErr(String(e?.message || e)));
      } catch (e) {
        setErr(String(e?.message || e));
      }
    }, 60);

    return () => {
      clearTimeout(startTimer);
      active = false;
      try {
        scannerRef.current?.stop()
          .then(() => scannerRef.current?.clear())
          .catch(() => {});
      } catch (_) {}
      scannerRef.current = null;
    };
  }, [open, elementId, onDecoded, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden bg-black text-white border-black" data-testid="bcode-scanner-dialog">
        <DialogHeader className="px-4 py-3 bg-black/80 border-b border-white/10">
          <DialogTitle className="flex items-center gap-2 text-white text-sm font-mono uppercase tracking-widest">
            <Camera className="h-4 w-4" /> {t("scanBarcodeCamera")}
          </DialogTitle>
        </DialogHeader>
        <div className="relative bg-black min-h-[320px]">
          {err ? (
            <div className="p-10 text-center space-y-3">
              <CameraOff className="h-10 w-10 text-rose-400 mx-auto" />
              <div className="text-sm text-rose-300 font-mono break-all">{err}</div>
              <p className="text-[11px] text-white/60">{t("scannerHint")}</p>
            </div>
          ) : (
            <>
              <div id={elementId} className="w-full" style={{ minHeight: 320 }} />
              <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center">
                <span className="text-[10px] font-mono uppercase tracking-widest text-white/80 bg-black/50 px-2 py-0.5 rounded">
                  {t("holdSteady")}
                </span>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-end px-4 py-3 bg-black/80 border-t border-white/10">
          <Button
            variant="ghost"
            className="rounded-full text-white hover:bg-white/10"
            onClick={() => onOpenChange?.(false)}
            data-testid="bcode-scanner-close"
          >
            <X className="h-4 w-4 mr-1" /> {t("close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
