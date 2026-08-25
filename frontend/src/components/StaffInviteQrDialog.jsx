import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { QrCode, Copy, Mail, Loader2, ExternalLink, CheckCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * "Show invite QR" dialog — displays the pending staff member's
 * password-setup link as a scannable QR code plus a copyable URL, so the
 * owner can hand the invite to a colleague in person (SMS, WhatsApp, print).
 * Data-fetch on open so a fresh (or renewed) token is always returned.
 */
export default function StaffInviteQrDialog({ open, onOpenChange, staff }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);       // { link, email, name, expires_at }
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [emailing, setEmailing] = useState(false);

  useEffect(() => {
    if (!open || !staff?.id) return;
    let cancelled = false;
    setLoading(true);
    setData(null); setQrDataUrl(""); setCopied(false);
    api.get(`/users/${staff.id}/setup-link`)
      .then(async (r) => {
        if (cancelled) return;
        setData(r.data);
        const png = await QRCode.toDataURL(r.data.link, {
          margin: 1, width: 260, errorCorrectionLevel: "M",
          color: { dark: "#0f172a", light: "#ffffff" },
        });
        if (!cancelled) setQrDataUrl(png);
      })
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, staff?.id]);

  const copy = async () => {
    if (!data?.link) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error("Copy blocked by the browser"); }
  };

  const emailAgain = async () => {
    if (!staff?.id) return;
    setEmailing(true);
    try {
      await api.post(`/users/${staff.id}/send-setup-link`);
      toast.success(`Email sent to ${data?.email || staff.email}`);
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setEmailing(false); }
  };

  const expiryPretty = data?.expires_at
    ? new Date(data.expires_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <QrCode className="h-5 w-5 text-primary" /> Invite {staff?.name || staff?.email}
          </DialogTitle>
          <DialogDescription>
            Ask them to scan this QR with their phone, or send them the link below.  The link expires on <strong>{expiryPretty || "…"}</strong>.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Generating link…
          </div>
        )}

        {!loading && data && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="p-3 bg-white rounded-lg border-2 border-primary/30 shadow-sm" data-testid="invite-qr-image">
                {qrDataUrl
                  ? <img src={qrDataUrl} alt="Invite QR code" className="block w-[220px] h-[220px]" />
                  : <div className="w-[220px] h-[220px] bg-muted animate-pulse rounded" />}
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-3">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">Setup link</div>
              <div className="flex items-start gap-2">
                <code
                  className="text-xs font-mono break-all leading-relaxed flex-1 select-all text-foreground"
                  data-testid="invite-link-text"
                >
                  {data.link}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  className="rounded-md shrink-0 h-8 w-8"
                  onClick={copy}
                  title="Copy link"
                  data-testid="invite-copy-button"
                >
                  {copied ? <CheckCheck className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Sending to:</span>
              <code className="font-mono">{data.email}</code>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            className="rounded-full"
            onClick={emailAgain}
            disabled={emailing || !data}
            data-testid="invite-resend-email"
          >
            <Mail className="h-4 w-4 mr-2" />
            {emailing ? "Sending…" : "Send by email"}
          </Button>
          {data?.link && (
            <Button
              variant="outline"
              className="rounded-full"
              asChild
            >
              <a href={data.link} target="_blank" rel="noopener noreferrer" data-testid="invite-open-link">
                <ExternalLink className="h-4 w-4 mr-2" /> Open link
              </a>
            </Button>
          )}
          <Button className="rounded-full bg-primary sm:ml-auto" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
