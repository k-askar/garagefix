import React, { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { KeyRound, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Self-service password change for the currently logged-in user (any role).
 * Uses `POST /api/auth/change-password` which verifies the current password
 * before rotating the hash — safe to expose to super_admin, owners and staff.
 */
export default function ChangePasswordDialog({ triggerClassName = "", triggerLabel = "Change password" }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.next.length < 6) return toast.error("New password must be at least 6 characters");
    if (form.next !== form.confirm) return toast.error("Passwords don't match");
    if (form.next === form.current) return toast.error("New password must differ from the current one");
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: form.current, new_password: form.next });
      toast.success("Password updated — use the new one next time you sign in");
      setOpen(false);
      setForm({ current: "", next: "", confirm: "" });
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm({ current: "", next: "", confirm: "" }); }}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className={`w-full justify-start gap-2 text-muted-foreground hover:text-foreground ${triggerClassName}`}
          data-testid="change-password-open"
        >
          <KeyRound className="h-4 w-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <ShieldCheck className="h-4 w-4 text-primary" /> Change password
          </DialogTitle>
          <DialogDescription>Rotate your own password. You'll stay signed in on this device.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input
              type={show ? "text" : "password"}
              value={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.value })}
              autoComplete="current-password"
              required
              data-testid="change-pw-current"
            />
          </div>
          <div className="space-y-1.5">
            <Label>New password <span className="text-muted-foreground text-xs">(min 6)</span></Label>
            <Input
              type={show ? "text" : "password"}
              value={form.next}
              onChange={(e) => setForm({ ...form, next: e.target.value })}
              autoComplete="new-password"
              minLength={6}
              required
              data-testid="change-pw-new"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input
              type={show ? "text" : "password"}
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              autoComplete="new-password"
              minLength={6}
              required
              data-testid="change-pw-confirm"
            />
          </div>
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            data-testid="change-pw-toggle-visibility"
          >
            {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {show ? "Hide passwords" : "Show passwords"}
          </button>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="rounded-full bg-primary" disabled={busy} data-testid="change-pw-submit">
              {busy ? "Saving…" : "Update password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
