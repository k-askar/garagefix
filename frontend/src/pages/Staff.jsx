import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, UserCog, Pencil, Package, Wrench, Receipt, Wallet, Users, Truck, BarChart3, Calendar as CalendarIcon, ShieldCheck, Check, QrCode } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/i18n";
import StaffInviteQrDialog from "@/components/StaffInviteQrDialog";

const SECTION_ICON = {
  package: Package, wrench: Wrench, receipt: Receipt, wallet: Wallet,
  users: Users, truck: Truck, "bar-chart": BarChart3, calendar: CalendarIcon,
};

/* ─────────────────────────────────────────────────────────────
   Permission matrix — grouped checkbox tree
   ───────────────────────────────────────────────────────────── */
function PermissionMatrix({ catalog, value, onChange, disabled }) {
  const { t } = useLang();
  const set = new Set(value || []);

  const toggleOne = (key) => {
    if (disabled) return;
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(Array.from(next));
  };

  const sectionState = (section) => {
    const keys = section.perms.map(p => p.key);
    const have = keys.filter(k => set.has(k)).length;
    if (have === 0) return "none";
    if (have === keys.length) return "all";
    return "some";
  };

  const toggleSection = (section) => {
    if (disabled) return;
    const keys = section.perms.map(p => p.key);
    const state = sectionState(section);
    const next = new Set(set);
    if (state === "all") { keys.forEach(k => next.delete(k)); }
    else { keys.forEach(k => next.add(k)); }
    onChange(Array.from(next));
  };

  const selectAll = () => {
    if (disabled) return;
    onChange(catalog.flatMap(s => s.perms.map(p => p.key)));
  };
  const clearAll = () => {
    if (disabled) return;
    onChange([]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {value.length} / {catalog.reduce((s, sec) => s + sec.perms.length, 0)} {t("permissionsGranted")}
        </div>
        {!disabled && (
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px] rounded-full" onClick={selectAll} data-testid="perm-select-all">
              {t("selectAll")}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px] rounded-full" onClick={clearAll} data-testid="perm-clear-all">
              {t("clearAll")}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {catalog.map(section => {
          const state = sectionState(section);
          const SIcon = SECTION_ICON[section.icon] || ShieldCheck;
          return (
            <div
              key={section.section}
              className={`rounded-md border transition-colors ${
                state === "all" ? "border-primary/50 bg-primary/5"
                : state === "some" ? "border-amber-500/40 bg-amber-500/5"
                : "border-border"
              }`}
              data-testid={`perm-section-${section.section}`}
            >
              <button
                type="button"
                onClick={() => toggleSection(section)}
                disabled={disabled}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors rounded-t-md"
                data-testid={`perm-section-toggle-${section.section}`}
              >
                <div className="flex items-center gap-2">
                  <SIcon className={`h-4 w-4 ${state !== "none" ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="font-semibold text-sm">{t("perm_section_" + section.section) !== ("perm_section_" + section.section)
                    ? t("perm_section_" + section.section) : section.label}</span>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-mono ${
                    state === "all" ? "border-primary/40 text-primary bg-primary/10"
                    : state === "some" ? "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10"
                    : ""
                  }`}
                >
                  {state === "all" ? "✓ " + t("full") : state === "some" ? t("partial") : t("noAccess")}
                </Badge>
              </button>
              <div className="border-t border-border/50 p-2 space-y-1">
                {section.perms.map(p => {
                  const on = set.has(p.key);
                  return (
                    <label
                      key={p.key}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer text-xs transition-colors ${
                        on ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "hover:bg-muted/40"
                      } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
                    >
                      <Checkbox
                        checked={on}
                        onCheckedChange={() => toggleOne(p.key)}
                        disabled={disabled}
                        data-testid={`perm-cb-${p.key}`}
                      />
                      <span className="flex-1">{t("perm_" + p.key) !== ("perm_" + p.key) ? t("perm_" + p.key) : p.label}</span>
                      {on && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Staff form (create / edit) with the permission matrix
   ───────────────────────────────────────────────────────────── */
function StaffForm({ initial, catalog, onSubmit, onCancel }) {
  const { t } = useLang();
  const [data, setData] = useState(initial || {
    name: "", email: "", password: "", role: "staff", permissions: [],
  });
  const isEdit = !!initial;
  const isOwner = data.role === "owner";

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(data); }}
      className="space-y-5"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("fullName")}</Label>
          <Input required value={data.name} onChange={(e) => set("name", e.target.value)} data-testid="staff-name-input" />
        </div>
        <div className="space-y-1.5">
          <Label>{t("email")}</Label>
          <Input
            required type="email"
            value={data.email}
            onChange={(e) => set("email", e.target.value)}
            disabled={isEdit}
            className={isEdit ? "bg-muted/40" : ""}
            data-testid="staff-email-input"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{isEdit ? t("newPasswordOptional") : t("temporaryPassword")}</Label>
          <Input
            type="password"
            minLength={6}
            required={!isEdit}
            value={data.password || ""}
            onChange={(e) => set("password", e.target.value)}
            placeholder={isEdit ? t("leaveBlankToKeep") : ""}
            data-testid="staff-password-input"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("role")}</Label>
          <Select value={data.role} onValueChange={(v) => set("role", v)}>
            <SelectTrigger data-testid="staff-role-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="staff">{t("roleStaff")}</SelectItem>
              <SelectItem value="owner">{t("roleOwner")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {isOwner ? t("ownerAllAccessNote") : t("staffAccessNote")}
          </p>
        </div>
      </div>

      {/* Permission matrix — hidden but reserved for owner rows */}
      <div className="border-t border-border pt-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <div className="font-display font-bold text-sm">{t("accessMatrix")}</div>
          {isOwner && <Badge className="bg-primary/15 text-primary border-primary/30">✓ {t("full")}</Badge>}
        </div>
        {isOwner ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground">
            {t("ownerBypassAll")}
          </div>
        ) : (
          <PermissionMatrix
            catalog={catalog}
            value={data.permissions || []}
            onChange={(v) => set("permissions", v)}
          />
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>{t("close")}</Button>
        <Button type="submit" className="rounded-full bg-primary hover:bg-primary/90" data-testid="staff-save-button">
          {isEdit ? t("saveChanges") : t("sendInvite")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN STAFF PAGE
   ───────────────────────────────────────────────────────────── */
export default function Staff() {
  const { user: me } = useAuth();
  const { t } = useLang();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [qrStaff, setQrStaff] = useState(null);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then(r => r.data),
  });
  const { data: catalog = [] } = useQuery({
    queryKey: ["perm-catalog"],
    queryFn: () => api.get("/permissions/catalog").then(r => r.data.sections),
  });

  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (u) => { setEditing({ ...u, password: "" }); setOpen(true); };

  const submit = async (form) => {
    try {
      if (editing) {
        const body = {
          name: form.name, role: form.role,
          permissions: form.role === "owner" ? [] : form.permissions,
        };
        if (form.password) body.password = form.password;
        await api.put(`/users/${editing.id}`, body);
        toast.success(t("staffUpdated"));
      } else {
        await api.post("/users", {
          name: form.name, email: form.email, password: form.password,
          role: form.role,
          permissions: form.role === "owner" ? [] : form.permissions,
        });
        toast.success(t("staffInvited"));
      }
      setOpen(false); setEditing(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (u) => {
    if (!window.confirm(t("removeAccount") + `\n\n${u.name} · ${u.email}`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success(t("removed"));
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const summariseAccess = (u) => {
    if (u.role === "owner") return { text: t("fullAccess"), tone: "primary" };
    const n = (u.permissions || []).length;
    if (n === 0) return { text: t("noAccessYet"), tone: "rose" };
    const total = catalog.reduce((s, sec) => s + sec.perms.length, 0);
    if (n >= total) return { text: t("fullAccess"), tone: "primary" };
    return { text: `${n} · ${t("scopes")}`, tone: "emerald" };
  };

  return (
    <div className="space-y-6" data-testid="staff-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">{t("team")}</div>
          <h1 className="font-display text-4xl font-black tracking-tight">{t("staffAccounts")}</h1>
          <p className="text-muted-foreground mt-2">{t("staffSubtitle")}</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button className="rounded-full bg-primary hover:bg-primary/90" onClick={openCreate} data-testid="invite-staff-button">
              <Plus className="h-4 w-4 mr-2" /> {t("inviteUser")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display flex items-center gap-2">
                <UserCog className="h-5 w-5 text-primary" />
                {editing ? t("editStaff") + " · " + editing.name : t("inviteUser")}
              </DialogTitle>
            </DialogHeader>
            <StaffForm
              initial={editing}
              catalog={catalog}
              onSubmit={submit}
              onCancel={() => { setOpen(false); setEditing(null); }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("user")}</TableHead>
              <TableHead>{t("email")}</TableHead>
              <TableHead>{t("role")}</TableHead>
              <TableHead>{t("accessScope")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("added")}</TableHead>
              <TableHead className="text-right w-28">{t("actionsLabel")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(u => {
              const s = summariseAccess(u);
              return (
                <TableRow key={u.id} data-testid={`staff-row-${u.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center font-mono text-xs ${
                        u.role === "owner"
                          ? "bg-primary/15 border border-primary/30 text-primary"
                          : "bg-muted border border-border"
                      }`}>
                        {(u.name || u.email).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium">{u.name}</div>
                        {u.id === me?.id && <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("you")}</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                  <TableCell>
                    {u.role === "owner"
                      ? <Badge className="bg-primary/15 text-primary border-primary/30"><UserCog className="h-3 w-3 mr-1" />{t("roleOwnerShort")}</Badge>
                      : <Badge variant="outline">{t("roleStaffShort")}</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`text-[11px] ${
                        s.tone === "primary" ? "bg-primary/15 text-primary border-primary/30"
                        : s.tone === "rose"  ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"
                                             : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                      }`}
                    >
                      {s.text}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground text-xs font-mono">
                    {new Date(u.created_at).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {u.role !== "owner" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full text-primary border-primary/40 hover:bg-primary/10"
                          onClick={() => openEdit(u)}
                          data-testid={`perms-user-${u.id}`}
                          title={t("managePermissions") || "Manage permissions"}
                        >
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                          {t("permissions") || "Permissions"}
                        </Button>
                      )}
                      {u.password_pending && u.id !== me?.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setQrStaff(u)}
                          title="Show invite QR + copy link"
                          className="text-primary"
                          data-testid={`invite-qr-${u.id}`}
                        >
                          <QrCode className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => openEdit(u)} data-testid={`edit-user-${u.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {u.id !== me?.id && (
                        <Button size="icon" variant="ghost" onClick={() => del(u)} data-testid={`del-user-${u.id}`}>
                          <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {users.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-16 text-muted-foreground">{t("noTeamMatesYet")}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <StaffInviteQrDialog
        open={!!qrStaff}
        onOpenChange={(v) => { if (!v) setQrStaff(null); }}
        staff={qrStaff}
      />
    </div>
  );
}
