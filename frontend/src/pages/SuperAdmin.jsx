import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Building2, Plus, Power, PowerOff, Globe, LogIn, Trash2, AlertTriangle, CalendarClock, Bell, RefreshCw, Pencil, KeyRound } from "lucide-react";
import { toast } from "sonner";

const COUNTRIES = ["NL", "BE", "DE", "FR", "ES", "IT", "GB", "TR", "MA", "SA", "AE", "EG"];

/**
 * Super Admin dashboard — visible only to users whose `role === "super_admin"`.
 * Lets the platform owner list every garage tenant, spin up new ones, toggle
 * active status, and see per-tenant record counts at a glance.
 */
export default function SuperAdmin() {
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState(null);   // tenant selected for hard-delete
  const [purgeConfirmName, setPurgeConfirmName] = useState("");
  const [purging, setPurging] = useState(false);
  // "Edit owner" dialog — super-admin support tool to fix a lost email / reset
  // a forgotten password for a specific garage owner.
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ owner_email: "", owner_name: "", new_password: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({ name: "", country: "NL", plan: "trial", owner_email: "", owner_name: "" });
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => api.get("/tenants").then(r => r.data),
    refetchInterval: 30000,
  });
  const { data: expiring = [] } = useQuery({
    queryKey: ["tenants-expiring"],
    queryFn: () => api.get("/tenants/expiring", { params: { within_days: 14 } }).then(r => r.data),
    refetchInterval: 60000,
  });

  const extendSubscription = async (t, days = 30) => {
    try {
      const { data } = await api.post(`/tenants/${t.id}/extend`, { days });
      toast.success(`"${t.name}" renewed until ${data.subscription_expires_at}`);
      qc.invalidateQueries({ queryKey: ["tenants"] });
      qc.invalidateQueries({ queryKey: ["tenants-expiring"] });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name required");
    try {
      await api.post("/tenants", form);
      toast.success(`Garage "${form.name}" created`);
      setOpen(false);
      setForm({ name: "", country: "NL", plan: "trial", owner_email: "", owner_name: "" });
      qc.invalidateQueries({ queryKey: ["tenants"] });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  const toggleActive = async (t) => {
    try {
      await api.put(`/tenants/${t.id}`, { active: !t.active });
      toast.success(t.active ? "Suspended" : "Reactivated");
      qc.invalidateQueries({ queryKey: ["tenants"] });
    } catch (err) { toast.error(formatApiError(err)); }
  };

  /* "Enter garage" — swap the current super_admin JWT for one that scopes
     every DB call to the target tenant.  We keep the identity (still
     super_admin) so the impersonation banner is visible + can be exited.  */
  const enterGarage = async (t) => {
    try {
      const { data } = await api.post(`/tenants/${t.id}/impersonate`);
      localStorage.setItem("garage_token", data.token);
      // Refetch our profile so `user.impersonating` populates and the banner
      // shows immediately without a hard reload.
      const me = await api.get("/auth/me");
      setUser?.(me.data);
      localStorage.setItem("garage_user", JSON.stringify(me.data));
      toast.success(`Now viewing ${t.name}`);
      // Send the admin to the dashboard of the impersonated tenant — most
      // support requests start with "why doesn't my dashboard show X?".
      window.location.href = "/";
    } catch (err) { toast.error(formatApiError(err)); }
  };

  /* Hard-delete a cancelled garage — irreversible.  Opens a confirmation
     dialog that forces the admin to retype the garage name before we call
     `DELETE /tenants/{id}?purge=true`, which cascades across every scoped
     collection.  */
  const openPurgeDialog = (t) => {
    setPurgeTarget(t);
    setPurgeConfirmName("");
  };

  const openEditOwner = (t) => {
    setEditTarget(t);
    setEditForm({
      owner_email: t.owner_email || "",
      owner_name: "",
      new_password: "",
    });
  };
  const saveOwnerEdit = async () => {
    if (!editTarget) return;
    // Only send fields that were actually filled in — the endpoint rejects
    // an empty payload so we surface a friendly error instead.
    const body = {};
    if (editForm.owner_email && editForm.owner_email !== editTarget.owner_email) body.owner_email = editForm.owner_email.trim();
    if (editForm.owner_name?.trim()) body.owner_name = editForm.owner_name.trim();
    if (editForm.new_password?.trim()) body.new_password = editForm.new_password.trim();
    if (Object.keys(body).length === 0) {
      toast.error("Change at least one field first");
      return;
    }
    setEditSaving(true);
    try {
      const { data } = await api.post(`/tenants/${editTarget.id}/reset-owner`, body);
      toast.success(`Updated: ${data.changed.join(", ")}`);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["tenants"] });
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setEditSaving(false);
    }
  };
  const confirmPurge = async () => {
    if (!purgeTarget) return;
    if (purgeConfirmName.trim() !== purgeTarget.name) {
      toast.error("Garage name doesn't match — deletion cancelled");
      return;
    }
    setPurging(true);
    try {
      const { data } = await api.delete(`/tenants/${purgeTarget.id}`, { params: { purge: true } });
      const total = Object.values(data.deleted || {}).reduce((a, b) => a + Number(b || 0), 0);
      toast.success(`"${purgeTarget.name}" deleted — ${total} records removed`);
      setPurgeTarget(null);
      setPurgeConfirmName("");
      qc.invalidateQueries({ queryKey: ["tenants"] });
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="space-y-8" data-testid="super-admin-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2 flex items-center gap-2">
            <Globe className="h-3.5 w-3.5" /> Platform · Super Admin
          </div>
          <h1 className="font-display text-4xl font-black tracking-tight">Garages</h1>
          <p className="text-muted-foreground mt-2">
            Every workshop connected to the PitStock platform. Each tenant is fully isolated — one login per garage, one dataset per garage.
          </p>
        </div>
        <Button className="rounded-full bg-primary" onClick={() => setOpen(true)} data-testid="tenant-new-button">
          <Plus className="h-4 w-4 mr-2" /> New garage
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total garages" value={tenants.length} tone="primary" />
        <StatCard label="Active" value={tenants.filter(t => t.active).length} tone="emerald" />
        <StatCard label="Suspended" value={tenants.filter(t => !t.active).length} tone="rose" />
        <StatCard label="Expiring / expired" value={expiring.length} tone={expiring.length ? "amber" : "primary"} />
      </div>

      {expiring.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-4" data-testid="expiring-banner">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-md bg-amber-500/15 border border-amber-500/40 flex items-center justify-center shrink-0">
              <Bell className="h-4 w-4 text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-amber-700 dark:text-amber-400">
                {expiring.length} garage{expiring.length > 1 ? "s" : ""} need payment attention
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Renew each one after collecting payment — the "Renew 30d" button rolls the expiry date forward.
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                {expiring.slice(0, 8).map(e => {
                  const dr = e.days_remaining;
                  const tone = dr < 0
                    ? "text-rose-700 dark:text-rose-400"
                    : dr <= 3
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-muted-foreground";
                  const label = dr == null ? "no date"
                    : dr < 0 ? `expired ${Math.abs(dr)}d ago`
                    : dr === 0 ? "expires today"
                    : `${dr}d left`;
                  return (
                    <div key={e.id} className="flex items-center justify-between gap-3 text-sm" data-testid={`expiring-row-${e.id}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <CalendarClock className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
                        <span className="font-semibold truncate">{e.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground truncate">{e.owner_email || "—"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`font-mono text-[10px] ${tone}`}>{label}</Badge>
                        <Button size="sm" variant="outline" className="rounded-full h-7 px-3 border-amber-500/40 text-amber-700 dark:text-amber-400" onClick={() => extendSubscription(e, 30)} data-testid={`extend-${e.id}`}>
                          <RefreshCw className="h-3 w-3 mr-1" />Renew 30d
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {expiring.length > 8 && (
                  <div className="text-xs text-muted-foreground pt-1">+ {expiring.length - 8} more in the table below</div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Garage</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Owner email</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && !tenants.length && (
              <TableRow><TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                No garages yet. Click "New garage" to onboard the first one.
              </TableCell></TableRow>
            )}
            {tenants.map(t => (
              <TableRow key={t.id} data-testid={`tenant-row-${t.id}`}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{t.id.slice(0, 8)}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell><Badge variant="outline" className="font-mono">{t.country}</Badge></TableCell>
                <TableCell><Badge className="uppercase text-[10px] bg-primary/15 text-primary border-primary/30">{t.plan}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{t.owner_email || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{(t.created_at || "").slice(0, 10)}</TableCell>
                <TableCell>
                  <ExpiryBadge expires={t.subscription_expires_at} />
                </TableCell>
                <TableCell>
                  {t.active
                    ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">Active</Badge>
                    : <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/15">Suspended</Badge>
                  }
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      className="rounded-full bg-primary hover:bg-primary/90"
                      onClick={() => enterGarage(t)}
                      disabled={!t.active}
                      title={t.active ? "Sign in as this garage" : "Suspended — reactivate first"}
                      data-testid={`tenant-impersonate-${t.id}`}
                    >
                      <LogIn className="h-3 w-3 mr-1" />Enter garage
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                      onClick={() => extendSubscription(t, 30)}
                      title="Mark subscription as paid — extend by 30 days"
                      data-testid={`tenant-extend-${t.id}`}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />Renew 30d
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => toggleActive(t)}
                      data-testid={`tenant-toggle-${t.id}`}
                    >
                      {t.active
                        ? <><PowerOff className="h-3 w-3 mr-1" />Suspend</>
                        : <><Power className="h-3 w-3 mr-1" />Reactivate</>}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => openEditOwner(t)}
                      title="Edit owner email / password (emergency support)"
                      data-testid={`tenant-edit-${t.id}`}
                    >
                      <Pencil className="h-3 w-3 mr-1" />Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => openPurgeDialog(t)}
                      title="Permanently delete this garage and all its data"
                      data-testid={`tenant-delete-${t.id}`}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Onboard a new garage</DialogTitle>
            <DialogDescription>Creates an isolated tenant with its own settings, users and data.</DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Garage name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mikes Auto Repair" required data-testid="tenant-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v })}>
                  <SelectTrigger data-testid="tenant-country"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                  <SelectTrigger data-testid="tenant-plan"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">Trial (14 days)</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Owner name <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} placeholder="Mike Johnson" />
            </div>
            <div className="space-y-1.5">
              <Label>Owner email <span className="text-muted-foreground text-xs">(for future onboarding email)</span></Label>
              <Input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} placeholder="mike@garage.com" />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="rounded-full bg-primary" data-testid="tenant-submit"><Plus className="h-4 w-4 mr-2" />Create garage</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v) setEditTarget(null); }}>
        <DialogContent className="max-w-lg" data-testid="tenant-edit-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Edit owner — {editTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Emergency support tool. Updates the owner user's login email, display name, and/or password
              for this garage. Fields you leave blank stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
            The new credentials take effect immediately — the current session of anyone signed in as owner
            will remain valid until they log out, but the next login will require the new password.
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Owner login email</Label>
              <Input
                type="email"
                value={editForm.owner_email}
                onChange={(e) => setEditForm({ ...editForm, owner_email: e.target.value })}
                placeholder="owner@garage.nl"
                data-testid="edit-owner-email"
              />
              <p className="text-[10px] text-muted-foreground">
                Also updates the address used for billing reminders + onboarding emails.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Owner display name <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                value={editForm.owner_name}
                onChange={(e) => setEditForm({ ...editForm, owner_name: e.target.value })}
                placeholder="Jan de Vries"
                data-testid="edit-owner-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>New password <span className="text-muted-foreground text-xs">(leave blank to keep)</span></Label>
              <Input
                type="text"
                value={editForm.new_password}
                onChange={(e) => setEditForm({ ...editForm, new_password: e.target.value })}
                placeholder="min. 6 characters"
                data-testid="edit-owner-password"
              />
              <p className="text-[10px] text-muted-foreground">
                Shown in plain text so you can dictate it to the owner over the phone.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditTarget(null)} disabled={editSaving}>Cancel</Button>
            <Button
              type="button"
              className="rounded-full bg-primary"
              onClick={saveOwnerEdit}
              disabled={editSaving}
              data-testid="edit-owner-save"
            >
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!purgeTarget} onOpenChange={(v) => { if (!v) { setPurgeTarget(null); setPurgeConfirmName(""); } }}>
        <DialogContent className="max-w-lg" data-testid="tenant-delete-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Delete garage permanently
            </DialogTitle>
            <DialogDescription>
              This will <strong>permanently remove</strong> "{purgeTarget?.name}" and every record it owns —
              users, customers, vehicles, invoices, repair cards, inventory, transactions and settings.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            Prefer to keep the data? Use <strong>Suspend</strong> instead — it disables login but leaves the records intact.
          </div>
          <div className="space-y-2">
            <Label htmlFor="purge-confirm">
              Type <span className="font-mono bg-muted px-1 py-0.5 rounded">{purgeTarget?.name}</span> to confirm
            </Label>
            <Input
              id="purge-confirm"
              value={purgeConfirmName}
              onChange={(e) => setPurgeConfirmName(e.target.value)}
              placeholder={purgeTarget?.name || ""}
              autoFocus
              data-testid="tenant-delete-confirm-input"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { setPurgeTarget(null); setPurgeConfirmName(""); }} disabled={purging}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmPurge}
              disabled={purging || (purgeConfirmName.trim() !== (purgeTarget?.name || ""))}
              data-testid="tenant-delete-confirm"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {purging ? "Deleting…" : "Delete forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, tone = "primary" }) {
  const toneClass = {
    primary: "text-primary bg-primary/10 border-primary/30",
    emerald: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    rose:    "text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/30",
    amber:   "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30",
  }[tone] || "text-primary bg-primary/10 border-primary/30";
  return (
    <Card className={`p-5 border ${toneClass}`}>
      <div className="text-[10px] font-mono uppercase tracking-widest opacity-80">{label}</div>
      <div className="text-4xl font-black font-display mt-1">{value}</div>
    </Card>
  );
}

function ExpiryBadge({ expires }) {
  if (!expires) return <span className="text-xs text-muted-foreground">—</span>;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expires); exp.setHours(0, 0, 0, 0);
  const days = Math.round((exp - today) / 86400000);
  let cls = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
  let label = `${days}d left`;
  if (days < 0) { cls = "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"; label = `expired ${Math.abs(days)}d ago`; }
  else if (days === 0) { cls = "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30"; label = "expires today"; }
  else if (days <= 7) { cls = "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"; }
  return (
    <div className="flex flex-col gap-0.5">
      <Badge className={`${cls} font-mono text-[10px]`}>{label}</Badge>
      <span className="text-[10px] font-mono text-muted-foreground">{expires}</span>
    </div>
  );
}
