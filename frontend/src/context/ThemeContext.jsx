import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const KEY = "garage_theme";
const ThemeCtx = createContext(null);

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyResolved(mode) {
  const resolved = mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => localStorage.getItem(KEY) || "system");
  const [resolved, setResolved] = useState(() => {
    const t = localStorage.getItem(KEY) || "system";
    return t === "system" ? (systemPrefersDark() ? "dark" : "light") : t;
  });

  useEffect(() => {
    setResolved(applyResolved(theme));
    localStorage.setItem(KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolved(applyResolved("system"));
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t), []);
  const cycle = useCallback(() => {
    setThemeState((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  }, []);

  return <ThemeCtx.Provider value={{ theme, resolved, setTheme, cycle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
