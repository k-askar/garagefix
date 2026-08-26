import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

/**
 * Route wrapper that redirects the user away from a page they don't have
 * permission for. If they lack the required permission, they are bounced to
 * the first section they CAN see (so a warehouse-only staff who types /repairs
 * lands back on /inventory instead of a 404 or empty page).
 */
export default function PermGate({ perm, children }) {
  const { user, ready, hasPermission, firstAllowedPath } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!perm) return children;
  if (hasPermission(perm)) return children;
  return <Navigate to={firstAllowedPath()} replace />;
}
