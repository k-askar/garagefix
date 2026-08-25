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
  if (!user) return <Navigate to="/login" replace />;
  return <DashboardLayout><Outlet /></DashboardLayout>;
}

function OwnerRoute({ children }) {
  const { user } = useAuth();
  if (user && user.role !== "owner" && user.role !== "super_admin") return <Navigate to="/" replace />;
  return children;
}

function SuperAdminRoute({ children }) {
  const { user } = useAuth();
  if (user && user.role !== "super_admin") return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <ThemeProvider>
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/passport/:token" element={<CarPassport />} />
            <Route path="/setup-password/:token" element={<PasswordSetup />} />
            <Route element={<ProtectedShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/movement" element={<StockMovement />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/suppliers" element={<Suppliers />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/repairs" element={<Repairs />} />
              <Route path="/scan" element={<ScanPickup />} />
              <Route path="/reminders" element={<Reminders />} />
              <Route path="/cash-register" element={<CashRegister />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/workboard" element={<Workboard />} />
              <Route path="/bay-board" element={<BayBoard />} />
              <Route path="/delivery-scan" element={<DeliveryScan />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/purchase-orders" element={<OwnerRoute><PurchaseOrders /></OwnerRoute>} />
              <Route path="/staff" element={<OwnerRoute><Staff /></OwnerRoute>} />
              <Route path="/settings" element={<OwnerRoute><Settings /></OwnerRoute>} />
              <Route path="/super-admin" element={<SuperAdminRoute><SuperAdmin /></SuperAdminRoute>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
