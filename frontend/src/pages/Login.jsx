import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wrench, ArrowRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatApiError } from "@/lib/api";

export default function Login() {
  const { login } = useAuth();
  const { t } = useLang();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success(t("welcomeBack"));
      nav("/dashboard");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden flex items-center justify-center px-4">
      {/* Ambient decoration — subtle glows + grid, matches the landing page */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }} />
      </div>

      <div className="absolute top-6 end-6 rtl:right-auto rtl:left-6">
        <LanguageSwitcher />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="h-12 w-12 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center backdrop-blur">
            <Wrench className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="font-display text-2xl font-bold tracking-tight">GarageFix</div>
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Workshop OS</div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-800/70 bg-slate-900/60 backdrop-blur-xl p-8 md:p-10 shadow-2xl">
          <div className="mb-8">
            <h2 className="font-display text-3xl font-bold tracking-tight">{t("signIn")}</h2>
            <p className="text-sm text-slate-400 mt-2">{t("accessSubtitle")}</p>
          </div>

          <form onSubmit={submit} className="space-y-5" data-testid="login-form">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[10px] uppercase tracking-widest font-mono text-slate-500">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@garage.nl"
                data-testid="login-email-input"
                className="h-11 bg-slate-950/40 border-slate-800 text-slate-100 placeholder:text-slate-600 focus-visible:ring-primary/40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-[10px] uppercase tracking-widest font-mono text-slate-500">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                data-testid="login-password-input"
                className="h-11 bg-slate-950/40 border-slate-800 text-slate-100 placeholder:text-slate-600 focus-visible:ring-primary/40"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              data-testid="login-submit-button"
              className="w-full h-11 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold group shadow-lg shadow-primary/25"
            >
              {loading ? "..." : (
                <span className="inline-flex items-center gap-2">
                  {t("enterWorkshop")}
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 rtl:rotate-180 transition-transform duration-200" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-800/60 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/70" />
            <span>Beveiligd met JWT · Multi-tenant isolatie</span>
          </div>
        </div>

        {/* Footer link back to landing */}
        <div className="mt-6 text-center">
          <a href="/" className="text-xs text-slate-500 hover:text-slate-300 transition-colors" data-testid="login-back-link">
            ← Terug naar startpagina
          </a>
        </div>
      </div>
    </div>
  );
}
