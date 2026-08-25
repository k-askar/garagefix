import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Package, ArrowLeftRight, ScrollText, Truck, Users, BarChart3, LogOut, Wrench, Menu, X, UserCog, Settings as SettingsIcon, ClipboardList, Receipt, ShoppingCart, Bell, Wallet, ScanLine, Banknote, Calendar, LayoutGrid, Monitor, PackageOpen, Building2 } from "lucide-react";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", key: "dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { to: "/calendar", key: "calendar", icon: Calendar, testId: "nav-calendar" },
  { to: "/workboard", key: "workboard", icon: LayoutGrid, testId: "nav-workboard" },
  { to: "/bay-board", key: "bayBoard", icon: Monitor, testId: "nav-bayboard" },
  { to: "/delivery-scan", key: "deliveryScan", icon: PackageOpen, testId: "nav-delivery-scan" },
  { to: "/repairs", key: "jobCards", icon: ClipboardList, testId: "nav-repairs" },
  { to: "/inventory", key: "inventory", icon: Package, testId: "nav-inventory" },
  { to: "/invoices", key: "invoices", icon: Receipt, testId: "nav-invoices" },
  { to: "/cash-register", key: "cashRegister", icon: Wallet, testId: "nav-till" },
  { to: "/accounts", key: "accounts", icon: Banknote, testId: "nav-accounts" },
  { to: "/reminders", key: "reminders", icon: Bell, testId: "nav-reminders" },
  { to: "/suppliers", key: "suppliers", icon: Truck, testId: "nav-suppliers" },
  { to: "/customers", key: "customers", icon: Users, testId: "nav-customers" },
  { to: "/reports", key: "reports", icon: BarChart3, testId: "nav-reports" },
];

const OWNER_NAV = [
  { to: "/purchase-orders", key: "purchaseOrders", icon: ShoppingCart, testId: "nav-po" },
  { to: "/staff", key: "staff", icon: UserCog, testId: "nav-staff" },
  { to: "/settings", key: "settings", icon: SettingsIcon, testId: "nav-settings" },
];

export default function DashboardLayout({ children }) {
  const { user, logout } = useAuth();
  const { t, meta } = useLang();
  const [open, setOpen] = useState(false);
  const isRTL = meta.dir === "rtl";

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 z-40 w-64 border-border bg-card flex flex-col transition-transform duration-200",
        isRTL ? "right-0 border-l" : "left-0 border-r",
        open ? "translate-x-0" : (isRTL ? "translate-x-full lg:translate-x-0" : "-translate-x-full lg:translate-x-0")
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
              <span>{t(n.key)}</span>
            </NavLink>
          ))}
          {user?.role === "owner" && (
            <>
              <div className="pt-3 pb-1 px-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">{t("owner")}</div>
              {OWNER_NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
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
                  <span>{t(n.key)}</span>
                </NavLink>
              ))}
            </>
          )}
          {user?.role === "super_admin" && (
            <>
              <div className="pt-3 pb-1 px-3 text-[10px] font-mono uppercase tracking-widest text-primary/80">Platform</div>
              <NavLink
                to="/super-admin"
                data-testid="nav-super-admin"
                onClick={() => setOpen(false)}
                className={({ isActive }) => cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors duration-200",
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent"
                )}
              >
                <Building2 className="h-4 w-4" />
                <span>Garages</span>
              </NavLink>
            </>
          )}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="px-3 py-2 mb-2">
            <div className="text-sm font-medium truncate">{user?.name}</div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{user?.role}</div>
          </div>
          <NavLink
            to="/my-profile"
            data-testid="nav-my-profile"
            onClick={() => setOpen(false)}
            className={({ isActive }) => cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
              isActive
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <UserCog className="h-4 w-4" /> {t("myProfile")}
          </NavLink>
          <ChangePasswordDialog triggerLabel={t("changePassword")} />
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={logout}
            data-testid="logout-button"
          >
            <LogOut className="h-4 w-4" /> {t("signOut")}
          </Button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <ImpersonationBanner />
        <header className="h-16 border-b border-border bg-card/60 backdrop-blur-sm flex items-center justify-between px-6 lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(!open)} data-testid="sidebar-toggle">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-widest">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{t("live")}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs font-mono text-muted-foreground hidden sm:block">
              {new Date().toLocaleDateString(meta.locale, { day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <ThemeToggle />
            <LanguageSwitcher />
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
