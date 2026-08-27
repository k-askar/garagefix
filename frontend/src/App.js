import React from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { LanguageProvider } from "@/i18n";
import { ThemeProvider } from "@/context/ThemeContext";
import Login from "@/pages/Login";
import DashboardLayout from "@/layouts/DashboardLayout";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import StockMovement from "@/pages/StockMovement";
import Suppliers from "@/pages/Suppliers";
import Customers from "@/pages/Customers";
import Vehicles from "@/pages/Vehicles";
import Transactions from "@/pages/Transactions";
import Reports from "@/pages/Reports";
import Staff from "@/pages/Staff";
import Settings from "@/pages/Settings";
import PurchaseOrders from "@/pages/PurchaseOrders";
import Invoices from "@/pages/Invoices";
import Repairs from "@/pages/Repairs";
import CashRegister from "@/pages/CashRegister";
import Reminders from "@/pages/Reminders";
import ScanPickup from "@/pages/ScanPickup";
import Accounts from "@/pages/Accounts";
import CalendarPage from "@/pages/Calendar";
import Workboard from "@/pages/Workboard";
import CarPassport from "@/pages/CarPassport";
import BayBoard from "@/pages/BayBoard";
import DeliveryScan from "@/pages/DeliveryScan";
import PasswordSetup from "@/pages/PasswordSetup";
import SuperAdmin from "@/pages/SuperAdmin";
import MyProfile from "@/pages/MyProfile";
import EmailLogs from "@/pages/EmailLogs";
import PayInvoice from "@/pages/PayInvoice";
import Landing from "@/pages/Landing";
import PermGate from "@/components/PermGate";
import "@/App.css";

function ProtectedShell() {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground font-mono text-sm">Loading garage...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  return <DashboardLayout><Outlet /></DashboardLayout>;
}

function OwnerRoute({ children }) {
  const { user, firstAllowedPath } = useAuth();
  if (!user) return null;
  // Super-admins can only reach owner-only pages while impersonating a
  // tenant.  Outside impersonation they get bounced to /super-admin so
  // they can't accidentally write to /staff or /settings globally.
  if (user.role === "super_admin" && !user.impersonating) {
    return <Navigate to="/super-admin" replace />;
  }
  if (user.role !== "owner" && user.role !== "super_admin") {
    return <Navigate to={firstAllowedPath()} replace />;
  }
  return children;
}

function SuperAdminRoute({ children }) {
  const { user, firstAllowedPath } = useAuth();
  if (user && user.role !== "super_admin") {
    return <Navigate to={firstAllowedPath()} replace />;
  }
  return children;
}

function LandingHome() {
  // Redirect an already-logged-in user straight into their first allowed page
  // instead of showing the public landing every time they hit "/".  Waiting
  // for `ready` avoids the "flash of landing page" during impersonation swap.
  const { user, ready, firstAllowedPath } = useAuth();
  if (!ready) return null;
  if (user) return <Navigate to={firstAllowedPath()} replace />;
  return <Landing />;
}

function DashboardFallback() {
  // Owner → real Dashboard.  Staff without reports.view → their first allowed section.
  // Super-admins land on /super-admin unless they are actively impersonating.
  const { user, ready, hasPermission, firstAllowedPath } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "super_admin" && !user.impersonating) {
    return <Navigate to="/super-admin" replace />;
  }
  if (user.role === "owner" || hasPermission("reports.view")) {
    return <Dashboard />;
  }
  return <Navigate to={firstAllowedPath()} replace />;
}

function App() {
  return (
    <ThemeProvider>
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingHome />} />
            <Route path="/login" element={<Login />} />
            <Route path="/passport/:token" element={<CarPassport />} />
            <Route path="/setup-password/:token" element={<PasswordSetup />} />
            <Route path="/pay/:token" element={<PayInvoice />} />
            <Route element={<ProtectedShell />}>
              <Route path="/dashboard" element={<DashboardFallback />} />
              <Route path="/inventory" element={<PermGate perm="inventory.view"><Inventory /></PermGate>} />
              <Route path="/movement" element={<PermGate perm="inventory.view"><StockMovement /></PermGate>} />
              <Route path="/transactions" element={<PermGate perm="inventory.view"><Transactions /></PermGate>} />
              <Route path="/suppliers" element={<PermGate perm="suppliers.view"><Suppliers /></PermGate>} />
              <Route path="/customers" element={<PermGate perm="customers.view"><Customers /></PermGate>} />
              <Route path="/vehicles" element={<PermGate perm="customers.view"><Vehicles /></PermGate>} />
              <Route path="/reports" element={<PermGate perm="reports.view"><Reports /></PermGate>} />
              <Route path="/repairs" element={<PermGate perm="repairs.view"><Repairs /></PermGate>} />
              <Route path="/scan" element={<PermGate perm="delivery_scan.use"><ScanPickup /></PermGate>} />
              <Route path="/reminders" element={<Navigate to="/vehicles?tab=reminders" replace />} />
              <Route path="/cash-register" element={<PermGate perm="cash.view"><CashRegister /></PermGate>} />
              <Route path="/accounts" element={<PermGate perm="accounts.view"><Accounts /></PermGate>} />
              <Route path="/calendar" element={<PermGate perm="calendar.view"><CalendarPage /></PermGate>} />
              <Route path="/workboard" element={<PermGate perm="calendar.view"><Workboard /></PermGate>} />
              <Route path="/bay-board" element={<PermGate perm="calendar.view"><BayBoard /></PermGate>} />
              <Route path="/delivery-scan" element={<PermGate perm="delivery_scan.use"><DeliveryScan /></PermGate>} />
              <Route path="/invoices" element={<PermGate perm="invoices.view"><Invoices /></PermGate>} />
              <Route path="/purchase-orders" element={<OwnerRoute><PurchaseOrders /></OwnerRoute>} />
              <Route path="/staff" element={<OwnerRoute><Staff /></OwnerRoute>} />
              <Route path="/settings" element={<OwnerRoute><Settings /></OwnerRoute>} />
              <Route path="/super-admin" element={<SuperAdminRoute><SuperAdmin /></SuperAdminRoute>} />
              <Route path="/my-profile" element={<MyProfile />} />
              <Route path="/email-logs" element={<SuperAdminRoute><EmailLogs /></SuperAdminRoute>} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
