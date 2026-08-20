import React, { useState } from "react";
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
import { Plus, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

export default function Staff() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "staff" });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
  });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post("/users", form);
      toast.success(`Invited ${form.name}`);
      setForm({ name: "", email: "", password: "", role: "staff" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Remove this account?")) return;
    try { await api.delete(`/users/${id}`); toast.success("Removed"); qc.invalidateQueries({ queryKey: ["users"] }); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-8" data-testid="staff-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Team</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Staff accounts</h1>
          <p className="text-muted-foreground mt-2">Mechanics log movements. Only owners edit prices or delete parts.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-full bg-primary hover:bg-primary/90" data-testid="invite-staff-button">
              <Plus className="h-4 w-4 mr-2" /> Invite user
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display">Invite user</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5"><Label>Full name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="staff-name-input" /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="staff-email-input" /></div>
              <div className="space-y-1.5"><Label>Temporary password</Label><Input required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="staff-password-input" /></div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="staff-role-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Staff (mechanic)</SelectItem>
                    <SelectItem value="owner">Owner (full access)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Staff can log stock movements and view data but cannot edit prices, delete parts, or manage users.</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="rounded-full" data-testid="staff-save-button">Send invite</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-primary font-mono text-xs">
                      {(u.name || u.email).slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium">{u.name}</div>
                      {u.id === me?.id && <div className="text-[10px] font-mono uppercase tracking-widest text-primary">You</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                <TableCell>
                  {u.role === "owner"
                    ? <Badge className="bg-primary/15 text-primary border-primary/30 hover:bg-primary/15"><UserCog className="h-3 w-3 mr-1" /> Owner</Badge>
                    : <Badge variant="outline">Staff</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs font-mono">{new Date(u.created_at).toLocaleDateString("en-GB")}</TableCell>
                <TableCell className="text-right">
                  {u.id !== me?.id && (
                    <Button size="icon" variant="ghost" onClick={() => del(u.id)} data-testid={`del-user-${u.id}`}>
                      <Trash2 className="h-4 w-4 text-rose-400" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-16 text-muted-foreground">No teammates yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
