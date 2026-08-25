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
    if (user.role === "owner" || user.role === "super_admin") return true;
    return (user.permissions || []).includes(perm);
  };

  return (
    <AuthCtx.Provider value={{ user, ready, login, register, logout, hasPermission, setUser: updateUser }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
