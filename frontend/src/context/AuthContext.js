import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null while loading, false when logged out
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("garage_token");
    if (!token) {
      setUser(false);
      setReady(true);
      return;
    }
    api.get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setUser(false))
      .finally(() => setReady(true));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("garage_token", data.token);
    localStorage.setItem("garage_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  // Expose setUser so pages like MyProfile can push the updated user object
  // back into context after editing their name / email.
  const updateUser = (u) => {
    if (!u) return;
    localStorage.setItem("garage_user", JSON.stringify(u));
    setUser(u);
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    localStorage.setItem("garage_token", data.token);
    localStorage.setItem("garage_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("garage_token");
    localStorage.removeItem("garage_user");
    setUser(false);
    window.location.href = "/login";
  };

  /**
   * Central permission check.  Owner bypasses everything, staff need the exact
   * `perm` string in their permissions list.  Used to hide UI (nav items,
   * buttons); the server always re-checks on sensitive endpoints.
   */
  const hasPermission = (perm) => {
    if (!user) return false;
    // Super-admins can only "see" tenant sections while they are actively
    // impersonating a garage.  Outside impersonation their world is limited
    // to the Super Admin dashboard so tenant data can never leak.
    if (user.role === "super_admin") return !!user.impersonating;
    if (user.role === "owner") return true;
    return (user.permissions || []).includes(perm);
  };

  /**
   * Map each nav route -> the minimal permission that unlocks it. Kept in sync
   * with backend PERMISSION_CATALOG and DashboardLayout NAV. Order defines the
   * fallback landing page when a staff member has NO permission for /dashboard.
   */
  const ROUTE_PERM = [
    ["/dashboard",      "reports.view"],
    ["/inventory",      "inventory.view"],
    ["/repairs",        "repairs.view"],
    ["/invoices",       "invoices.view"],
    ["/customers",      "customers.view"],
    ["/vehicles",       "customers.view"],
    ["/suppliers",      "suppliers.view"],
    ["/calendar",       "calendar.view"],
    ["/workboard",      "calendar.view"],
    ["/bay-board",      "calendar.view"],
    ["/cash-register",  "cash.view"],
    ["/accounts",       "accounts.view"],
    ["/reminders",      "reminders.view"],
    ["/delivery-scan",  "delivery_scan.use"],
    ["/reports",        "reports.view"],
  ];

  /** Compute the first allowed path for an arbitrary user (used right after
   *  login when React state hasn't propagated yet). */
  const pathForUser = (u) => {
    if (!u) return "/login";
    // Super-admins who are impersonating a tenant get dropped into the
    // garage's own dashboard so the workflow feels natural.  Otherwise
    // they're locked to the platform admin console.
    if (u.role === "super_admin") return u.impersonating ? "/dashboard" : "/super-admin";
    if (u.role === "owner") return "/dashboard";
    const perms = new Set(u.permissions || []);
    for (const [path, perm] of ROUTE_PERM) {
      if (perms.has(perm)) return path;
    }
    return "/my-profile";
  };

  /** First route the current user is allowed to see (or /my-profile fallback). */
  const firstAllowedPath = () => pathForUser(user);

  return (
    <AuthCtx.Provider value={{ user, ready, login, register, logout, hasPermission, firstAllowedPath, pathForUser, setUser: updateUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
