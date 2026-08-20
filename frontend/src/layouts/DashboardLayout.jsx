import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Package, ArrowLeftRight, ScrollText, Truck, Users, BarChart3, LogOut, Wrench, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { to: "/inventory", label: "Inventory", icon: Package, testId: "nav-inventory" },
  { to: "/movement", label: "Stock In / Out", icon: ArrowLeftRight, testId: "nav-movement" },
  { to: "/transactions", label: "Transactions", icon: ScrollText, testId: "nav-transactions" },
  { to: "/suppliers", label: "Suppliers", icon: Truck, testId: "nav-suppliers" },
  { to: "/customers", label: "Customers", icon: Users, testId: "nav-customers" },
  { to: "/reports", label: "Reports", icon: BarChart3, testId: "nav-reports" },
];

export default function DashboardLayout({ children }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-40 w-64 border-r border-border bg-card flex flex-col transition-transform duration-200",
        open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="h-16 px-6 flex items-center gap-3 border-b border-border">
          <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/40 flex items-center justify-center">
            <Wrench className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="font-display font-bold tracking-tight">PitStock</div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Inventory OS</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              data-testid={n.testId}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors duration-200",
                isActive
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent"
              )}
            >
              <n.icon className="h-4 w-4" />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="px-3 py-2 mb-2">
            <div className="text-sm font-medium truncate">{user?.name}</div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{user?.role}</div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={logout}
            data-testid="logout-button"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b border-border bg-card/60 backdrop-blur-sm flex items-center justify-between px-6 lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(!open)} data-testid="sidebar-toggle">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-widest">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live</span>
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
        </header>
        <main className="flex-1 grid-bg">
          <div className="p-6 lg:p-10 max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
