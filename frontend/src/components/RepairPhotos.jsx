import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Camera, Upload, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useLang } from "@/i18n";

const KINDS = ["general", "before", "after", "damage"];
const API = process.env.REACT_APP_BACKEND_URL;

function photoUrl(id, token) {
  return `${API}/api/photos/${id}?auth=${encodeURIComponent(token || "")}`;
}

export default function RepairPhotos({ repairId, photos = [], onChange }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("general");
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);
  const token = localStorage.getItem("garage_token") || "";

  // photos are usually authoritative from parent — fallback to endpoint if empty
  const { data: fetched = photos } = useQuery({
    queryKey: ["repair-photos", repairId],
    queryFn: () => api.get(`/repairs/${repairId}/photos`).then(r => r.data),
    enabled: !!repairId,
    initialData: photos,
  });

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 5 * 1024 * 1024) return toast.error("Max 5 MB per photo");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await api.post(`/repairs/${repairId}/photos`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Photo uploaded");
      qc.invalidateQueries({ queryKey: ["repair-photos", repairId] });
      qc.invalidateQueries({ queryKey: ["repairs"] });
      onChange?.([...(photos || []), res.data]);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setBusy(false); }
  };

  const del = async (photoId) => {
    if (!window.confirm(t("delete") + "?")) return;
    try {
      await api.delete(`/repairs/${repairId}/photos/${photoId}`);
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["repair-photos", repairId] });
      qc.invalidateQueries({ queryKey: ["repairs"] });
      onChange?.((photos || []).filter(p => p.id !== photoId));
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-3" data-testid="repair-photos">
      <div className="flex items-center gap-2 flex-wrap">
        <Camera className="h-4 w-4 text-primary" />
        <span className="font-display text-lg font-bold">{t("carPhotos")}</span>
        <span className="text-[11px] font-mono text-muted-foreground">({(fetched || []).length}/10)</span>
        <div className="flex-1" />
        <div className="flex gap-1">
          {KINDS.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              data-testid={`photo-kind-${k}`}
              className={`px-3 py-1 rounded-full text-xs font-mono uppercase tracking-widest border ${kind === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {t(`photoKind_${k}`)}
            </button>
          ))}
        </div>
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || (fetched || []).length >= 10}
          className="rounded-full h-9"
          data-testid="photo-upload-btn"
        >
          <Upload className="h-4 w-4 mr-1" /> {busy ? "..." : t("uploadPhoto")}
        </Button>
        <input ref={inputRef} hidden type="file" accept="image/*" onChange={upload} data-testid="photo-file-input" />
      </div>

      {(fetched || []).length === 0 ? (
        <div className="p-6 rounded-md border border-dashed border-border text-center text-sm text-muted-foreground">
          {t("noPhotosYet")}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {(fetched || []).map(p => (
            <div key={p.id} className="relative group rounded-md overflow-hidden border border-border bg-muted/30" data-testid={`photo-tile-${p.id}`}>
              <img
                src={photoUrl(p.id, token)}
                alt={p.caption || p.kind}
                className="w-full h-28 object-cover cursor-zoom-in"
                onClick={() => setPreview(p)}
                loading="lazy"
              />
              <div className="absolute top-1 left-1 text-[9px] font-mono uppercase bg-black/70 text-white px-1.5 py-0.5 rounded">{p.kind}</div>
              <button
                onClick={() => del(p.id)}
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-rose-600/90 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                data-testid={`photo-delete-${p.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center" onClick={() => setPreview(null)}>
            <X className="h-5 w-5" />
          </button>
          <img src={photoUrl(preview.id, token)} alt={preview.caption} className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}
