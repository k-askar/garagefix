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
import { Building2, Plus, Power, PowerOff, Globe, LogIn } from "lucide-react";
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
  const [form, setForm] = useState({ name: "", country: "NL", plan: "trial", owner_email: "", owner_name: "" });
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => api.get("/tenants").then(r => r.data),
    refetchInterval: 30000,
  });

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total garages" value={tenants.length} tone="primary" />
        <StatCard label="Active" value={tenants.filter(t => t.active).length} tone="emerald" />
        <StatCard label="Suspended" value={tenants.filter(t => !t.active).length} tone="rose" />
      </div>

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Garage</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Owner email</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">Loading…</TableCell></TableRow>}
            {!isLoading && !tenants.length && (
              <TableRow><TableCell colSpan={7} className="text-center py-16 text-muted-foreground">
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
                      className="rounded-full"
                      onClick={() => toggleActive(t)}
                      data-testid={`tenant-toggle-${t.id}`}
                    >
                      {t.active
                        ? <><PowerOff className="h-3 w-3 mr-1" />Suspend</>
                        : <><Power className="h-3 w-3 mr-1" />Reactivate</>}
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
    </div>
  );
}

function StatCard({ label, value, tone = "primary" }) {
  const toneClass = {
    primary: "text-primary bg-primary/10 border-primary/30",
    emerald: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    rose:    "text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/30",
  }[tone] || "text-primary bg-primary/10 border-primary/30";
  return (
    <Card className={`p-5 border ${toneClass}`}>
      <div className="text-[10px] font-mono uppercase tracking-widest opacity-80">{label}</div>
      <div className="text-4xl font-black font-display mt-1">{value}</div>
    </Card>
  );
}
