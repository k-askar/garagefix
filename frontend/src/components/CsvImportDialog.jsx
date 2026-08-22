import React, { useState, useRef } from "react";
import { api, formatApiError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE = `customer_name,customer_phone,customer_email,plate,make,model,year,color,km,country,apk_expiry,next_oil_change_km,vin,notes
Ahmed Al-Farsi,+31201112222,ahmed@example.com,B-DE-9022,Mercedes,C220,2018,silver,92000,DE,2027-05-01,102000,,
Sofia Jansen,+31612345678,,NL-42-ABC,Volkswagen,Golf,2020,white,45000,NL,2026-11-30,55000,,First service
`;

export default function CsvImportDialog({ open, onOpenChange, onDone }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const doImport = async () => {
    if (!csv.trim()) return toast.error("Paste or upload a CSV first");
    setBusy(true); setResult(null);
    try {
      const { data } = await api.post("/import/vehicles-csv", { csv });
      setResult(data);
      toast.success(`${data.created_vehicles} vehicle(s) imported`);
      onDone?.();
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const pickFile = () => fileRef.current?.click();
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    const r = new FileReader();
    r.onload = () => setCsv(r.result || "");
    r.readAsText(f);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "fleet-import-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const close = () => { setCsv(""); setResult(null); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="csv-import-dialog">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary" /> Bulk-import vehicles</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Upload a CSV of plates + APK dates to seed your fleet in seconds. Column order doesn't matter — column names do.
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} className="rounded-full" data-testid="csv-template-btn">
              Download template
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={pickFile} className="rounded-full" data-testid="csv-pick-file">
              <Upload className="h-3.5 w-3.5 mr-1" /> Upload CSV
            </Button>
            <input hidden ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} data-testid="csv-file-input" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Or paste CSV</Label>
            <Textarea
              rows={10}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="customer_name,plate,make,model,year,apk_expiry…"
              className="font-mono text-xs"
              data-testid="csv-textarea"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Supported columns: customer_name, customer_phone, customer_email, plate, make, model, year, color, km, country, apk_expiry, next_oil_change_km, vin, notes
          </p>
          {result && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm space-y-1" data-testid="csv-import-result">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Import complete
              </div>
              <div className="text-xs">✅ Vehicles created: <strong>{result.created_vehicles}</strong></div>
              <div className="text-xs">👤 New customers: <strong>{result.created_customers}</strong> · Reused: <strong>{result.reused_customers}</strong></div>
              {result.errors?.length > 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  <div className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {result.errors.length} row(s) skipped:</div>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>Close</Button>
          <Button type="button" onClick={doImport} disabled={busy || !csv.trim()} className="rounded-full bg-primary" data-testid="csv-import-run">
            {busy ? "Importing…" : "Import fleet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
