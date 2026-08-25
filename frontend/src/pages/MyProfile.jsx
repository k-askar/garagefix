import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { User, Mail, Shield, Building2, ChevronRight, KeyRound } from "lucide-react";
import { toast } from "sonner";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";

/**
 * "My Profile" — self-service page for changing your own name / email.
 * Available to every logged-in user (super_admin / owner / staff).  Any change
 * requires the current password to guard against session hijack.
 */
export default function MyProfile() {
  const { user, setUser } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [form, setForm] = useState({
    name:  user?.name  || "",
    email: user?.email || "",
  });
  const dirty = form.name.trim() !== (user?.name || "").trim()
             || form.email.trim().toLowerCase() !== (user?.email || "").trim().toLowerCase();

  const startSave = (e) => {
    e.preventDefault();
    if (!dirty) return toast.info("Nothing to update");
    if (!form.name.trim()) return toast.error("Name is required");
    if (!/.+@.+\..+/.test(form.email)) return toast.error("Enter a valid email address");
    setCurrentPassword("");
    setConfirmOpen(true);
  };

  const doSave = async (e) => {
    e.preventDefault();
    if (!currentPassword) return toast.error("Enter your current password to confirm");
    setBusy(true);
    try {
      const { data } = await api.put("/auth/me/profile", {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        current_password: currentPassword,
      });
      if (data.token) {
        localStorage.setItem("garage_token", data.token);
        localStorage.setItem("garage_user", JSON.stringify(data.user));
      }
      setUser?.(data.user);
      toast.success("Profile updated");
      setConfirmOpen(false);
      setCurrentPassword("");
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  const roleLabel = { super_admin: "Platform admin", owner: "Garage owner", staff: "Staff" }[user?.role] || user?.role;
  const roleTone =
    user?.role === "super_admin" ? "bg-primary/15 text-primary border-primary/30" :
    user?.role === "owner"       ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" :
                                   "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30";

  return (
    <div className="space-y-8 max-w-2xl" data-testid="my-profile-page">
      <div>
        <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2 flex items-center gap-2">
          <User className="h-3.5 w-3.5" /> Account · My Profile
        </div>
        <h1 className="font-display text-4xl font-black tracking-tight">Your details</h1>
        <p className="text-muted-foreground mt-2">
          Change how you sign in.  Every change is confirmed with your current password.
        </p>
      </div>

      <Card className="p-6 border-border space-y-5">
        <div className="flex items-center gap-4 pb-4 border-b border-border">
          <div className="h-14 w-14 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
            <User className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-lg truncate">{user?.name || "—"}</div>
            <div className="text-sm text-muted-foreground font-mono truncate">{user?.email}</div>
          </div>
          <Badge className={`${roleTone} uppercase text-[10px]`}>{roleLabel}</Badge>
        </div>

        <form onSubmit={startSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><User className="h-3 w-3" /> Full name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Mike Johnson"
              required
              data-testid="profile-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> Login email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@yourdomain.com"
              required
              data-testid="profile-email"
            />
            <p className="text-xs text-muted-foreground">
              Changing this is the address you'll use to sign in from now on.  You must be able to receive email at the new address.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setForm({ name: user?.name || "", email: user?.email || "" })}
              disabled={!dirty}
              data-testid="profile-reset"
            >
              Reset
            </Button>
            <Button
              type="submit"
              className="rounded-full bg-primary"
              disabled={!dirty}
              data-testid="profile-save"
            >
              Save changes <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6 border-border">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-md bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">Password</div>
            <p className="text-sm text-muted-foreground mt-1">
              Rotate your sign-in password anytime.  We never show your current password.
            </p>
            <div className="mt-3">
              <ChangePasswordDialog triggerLabel="Change password" triggerClassName="w-auto px-3" />
            </div>
          </div>
        </div>
      </Card>

      {user?.role !== "super_admin" && (
        <Card className="p-5 border-border">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span>
              You belong to a specific garage.  Ask a Platform Admin if you need to move to another tenant.
            </span>
          </div>
        </Card>
      )}

      {user?.role === "super_admin" && (
        <Card className="p-5 border-primary/40 bg-primary/5">
          <div className="flex items-center gap-3 text-sm">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <span>
              <strong>Platform admin</strong> — you can see and manage every garage.  Change your password immediately if you're still using the seed <code className="font-mono text-xs">platform123</code>.
            </span>
          </div>
        </Card>
      )}

      {/* Confirm current-password dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <Shield className="h-4 w-4 text-primary" /> Confirm it's really you
            </DialogTitle>
            <DialogDescription>
              Enter your current password to save the changes.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={doSave} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoFocus
                required
                data-testid="profile-confirm-pw"
              />
            </div>
            <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1">
              <div><span className="text-muted-foreground">Name:</span> <strong>{form.name}</strong></div>
              <div><span className="text-muted-foreground">Email:</span> <strong>{form.email}</strong></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button type="submit" className="rounded-full bg-primary" disabled={busy} data-testid="profile-confirm-save">
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
