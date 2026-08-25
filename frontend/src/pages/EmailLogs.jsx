import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { useLang } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, RefreshCw, Send, Search } from "lucide-react";

const PURPOSE_LABEL = {
  invoice_send: "Invoice",
  invoice_overdue: "Overdue reminder",
  service_reminder: "Service reminder",
  password_setup: "Password setup",
  other: "Other",
  resend: "Resend",
};

export default function EmailLogs() {
  const { t, meta } = useLang();
  const isRTL = meta.dir === "rtl";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [purpose, setPurpose] = useState("all");
  const [q, setQ] = useState("");
  const [resending, setResending] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (status !== "all") params.status = status;
      if (purpose !== "all") params.purpose = purpose;
      if (q.trim()) params.q = q.trim();
      const { data } = await api.get(`/email-logs`, { params });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(formatApiError(e) || t("emailLogsLoadFailed") || "Failed to load email logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, purpose]);

  const stats = useMemo(() => {
    const total = rows.length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const accepted = total - failed;
    return { total, accepted, failed };
  }, [rows]);

  const handleResend = async (row) => {
    setResending(row.id);
    try {
      await api.post(`/email-logs/${row.id}/resend`);
      toast.success(t("emailResent") || "Email resent");
      await load();
    } catch (e) {
      toast.error(formatApiError(e) || (t("emailResendFailed") || "Resend failed"));
    } finally {
      setResending(null);
    }
  };

  return (
    <div className="p-6 space-y-6" dir={meta.dir} data-testid="email-logs-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight flex items-center gap-3">
            <Mail className="h-6 w-6 text-primary" />
            {t("emailLogsTitle") || "Email delivery log"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("emailLogsSub") || "Every email the app sent — with status and resend."}
          </p>
        </div>
        <Button variant="outline" onClick={load} data-testid="email-logs-refresh">
          <RefreshCw className="h-4 w-4 mr-2" /> {t("refresh") || "Refresh"}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t("emailLogsAll") || "Total"} value={stats.total} tone="default" />
        <StatCard label={t("emailLogsAccepted") || "Accepted"} value={stats.accepted} tone="success" />
        <StatCard label={t("emailLogsFailed") || "Failed"} value={stats.failed} tone="danger" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className={`absolute top-2.5 h-4 w-4 text-muted-foreground ${isRTL ? "right-2" : "left-2"}`} />
          <Input
            data-testid="email-logs-search"
            className={isRTL ? "pr-8" : "pl-8"}
            placeholder={t("emailLogsSearch") || "Search recipient or subject..."}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" data-testid="email-logs-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("emailLogsAllStatus") || "All statuses"}</SelectItem>
            <SelectItem value="accepted">{t("emailLogsAccepted") || "Accepted"}</SelectItem>
            <SelectItem value="failed">{t("emailLogsFailed") || "Failed"}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={purpose} onValueChange={setPurpose}>
          <SelectTrigger className="w-52" data-testid="email-logs-purpose">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("emailLogsAllPurpose") || "All purposes"}</SelectItem>
            <SelectItem value="invoice_send">{PURPOSE_LABEL.invoice_send}</SelectItem>
            <SelectItem value="invoice_overdue">{PURPOSE_LABEL.invoice_overdue}</SelectItem>
            <SelectItem value="service_reminder">{PURPOSE_LABEL.service_reminder}</SelectItem>
            <SelectItem value="password_setup">{PURPOSE_LABEL.password_setup}</SelectItem>
            <SelectItem value="other">{PURPOSE_LABEL.other}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground uppercase text-[11px] tracking-wider">
            <tr>
              <th className="text-left px-4 py-2">{t("emailLogsDate") || "Sent"}</th>
              <th className="text-left px-4 py-2">{t("emailLogsTo") || "To"}</th>
              <th className="text-left px-4 py-2">{t("emailLogsSubject") || "Subject"}</th>
              <th className="text-left px-4 py-2">{t("emailLogsPurposeCol") || "Purpose"}</th>
              <th className="text-left px-4 py-2">{t("emailLogsStatusCol") || "Status"}</th>
              <th className="text-right px-4 py-2">{t("emailLogsActions") || "Action"}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground" data-testid="email-logs-empty">
                {t("emailLogsEmpty") || "No emails have been sent yet."}
              </td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2">{r.to}</td>
                <td className="px-4 py-2 max-w-[280px] truncate" title={r.subject}>{r.subject}</td>
                <td className="px-4 py-2">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {PURPOSE_LABEL[r.purpose] || r.purpose}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  {r.status === "accepted" ? (
                    <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30" data-testid={`status-accepted-${r.id}`}>
                      accepted
                    </Badge>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <Badge variant="destructive" data-testid={`status-failed-${r.id}`}>failed</Badge>
                      {r.error && <span className="text-[10px] text-destructive/80 max-w-[220px] truncate" title={r.error}>{r.error}</span>}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleResend(r)}
                    disabled={resending === r.id}
                    data-testid={`resend-${r.id}`}
                  >
                    <Send className="h-3 w-3 mr-1" />
                    {resending === r.id ? (t("sending") || "Sending…") : (t("resend") || "Resend")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneCls = tone === "success"
    ? "border-emerald-500/40 text-emerald-500"
    : tone === "danger"
      ? "border-destructive/40 text-destructive"
      : "border-border text-foreground";
  return (
    <div className={`rounded-lg border ${toneCls} bg-card p-4`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-display font-bold mt-1">{value}</div>
    </div>
  );
}
