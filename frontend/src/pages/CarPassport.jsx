import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PlateBadge from "@/components/PlateBadge";
import { Car, Droplets, Shield, Wrench, Loader2, AlertTriangle } from "lucide-react";

/**
 * Public "Car Passport" — a customer opens this by scanning the vehicle's QR code.
 * No authentication required. The URL contains a random per-vehicle token.
 */
const API = process.env.REACT_APP_BACKEND_URL;

const monthFmt = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso.slice(0, 10); }
};

const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr); if (isNaN(d)) return null;
  return Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
};

export default function CarPassport() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setErr(null);
    axios.get(`${API}/api/passport/${token}`)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.detail || "Passport not found"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading passport…
    </div>
  );
  if (err) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
      <AlertTriangle className="h-10 w-10 text-amber-500" />
      <div className="font-display text-2xl font-bold">Passport not found</div>
      <div className="text-sm text-muted-foreground">This QR code may have been rotated or the vehicle removed.</div>
    </div>
  );

  const v = data.vehicle || {};
  const g = data.garage || {};
  const events = data.events || [];
  const repairs = data.recent_repairs || [];
  const apkDays = daysUntil(v.apk_expiry);
  const accent = g.accent || "#0EA5E9";
  const logoSrc = g.logo_url?.startsWith("/api/") ? `${API}${g.logo_url}` : g.logo_url;

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4" data-testid="car-passport">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Garage header */}
        <div className="flex items-center gap-3">
          {logoSrc && <img src={logoSrc} alt="logo" className="h-10 w-auto object-contain" />}
          <div className="flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: accent }}>Car Passport</div>
            <div className="font-display text-xl font-bold">{g.name}</div>
            <div className="text-[11px] text-muted-foreground">{g.phone} {g.email && ` · ${g.email}`}</div>
          </div>
        </div>

        {/* Vehicle hero */}
        <Card className="p-6 border-border relative overflow-hidden">
          <div className="absolute right-0 top-0 h-full w-1/3 opacity-5 pointer-events-none">
            <Car className="w-full h-full" />
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Vehicle</div>
              <div className="font-display text-3xl font-black">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}</div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                {v.plate && <PlateBadge plate={v.plate} country={v.country || "NL"} size="sm" />}
                {v.color && <Badge variant="outline" className="text-[11px]">{v.color}</Badge>}
                {v.km && <Badge variant="outline" className="text-[11px] font-mono">{v.km} km</Badge>}
              </div>
              {data.owner_name && <div className="text-xs text-muted-foreground mt-2">Owner: {data.owner_name}</div>}
              {v.vin && <div className="text-[10px] text-muted-foreground font-mono">VIN: {v.vin}</div>}
            </div>
          </div>
          {/* APK + Oil badges */}
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className={`rounded-md p-3 border ${apkDays === null ? "border-border" : apkDays < 0 ? "border-rose-500/40 bg-rose-500/10" : apkDays < 30 ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/5"}`}>
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest">
                <Shield className="h-3.5 w-3.5" /> APK
              </div>
              <div className="font-mono font-bold mt-1">{v.apk_expiry || "—"}</div>
              {apkDays !== null && (
                <div className="text-[11px] mt-0.5">
                  {apkDays < 0 ? <span className="text-rose-600 dark:text-rose-400">Expired {Math.abs(apkDays)}d ago</span>
                    : apkDays < 30 ? <span className="text-amber-600 dark:text-amber-400">Expires in {apkDays}d</span>
                    : <span className="text-emerald-600 dark:text-emerald-400">Valid — {apkDays}d left</span>}
                </div>
              )}
            </div>
            <div className="rounded-md p-3 border border-border">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest">
                <Droplets className="h-3.5 w-3.5" /> Next oil change
              </div>
              <div className="font-mono font-bold mt-1">{v.next_oil_change_km ? `${v.next_oil_change_km} km` : "—"}</div>
              {v.km && v.next_oil_change_km && (
                <div className="text-[11px] mt-0.5 text-muted-foreground">
                  Current: {v.km} km
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Service events timeline */}
        <Card className="p-6 border-border">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">Service events · {events.length}</div>
          {events.length === 0 && <div className="text-sm text-muted-foreground italic">No APK / oil-change events recorded yet.</div>}
          <ul className="space-y-2">
            {events.map(e => (
              <li key={e.id} className="text-sm font-mono flex items-center gap-3 flex-wrap" data-testid={`passport-event-${e.id}`}>
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${e.kind === "apk_renewal" ? "bg-emerald-500" : "bg-sky-500"}`} />
                <span className="text-muted-foreground">{monthFmt(e.at)}</span>
                <span className="font-semibold uppercase">{e.kind === "apk_renewal" ? "APK renewed" : "Oil change"}</span>
                {e.km && <span className="text-muted-foreground">at {e.km} km</span>}
                {e.new_value && <span>→ <strong>{e.new_value}</strong></span>}
              </li>
            ))}
          </ul>
        </Card>

        {/* Recent repairs */}
        <Card className="p-6 border-border">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">Recent repairs · {repairs.length}</div>
          {repairs.length === 0 && <div className="text-sm text-muted-foreground italic">No invoiced repairs on file yet.</div>}
          <div className="divide-y divide-border">
            {repairs.map(r => (
              <div key={r.card_number} className="py-3 flex items-center gap-3 flex-wrap" data-testid={`passport-repair-${r.card_number}`}>
                <Wrench className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{r.work_done || "—"}</div>
                  <div className="text-[11px] text-muted-foreground font-mono">{monthFmt(r.created_at)} · {r.card_number} {r.mechanic_name && ` · ${r.mechanic_name}`} {r.car_km && ` · ${r.car_km} km`}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="text-center text-[11px] text-muted-foreground pt-4">
          Powered by {g.name}. Data on this page is read-only.
        </div>
      </div>
    </div>
  );
}
