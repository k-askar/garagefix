import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Bell, Send, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

function todayISO(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); }

export default function Reminders() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", reason: "Oil & filter service", due_date: todayISO(30), due_km: "", car_plate: "", car_make: "", car_model: "" });
  const { data: rows = [] } = useQuery({ queryKey: ["reminders"], queryFn: () => api.get("/reminders").then(r => r.data) });
  const { data: customers = [] } = useQuery({ queryKey: ["cus"], queryFn: () => api.get("/customers").then(r => r.data) });

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.post("/reminders", { ...form, customer_id: form.customer_id, due_km: form.due_km ? Number(form.due_km) : null });
      toast.success("Reminder scheduled");
      setOpen(false);
      setForm({ customer_id: "", reason: "Oil & filter service", due_date: todayISO(30), due_km: "", car_plate: "", car_make: "", car_model: "" });
      qc.invalidateQueries({ queryKey: ["reminders"] });
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const sendNow = async (id) => {
    try { await api.post(`/reminders/${id}/send`); toast.success("Email queued"); setTimeout(() => qc.invalidateQueries({ queryKey: ["reminders"] }), 1500); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete reminder?")) return;
    try { await api.delete(`/reminders/${id}`); toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["reminders"] }); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="space-y-8" data-testid="reminders-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Retention</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Service reminders</h1>
          <p className="text-muted-foreground mt-2">Auto-nudge customers a few days before their next service. Sent by email at 09:00 UTC daily.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-full bg-primary hover:bg-primary/90" data-testid="reminder-new-button"><Plus className="h-4 w-4 mr-2" /> New reminder</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Schedule service reminder</DialogTitle></DialogHeader>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={form.customer_id || "none"} onValueChange={(v) => setForm({ ...form, customer_id: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="reminder-customer"><SelectValue placeholder="Pick customer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— pick —</SelectItem>
                    {customers.map(c => <SelectItem key={c.id} value={c.id} disabled={!c.email}>{c.name}{!c.email ? " · (no email)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Only customers with an email address can be reminded.</p>
              </div>
              <div className="space-y-1.5"><Label>Reason</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="reminder-reason" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Due date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} data-testid="reminder-date" /></div>
                <div className="space-y-1.5"><Label>Due at (km)</Label><Input type="number" value={form.due_km} onChange={(e) => setForm({ ...form, due_km: e.target.value })} placeholder="e.g. 60000" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5"><Label>Plate</Label><Input value={form.car_plate} onChange={(e) => setForm({ ...form, car_plate: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Make</Label><Input value={form.car_make} onChange={(e) => setForm({ ...form, car_make: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Model</Label><Input value={form.car_model} onChange={(e) => setForm({ ...form, car_model: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="rounded-full bg-primary" data-testid="reminder-save"><Bell className="h-4 w-4 mr-2" />Schedule</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-border overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Due</TableHead><TableHead>Customer</TableHead><TableHead>Vehicle</TableHead>
            <TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead className="text-right w-40">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.due_date}{r.due_km ? ` · ${r.due_km} km` : ""}</TableCell>
                <TableCell>
                  <div>{r.customer_name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">{r.customer_email || "no email"}</div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{[r.car_make, r.car_model].filter(Boolean).join(" ")} {r.car_plate}</TableCell>
                <TableCell>{r.reason}</TableCell>
                <TableCell>
                  {r.status === "sent" ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">Sent</Badge>
                   : r.status === "cancelled" ? <Badge variant="outline">Cancelled</Badge>
                   : <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15">Pending</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {r.status === "pending" && <Button size="sm" variant="outline" className="rounded-full" onClick={() => sendNow(r.id)} data-testid={`reminder-send-${r.id}`}><Send className="h-3 w-3 mr-1" />Send now</Button>}
                    <Button size="icon" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={6} className="text-center py-16 text-muted-foreground">No reminders scheduled.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
