import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SearchableSelect from "@/components/SearchableSelect";

/**
 * Searchable Make -> Model -> Year picker with manual override.
 *
 * value = { make, model, year }
 * The user can either pick from the catalog or type any custom value —
 * we treat the input as free-form. When they pick a make, models load.
 */
export default function VehicleMakeModelYear({ value, onChange, testIdPrefix = "veh" }) {
  const v = value || {};
  const [manualMake, setManualMake] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const [manualYear, setManualYear] = useState(false);

  const { data: makesResp } = useQuery({
    queryKey: ["veh-makes"],
    queryFn: () => api.get("/lookup/vehicle-makes").then(r => r.data),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const makes = makesResp?.makes || [];

  const { data: modelsResp } = useQuery({
    queryKey: ["veh-models", v.make],
    queryFn: () => api.get(`/lookup/vehicle-models`, { params: { make: v.make } }).then(r => r.data),
    enabled: !!v.make && !manualMake,
    staleTime: 24 * 60 * 60 * 1000,
  });
  const models = modelsResp?.models || [];

  // If the current make isn't in the fetched list, flip to manual mode transparently.
  useEffect(() => {
    if (!makes.length || !v.make) return;
    const found = makes.some(m => m.name.toLowerCase() === v.make.toLowerCase());
    if (!found && !manualMake) setManualMake(true);
  }, [makes, v.make, manualMake]);

  // Same for MODEL: RDW may return a model that our catalog doesn't have
  // (or has a different case), so the SearchableSelect would render as an
  // empty "Pick a model…" hiding the value.  Auto-flip to a plain Input so
  // the user actually SEES the "Civic" / "Fabia" / … that RDW returned.
  useEffect(() => {
    if (manualModel) return;
    if (!v.model || !v.make) return;
    // Wait until models finish loading before deciding — otherwise we'd flip
    // to manual on every mount even for a match.
    if (!modelsResp) return;
    const found = models.some(m => m.name.toLowerCase() === v.model.toLowerCase());
    if (!found) setManualModel(true);
  }, [modelsResp, models, v.model, v.make, manualModel]);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    // Look one year ahead for pre-orders (e.g. 2026 registration in late 2025).
    const to = currentYear + 1;
    const out = [];
    for (let y = to; y >= 1980; y--) out.push(String(y));
    return out;
  }, []);

  const set = (patch) => onChange({ ...v, ...patch });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2" data-testid={`${testIdPrefix}-mmy`}>
      {/* MAKE */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Make</Label>
          <button
            type="button"
            className="text-[10px] text-primary hover:underline"
            onClick={() => setManualMake(x => !x)}
            data-testid={`${testIdPrefix}-make-toggle`}
          >
            {manualMake ? "pick from list" : "type manually"}
          </button>
        </div>
        {manualMake ? (
          <Input
            value={v.make || ""}
            onChange={(e) => set({ make: e.target.value })}
            placeholder="e.g. VW"
            data-testid={`${testIdPrefix}-make-input`}
          />
        ) : (
          <SearchableSelect
            value={v.make || ""}
            onChange={(mk) => set({ make: mk, model: "" })}
            options={makes.map(m => ({ value: m.name, label: m.name }))}
            placeholder={makes.length ? "Pick a make…" : "Loading catalog…"}
            searchPlaceholder="Search make"
            testId={`${testIdPrefix}-make-select`}
          />
        )}
      </div>

      {/* MODEL */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Model</Label>
          <button
            type="button"
            className="text-[10px] text-primary hover:underline"
            onClick={() => setManualModel(x => !x)}
            data-testid={`${testIdPrefix}-model-toggle`}
          >
            {manualModel ? "pick from list" : "type manually"}
          </button>
        </div>
        {manualModel || manualMake || !v.make ? (
          <Input
            value={v.model || ""}
            onChange={(e) => set({ model: e.target.value })}
            placeholder="e.g. Golf"
            data-testid={`${testIdPrefix}-model-input`}
          />
        ) : (
          <SearchableSelect
            value={v.model || ""}
            onChange={(md) => set({ model: md })}
            options={models.map(m => ({ value: m.name, label: m.name }))}
            placeholder={models.length ? "Pick a model…" : "Loading models…"}
            searchPlaceholder="Search model"
            testId={`${testIdPrefix}-model-select`}
          />
        )}
      </div>

      {/* YEAR */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Year</Label>
          <button
            type="button"
            className="text-[10px] text-primary hover:underline"
            onClick={() => setManualYear(x => !x)}
            data-testid={`${testIdPrefix}-year-toggle`}
          >
            {manualYear ? "pick from list" : "type manually"}
          </button>
        </div>
        {manualYear ? (
          <Input
            value={v.year || ""}
            onChange={(e) => set({ year: e.target.value })}
            placeholder="2020"
            data-testid={`${testIdPrefix}-year-input`}
          />
        ) : (
          <SearchableSelect
            value={v.year || ""}
            onChange={(y) => set({ year: y })}
            options={years.map(y => ({ value: y, label: y }))}
            placeholder="Pick year…"
            searchPlaceholder="Search year"
            testId={`${testIdPrefix}-year-select`}
          />
        )}
      </div>
    </div>
  );
}
