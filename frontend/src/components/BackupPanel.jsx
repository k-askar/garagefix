import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, Cloud, CloudUpload, RotateCcw, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";

function humanSize(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function BackupPanel() {
  const { t, meta } = useLang();
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const fileRef = useRef(null);

  const { data: cloud = [] } = useQuery({
    queryKey: ["cloud-backups"],
    queryFn: () => api.get("/backup/cloud/list").then((r) => r.data),
    refetchOnMount: true,
  });

  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadNow = async () => {
    setDownloading(true);
    try {
      const res = await api.get("/backup/export", { responseType: "blob" });
      const dispo = res.headers["content-disposition"] || "";
      const match = /filename="([^"]+)"/.exec(dispo);
      const filename = match ? match[1] : `pitstock-backup-${Date.now()}.json.gz`;
      triggerDownload(res.data, filename);
      toast.success(t("backupCreated"));
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setDownloading(false); }
  };

  const restoreFromFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    if (!window.confirm(t("confirmRestoreFile"))) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await api.post("/backup/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${t("backupRestored")} · ${res.data.total_docs} docs`);
      // hard reload so any cached data is dropped
      setTimeout(() => window.location.reload(), 900);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setUploading(false); }
  };

  const pushCloud = async () => {
    setPushing(true);
    try {
      await api.post("/backup/cloud/push");
      toast.success(t("backupUploaded"));
      qc.invalidateQueries({ queryKey: ["cloud-backups"] });
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setPushing(false); }
  };

  const restoreCloud = async (b) => {
    if (!window.confirm(t("confirmRestoreCloud"))) return;
    setBusyId(b.id);
    try {
      const res = await api.post(`/backup/cloud/restore/${b.id}`);
      toast.success(`${t("backupRestored")} · ${res.data.total_docs} docs`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusyId(null); }
  };

  const downloadCloud = async (b) => {
    setBusyId(b.id);
    try {
      const res = await api.get(`/backup/cloud/download/${b.id}`, { responseType: "blob" });
      triggerDownload(res.data, b.filename);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusyId(null); }
  };

  const deleteCloud = async (b) => {
    if (!window.confirm(t("confirmDeleteBackup"))) return;
    setBusyId(b.id);
    try {
      await api.delete(`/backup/cloud/${b.id}`);
      toast.success(t("backupDeleted"));
      qc.invalidateQueries({ queryKey: ["cloud-backups"] });
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusyId(null); }
  };

  const fmt = (iso) => new Date(iso).toLocaleString(meta.locale, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <Card className="p-8 border-border space-y-6" data-testid="backup-panel">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Data</div>
        <h2 className="font-display text-2xl font-black">{t("backupTitle")}</h2>
        <p className="text-muted-foreground text-sm mt-1">{t("backupSubtitle")}</p>
      </div>

      {/* Local */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Button
          onClick={downloadNow}
          disabled={downloading}
          className="rounded-full bg-primary hover:bg-primary/90 h-11"
          data-testid="backup-download"
        >
          <Download className="h-4 w-4 mr-2" />
          {downloading ? t("downloadingBackup") : t("downloadBackup")}
        </Button>
        <Button
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="rounded-full h-11"
          data-testid="backup-restore-file"
        >
          <Upload className="h-4 w-4 mr-2" />
          {uploading ? t("downloadingBackup") : t("restoreFromFile")}
        </Button>
        <input ref={fileRef} type="file" accept=".gz,application/gzip" hidden onChange={restoreFromFile} data-testid="backup-file-input" />
      </div>

      <div className="flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
        <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{t("restoreWarning")}</span>
      </div>

      {/* Cloud */}
      <div className="pt-4 border-t border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold">{t("cloudBackups")}</h3>
          </div>
          <Button
            onClick={pushCloud}
            disabled={pushing}
            className="rounded-full bg-emerald-600 hover:bg-emerald-600/90 text-white"
            data-testid="backup-push-cloud"
          >
            <CloudUpload className="h-4 w-4 mr-2" />
            {pushing ? t("pushingToCloud") : t("pushToCloud")}
          </Button>
        </div>

        <p className="text-[11px] font-mono text-muted-foreground">{t("autoBackupHint")}</p>

        {cloud.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="backup-empty">
            {t("noCloudBackups")}
          </div>
        ) : (
          <div className="space-y-2">
            {cloud.map((b) => (
              <div
                key={b.id}
                data-testid={`backup-row-${b.id}`}
                className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-border gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate font-mono">{b.filename}</div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                    {fmt(b.created_at)} · {humanSize(b.size)} · {t(`trigger_${b.trigger || "manual"}`)}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="icon" variant="ghost" title={t("downloadBackup")} onClick={() => downloadCloud(b)} disabled={busyId === b.id} data-testid={`backup-download-${b.id}`}>
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title={t("restore")} onClick={() => restoreCloud(b)} disabled={busyId === b.id} data-testid={`backup-restore-${b.id}`}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteCloud(b)} disabled={busyId === b.id} data-testid={`backup-delete-${b.id}`}>
                    <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
