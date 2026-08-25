import React from "react";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogOut } from "lucide-react";
import { toast } from "sonner";

/**
 * Persistent banner shown whenever the current user is a super_admin who has
 * dropped into a specific tenant via the "Enter garage" action.  Sticky at
 * the top of the layout so the platform owner never forgets they are looking
 * at someone else's data and can bail out in one click.
 */
export default function ImpersonationBanner() {
  const { user, setUser } = useAuth();
  const imp = user?.impersonating;
  if (!imp) return null;

  const exit = async () => {
    try {
      const { data } = await api.post("/tenants/stop-impersonation");
      localStorage.setItem("garage_token", data.token);
      const me = await api.get("/auth/me");
      setUser?.(me.data);
      localStorage.setItem("garage_user", JSON.stringify(me.data));
      toast.success("Exited impersonation");
      window.location.href = "/super-admin";
    } catch (err) { toast.error(formatApiError(err)); }
  };

  return (
    <div
      className="sticky top-0 z-40 w-full bg-amber-500/15 border-b border-amber-500/40 backdrop-blur"
      data-testid="impersonation-banner"
    >
      <div className="max-w-full flex items-center gap-3 px-4 lg:px-8 py-2.5">
        <div className="h-7 w-7 rounded-full bg-amber-500/25 border border-amber-500/50 flex items-center justify-center shrink-0">
          <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0 text-sm">
          <span className="font-mono uppercase tracking-widest text-[10px] text-amber-700 dark:text-amber-400">
            Platform admin ·
          </span>
          <span className="text-foreground ml-2">
            You're viewing <strong>{imp.name}</strong>
            {imp.country && <span className="ml-1 font-mono text-xs text-muted-foreground">({imp.country})</span>}
            {" — all data below is theirs, not yours."}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="rounded-full border-amber-500/50 text-amber-800 dark:text-amber-300 hover:bg-amber-500/10 shrink-0"
          onClick={exit}
          data-testid="impersonation-exit"
        >
          <LogOut className="h-3 w-3 mr-1" /> Exit impersonation
        </Button>
      </div>
    </div>
  );
}
