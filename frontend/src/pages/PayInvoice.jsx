import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import QRCode from "qrcode";
import { CheckCircle2, Copy, ExternalLink, ShieldCheck, AlertTriangle, Loader2, CreditCard } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * PUBLIC payment page — no auth.  Linked from the "Pay now" button inside
 * overdue-invoice emails.  Shows the amount, garage bank info, SEPA QR that
 * every NL banking app (ABN, ING, Rabo…) recognises + click-to-copy IBAN /
 * reference so desktop users can paste the details into their bank UI.
 */
export default function PayInvoice() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [starting, setStarting] = useState(false);
  const [pollingSid] = useState(params.get("sid") || "");

  const load = () => axios.get(`${API}/public/pay/${token}`)
    .then(async (r) => {
      setData(r.data);
      if (r.data?.sepa_uri) {
        try {
          const png = await QRCode.toDataURL(r.data.sepa_uri, { margin: 1, width: 320 });
          setQrDataUrl(png);
        } catch (_) { /* ignore */ }
      }
    })
    .catch((e) => setErr(e?.response?.data?.detail || "Payment link is invalid or expired"));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  // Returning from Stripe with ?paid=1&sid=... — poll status endpoint until
  // the invoice flips to paid (webhook usually beats us to it in a second).
  useEffect(() => {
    if (!pollingSid) return;
    let alive = true;
    const tick = async () => {
      try {
        const { data: s } = await axios.get(`${API}/public/pay/${token}/stripe-status/${pollingSid}`);
        if (s.payment_status === "paid") {
          toast.success("Payment received — thank you!");
          await load();
          return;
        }
      } catch (_) { /* keep polling until timeout */ }
      if (alive) setTimeout(tick, 2000);
    };
    tick();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [pollingSid]);

  const startStripe = async () => {
    setStarting(true);
    try {
      const { data: s } = await axios.post(`${API}/public/pay/${token}/stripe-session`, {
        origin_url: window.location.origin,
      });
      if (s?.checkout_url) window.location.href = s.checkout_url;
      else throw new Error("No checkout URL returned");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kon Stripe niet starten — probeer het opnieuw");
    } finally { setStarting(false); }
  };

  const copy = async (val, label) => {
    try {
      await navigator.clipboard.writeText(val);
      toast.success(`${label} copied`);
    } catch (_) {
      toast.error("Copy failed — select and copy manually");
    }
  };

  if (err) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-rose-500 mx-auto" />
          <h1 className="text-2xl font-bold">Payment link not available</h1>
          <p className="text-slate-400">{err}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const paid = data.status === "paid";
  const g = data.garage || {};
  const amount = Number(data.amount || 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100 py-10 px-4" data-testid="pay-page">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" /> Secure payment
          </div>
          <h1 className="text-3xl font-bold">{g.name || "Garage"}</h1>
          <div className="text-slate-400 text-sm">Invoice {data.invoice_number} · {data.customer_name || ""}</div>
        </div>

        {/* Paid banner */}
        {paid && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 flex items-center gap-3" data-testid="pay-paid-banner">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            <div>
              <div className="font-semibold text-emerald-300">This invoice is already paid</div>
              <div className="text-xs text-slate-400">
                {data.paid_at ? `Received on ${data.paid_at.slice(0, 10)}` : "Thank you!"}
              </div>
            </div>
          </div>
        )}

        {/* Amount card */}
        <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-6 text-center">
          <div className="text-xs font-mono uppercase tracking-widest text-slate-500">Amount due</div>
          <div className="text-5xl font-black mt-2" data-testid="pay-amount">
            € {amount.toFixed(2)}
          </div>
          {data.due_date && (
            <div className="text-xs text-slate-400 mt-2">
              Due <span className="font-mono">{data.due_date}</span>
            </div>
          )}
        </div>

        {/* Stripe Pay-Now — primary CTA when Stripe is enabled */}
        {!paid && data.stripe_enabled && (
          <div className="rounded-xl border-2 border-primary/60 bg-gradient-to-br from-primary/15 via-slate-900/60 to-slate-900/60 p-6 space-y-3 shadow-2xl shadow-primary/10" data-testid="pay-stripe-card">
            <div className="flex items-center justify-center gap-2 text-xs font-mono uppercase tracking-widest text-primary">
              <CreditCard className="h-3.5 w-3.5" /> Instant payment
            </div>
            <h2 className="font-semibold text-center text-lg">Pay by card, iDEAL, or Bancontact</h2>
            <button
              onClick={startStripe}
              disabled={starting}
              className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-4 text-base transition-all shadow-lg shadow-primary/25 disabled:opacity-60 flex items-center justify-center gap-2"
              data-testid="pay-stripe-button"
            >
              {starting ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Redirecting to Stripe…</>
              ) : (
                <><CreditCard className="h-5 w-5" /> Pay € {amount.toFixed(2)} securely</>
              )}
            </button>
            <div className="text-[11px] text-slate-400 text-center flex items-center justify-center gap-2">
              <ShieldCheck className="h-3 w-3 text-emerald-400" />
              Secure Stripe checkout · Visa, Mastercard, iDEAL, Bancontact
            </div>
          </div>
        )}

        {/* SEPA QR + open-app link */}
        {!paid && qrDataUrl && (
          <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-6 space-y-4" data-testid="pay-qr-card">
            <h2 className="font-semibold text-center">
              {data.stripe_enabled ? "Or scan with your banking app" : "Scan with your banking app"}
            </h2>
            <div className="flex items-center justify-center">
              <div className="bg-white p-3 rounded-lg">
                <img src={qrDataUrl} alt="SEPA payment QR" className="w-64 h-64" />
              </div>
            </div>
            <div className="text-xs text-slate-400 text-center">
              Works with ABN AMRO, ING, Rabobank, SNS, Bunq, Revolut, N26 &amp; every EU banking app.
            </div>
            <a
              href={data.sepa_uri}
              className="block text-center rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold py-3 transition-colors"
              data-testid="pay-open-app"
            >
              <ExternalLink className="h-4 w-4 mr-2 inline" /> Open my banking app
            </a>
          </div>
        )}

        {/* Manual bank details */}
        <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-6 space-y-3">
          <h2 className="font-semibold">Or transfer manually</h2>
          <Row label="Beneficiary" value={g.name} onCopy={() => copy(g.name, "Beneficiary")} testId="pay-name" />
          {g.iban && (
            <Row label="IBAN" value={g.iban} mono onCopy={() => copy(g.iban.replace(/\s+/g, ""), "IBAN")} testId="pay-iban" />
          )}
          {g.bic && (
            <Row label="BIC / SWIFT" value={g.bic} mono onCopy={() => copy(g.bic, "BIC")} testId="pay-bic" />
          )}
          <Row label="Reference" value={data.reference} mono onCopy={() => copy(data.reference, "Reference")} testId="pay-ref" />
          <Row label="Amount" value={`€ ${amount.toFixed(2)}`} mono onCopy={() => copy(amount.toFixed(2), "Amount")} testId="pay-amount-copy" />
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-500 space-y-1">
          {g.address && <div>{g.address}</div>}
          <div>
            {g.email && <span>{g.email}</span>}
            {g.email && g.phone && <span> · </span>}
            {g.phone && <span>{g.phone}</span>}
          </div>
          {g.kvk_number && <div className="opacity-70">KvK {g.kvk_number}</div>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono, onCopy, testId }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</div>
        <div className={`truncate ${mono ? "font-mono" : ""} text-slate-100`}>{value}</div>
      </div>
      <button
        onClick={onCopy}
        className="shrink-0 rounded-md border border-slate-700 hover:border-emerald-500 hover:text-emerald-400 p-2 transition-colors"
        aria-label={`Copy ${label}`}
        data-testid={testId}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
