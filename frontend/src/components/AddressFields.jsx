import React, { useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, MapPin, Check } from "lucide-react";

/**
 * Structured address block with an automatic Dutch postcode lookup.
 *
 * Value shape:
 *  { postcode, house_number, house_number_addition, street, city, address_country }
 */
const COUNTRIES = [
  ["NL", "🇳🇱 Netherlands"], ["BE", "🇧🇪 Belgium"], ["DE", "🇩🇪 Germany"], ["FR", "🇫🇷 France"],
  ["GB", "🇬🇧 United Kingdom"], ["IT", "🇮🇹 Italy"], ["ES", "🇪🇸 Spain"], ["PL", "🇵🇱 Poland"],
  ["TR", "🇹🇷 Turkey"], ["MA", "🇲🇦 Morocco"], ["SY", "🇸🇾 Syria"], ["LB", "🇱🇧 Lebanon"],
  ["OTHER", "Other"],
];

export default function AddressFields({ value, onChange, testIdPrefix = "addr", compact = false }) {
  const v = value || {};
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // "hit" | "miss" | null

  const set = (patch) => onChange({ ...v, ...patch });

  const doLookup = async () => {
    const pc = (v.postcode || "").trim();
    const num = (v.house_number || "").trim();
    if (!pc) { setStatus(null); return; }
    if ((v.address_country || "NL") !== "NL") { setStatus(null); return; }
    setBusy(true); setStatus(null);
    try {
      const { data } = await api.get(`/lookup/postcode`, { params: { postcode: pc, number: num || undefined } });
      onChange({
        ...v,
        postcode: (data.postcode || pc).toUpperCase(),
        street: data.street || v.street || "",
        city: data.city || v.city || "",
      });
      setStatus("hit");
    } catch (e) {
      setStatus("miss");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-wrap`}>
      <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"} gap-2`}>
        <div className="space-y-1.5">
          <Label className="text-xs">Postcode</Label>
          <div className="relative">
            <Input
              value={v.postcode || ""}
              onChange={(e) => { set({ postcode: e.target.value.toUpperCase() }); setStatus(null); }}
              onBlur={doLookup}
              placeholder="1234 AB"
              className="uppercase pr-8"
              data-testid={`${testIdPrefix}-postcode`}
            />
            {busy && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
            {!busy && status === "hit" && <Check className="absolute right-2 top-2.5 h-4 w-4 text-emerald-500" />}
            {!busy && status === "miss" && <MapPin className="absolute right-2 top-2.5 h-4 w-4 text-amber-500" />}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Huisnr.</Label>
          <Input
            value={v.house_number || ""}
            onChange={(e) => { set({ house_number: e.target.value }); setStatus(null); }}
            onBlur={doLookup}
            placeholder="12"
            data-testid={`${testIdPrefix}-house`}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Addition</Label>
          <Input
            value={v.house_number_addition || ""}
            onChange={(e) => set({ house_number_addition: e.target.value })}
            placeholder="A / bis"
            data-testid={`${testIdPrefix}-addition`}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Country</Label>
          <select
            value={v.address_country || "NL"}
            onChange={(e) => set({ address_country: e.target.value })}
            className="w-full h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            data-testid={`${testIdPrefix}-country`}
          >
            {COUNTRIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className={`grid ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"} gap-2`}>
        <div className="space-y-1.5">
          <Label className="text-xs">Street</Label>
          <Input
            value={v.street || ""}
            onChange={(e) => set({ street: e.target.value })}
            placeholder="Auto-filled from postcode"
            data-testid={`${testIdPrefix}-street`}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">City</Label>
          <Input
            value={v.city || ""}
            onChange={(e) => set({ city: e.target.value })}
            placeholder="Auto-filled from postcode"
            data-testid={`${testIdPrefix}-city`}
          />
        </div>
      </div>
      {status === "miss" && (
        <div className="text-[11px] text-amber-600 dark:text-amber-400" data-testid={`${testIdPrefix}-miss`}>
          Postcode not found — you can still type the street and city manually.
        </div>
      )}
      {status === "hit" && (
        <div className="text-[11px] text-emerald-600 dark:text-emerald-400" data-testid={`${testIdPrefix}-hit`}>
          Address filled automatically.
        </div>
      )}
    </div>
  );
}
