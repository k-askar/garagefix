import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatEUR, formatApiError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Pencil, Trash2, Printer, Upload, Car, Download } from "lucide-react";
import { toast } from "sonner";
import Barcode from "react-barcode";
import { useAuth } from "@/context/AuthContext";

const CATEGORIES = ["Engine", "Brakes", "Filters", "Lubricants", "Electrical", "Body", "Tyres", "Suspension", "Transmission", "General"];

function ItemForm({ initial, suppliers, onSubmit, onCancel }) {
  const [data, setData] = useState(initial || {
    name: "", sku: "", barcode: "", category: "General", description: "",
    cost_price: 0, selling_price: 0, quantity: 0, reorder_point: 5,
    unit: "pcs", supplier_id: "", location: "", compatible_vehicles: "",
  });
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(data); }} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5 md:col-span-2">
          <Label>Name</Label>
          <Input required value={data.name} onChange={(e) => set("name", e.target.value)} data-testid="item-name-input" />
        </div>
        <div className="space-y-1.5">
          <Label>SKU (auto if empty)</Label>
          <Input value={data.sku} onChange={(e) => set("sku", e.target.value)} data-testid="item-sku-input" />
        </div>
        <div className="space-y-1.5">
          <Label>Barcode (auto if empty)</Label>
          <Input value={data.barcode} onChange={(e) => set("barcode", e.target.value)} data-testid="item-barcode-input" />
        </div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={data.category} onValueChange={(v) => set("category", v)}>
            <SelectTrigger data-testid="item-category-select"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Unit</Label>
          <Input value={data.unit} onChange={(e) => set("unit", e.target.value)} placeholder="pcs / L / kg" />
        </div>
        <div className="space-y-1.5">
          <Label>Cost price (€)</Label>
          <Input type="number" step="0.01" value={data.cost_price} onChange={(e) => set("cost_price", Number(e.target.value))} data-testid="item-cost-input" />
        </div>
        <div className="space-y-1.5">
          <Label>Selling price (€)</Label>
          <Input type="number" step="0.01" value={data.selling_price} onChange={(e) => set("selling_price", Number(e.target.value))} data-testid="item-price-input" />
        </div>
        <div className="space-y-1.5">
          <Label>Quantity in stock</Label>
          <Input type="number" value={data.quantity} onChange={(e) => set("quantity", Number(e.target.value))} data-testid="item-qty-input" />
        </div>
        <div className="space-y-1.5">
          <Label>Reorder point</Label>
          <Input type="number" value={data.reorder_point} onChange={(e) => set("reorder_point", Number(e.target.value))} data-testid="item-reorder-input" />
        </div>
        <div className="space-y-1.5">
          <Label>Supplier</Label>
          <Select value={data.supplier_id || "none"} onValueChange={(v) => set("supplier_id", v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Location / Bin</Label>
          <Input value={data.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Rack A-2" />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Compatible vehicles</Label>
          <Input value={data.compatible_vehicles} onChange={(e) => set("compatible_vehicles", e.target.value)} placeholder="VW Golf 2015+, BMW 3-series..." />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Description</Label>
          <Textarea rows={2} value={data.description} onChange={(e) => set("description", e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" data-testid="item-save-button" className="bg-primary hover:bg-primary/90 rounded-full">Save part</Button>
      </DialogFooter>
    </form>
  );
}

function printBarcode(item) {
  const w = window.open("", "_blank", "width=420,height=280");
  const svg = document.getElementById(`barcode-svg-${item.id}`)?.outerHTML || "";
  w.document.write(`<html><head><title>${item.sku}</title>
    <style>body{font-family:sans-serif;text-align:center;padding:16px}h3{margin:6px 0;font-size:14px}p{margin:2px 0;font-size:12px;color:#333}</style>
    </head><body>
    <h3>${item.name}</h3>
    <p>${item.sku} · €${Number(item.selling_price).toFixed(2)}</p>
    ${svg}
    <p>${item.barcode}</p>
    </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 250);
}

export default function Inventory() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [q, setQ] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [labelItem, setLabelItem] = useState(null);
  const [importing, setImporting] = useState(false);

  const { data: items = [] } = useQuery({ queryKey: ["inv"], queryFn: () => api.get("/inventory").then((r) => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ["sup"], queryFn: () => api.get("/suppliers").then((r) => r.data) });

  const filtered = items.filter((i) => {
    const s = q.toLowerCase();
    const match = !s || i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s) || (i.barcode || "").includes(s);
    const c = cat === "all" || i.category === cat;
    const v = !vehicle || (i.compatible_vehicles || "").toLowerCase().includes(vehicle.toLowerCase());
    return match && c && v;
  });

  const invalidate = () => qc.invalidateQueries();

  const save = async (data) => {
    try {
      if (editing) {
        await api.put(`/inventory/${editing.id}`, data);
        toast.success("Part updated");
        setOpen(false); setEditing(null); invalidate();
      } else {
        const { data: created } = await api.post("/inventory", data);
        toast.success("Part added — printing barcode label");
        setOpen(false); setEditing(null); invalidate();
        // Auto-open barcode dialog so owner can print label immediately
        setLabelItem(created);
      }
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this part?")) return;
    try { await api.delete(`/inventory/${id}`); toast.success("Deleted"); invalidate(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/inventory/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported: ${data.created} new, ${data.updated} updated${data.errors?.length ? ` · ${data.errors.length} errors` : ""}`);
      if (data.errors?.length) console.warn("CSV errors:", data.errors);
      invalidate();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setImporting(false); }
  };

  const downloadTemplate = () => {
    const csv = "name,sku,barcode,category,description,cost_price,selling_price,quantity,reorder_point,unit,location,compatible_vehicles\nOil Filter Bosch,,,Filters,Standard oil filter,5.50,12.00,40,10,pcs,Rack A-2,VW Golf 2015+; Audi A3\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "inventory-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8" data-testid="inventory-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary mb-2">Parts catalogue</div>
          <h1 className="font-display text-4xl font-black tracking-tight">Inventory</h1>
          <p className="text-muted-foreground mt-2">{items.length} unique parts on the shelves</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <div className="flex gap-2">
            {isOwner && (
              <>
                <Button variant="outline" className="rounded-full" onClick={downloadTemplate} data-testid="template-button">
                  <Download className="h-4 w-4 mr-2" /> Template
                </Button>
                <label>
                  <input type="file" accept=".csv" className="hidden" onChange={importCsv} data-testid="import-csv-input" />
                  <Button asChild variant="outline" className="rounded-full" disabled={importing} data-testid="import-csv-button">
                    <span className="cursor-pointer"><Upload className="h-4 w-4 mr-2" /> {importing ? "Importing..." : "Import CSV"}</span>
                  </Button>
                </label>
              </>
            )}
            <DialogTrigger asChild>
              <Button className="rounded-full bg-primary hover:bg-primary/90" data-testid="add-item-button">
                <Plus className="h-4 w-4 mr-2" /> New part
              </Button>
            </DialogTrigger>
          </div>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display">{editing ? "Edit part" : "New part"}</DialogTitle></DialogHeader>
            <ItemForm initial={editing} suppliers={suppliers} onSubmit={save} onCancel={() => { setOpen(false); setEditing(null); }} />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-border">
        <div className="p-4 flex flex-wrap gap-3 items-center border-b border-border">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, SKU, barcode..." className="pl-9" data-testid="inventory-search" />
          </div>
          <div className="relative w-64">
            <Car className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder='Vehicle e.g. "VW Golf 2018"' className="pl-9" data-testid="inventory-vehicle-filter" />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-48" data-testid="inventory-filter-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Part</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => {
                const low = i.quantity <= i.reorder_point;
                return (
                  <TableRow key={i.id} data-testid={`inventory-row-${i.sku}`}>
                    <TableCell>
                      <div className="font-medium">{i.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{i.barcode}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{i.sku}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{i.category}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatEUR(i.cost_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEUR(i.selling_price)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`tabular-nums ${low ? "text-amber-400 font-semibold" : ""}`}>{i.quantity}</span>
                      {low && <div className="text-[10px] text-amber-400 font-mono">below {i.reorder_point}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-mono">{formatEUR(i.cost_price * i.quantity)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setLabelItem(i)} data-testid={`print-${i.sku}`}><Printer className="h-4 w-4" /></Button>
                        {isOwner && <Button size="icon" variant="ghost" onClick={() => { setEditing(i); setOpen(true); }} data-testid={`edit-${i.sku}`}><Pencil className="h-4 w-4" /></Button>}
                        {isOwner && <Button size="icon" variant="ghost" onClick={() => del(i.id)} data-testid={`delete-${i.sku}`}><Trash2 className="h-4 w-4 text-rose-400" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                  <div className="space-y-2">
                    <div>No parts yet. Add your first part.</div>
                  </div>
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Barcode label modal */}
      <Dialog open={!!labelItem} onOpenChange={(o) => !o && setLabelItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">Barcode label</DialogTitle></DialogHeader>
          {labelItem && (
            <div className="p-4 border border-border rounded-md bg-white text-black text-center space-y-1">
              <div className="text-sm font-semibold">{labelItem.name}</div>
              <div className="text-xs">{labelItem.sku} · {formatEUR(labelItem.selling_price)}</div>
              <div className="flex justify-center">
                <Barcode id={`barcode-svg-${labelItem.id}`} value={labelItem.barcode} height={60} fontSize={12} margin={4} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLabelItem(null)}>Close</Button>
            <Button className="rounded-full" onClick={() => printBarcode(labelItem)}>
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
