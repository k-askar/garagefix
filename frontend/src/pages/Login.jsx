import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/i18n";
import { useTheme } from "@/context/ThemeContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Wrench, ArrowRight, ShieldCheck, Eye, EyeOff, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

export default function Login() {
  const { login, pathForUser } = useAuth();
  const { t } = useLang();
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const u = await login(email, password);
      toast.success(t("welcomeBack"));
      nav(pathForUser(u));
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setForgotBusy(true);
    try {
      await api.post("/auth/forgot-password", { email: forgotEmail.trim().toLowerCase() });
      toast.success(t("forgotSent"));
      setForgotOpen(false);
      setForgotEmail("");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex bg-background text-foreground">
      {/* ── Ambient background (dark = neon grid + orbs, light = soft mesh) ── */}
      <div className="pointer-events-none absolute inset-0">
        <div className={`absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full blur-3xl ${isDark ? "bg-primary/25" : "bg-primary/10"}`} />
        <div className={`absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full blur-3xl ${isDark ? "bg-emerald-500/15" : "bg-emerald-400/15"}`} />
        <div className="absolute inset-0 opacity-[0.045]" style={{
          backgroundImage: isDark
            ? "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)"
            : "linear-gradient(rgba(0,0,0,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }} />
      </div>

      {/* ── Header controls (theme + language) ── */}
      <div className="absolute top-5 end-5 rtl:right-auto rtl:left-5 z-20 flex items-center gap-1 rounded-full border border-border/60 bg-background/70 backdrop-blur-md px-1 py-1 shadow-sm">
        <ThemeToggle />
        <div className="h-4 w-px bg-border/80" />
        <LanguageSwitcher />
      </div>

      {/* ── Left hero (hidden on mobile) ── */}
      <div className="hidden lg:flex relative z-10 flex-1 flex-col justify-between p-16">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center backdrop-blur">
            <Wrench className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-display text-xl font-bold tracking-tight">GarageFix</div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Workshop OS</div>
          </div>
        </div>

        <div className="max-w-lg">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary bg-primary/10 border border-primary/25 rounded-full px-3 py-1 mb-6">
            <Sparkles className="h-3 w-3" /> Werkplaats · Facturen · APK · Kassa
          </div>
          <h1 className="font-display text-5xl xl:text-6xl font-black tracking-tight leading-[1.05]">
            Alles wat je{" "}
            <span className="relative">
              <span className="relative z-10 text-primary">garage</span>
              <span className={`absolute inset-x-0 bottom-1 h-3 -z-0 ${isDark ? "bg-primary/25" : "bg-primary/20"} rounded-sm`} />
            </span>{" "}
            elke dag doet, in één plek.
          </h1>
          <p className="text-lg text-muted-foreground mt-6 leading-relaxed">
            Van kenteken-scan tot iDEAL-QR op de factuur. Elke schroef, elke euro, in één workflow — Nederlands, veilig, snel.
          </p>

          <div className="grid grid-cols-3 gap-4 mt-10">
            {[
              { label: "APK-herinneringen", value: "Auto" },
              { label: "iDEAL & Card", value: "Live" },
              { label: "RDW-lookup", value: "1-tik" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-border/60 bg-card/50 backdrop-blur px-4 py-3">
                <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{k.label}</div>
                <div className="font-display text-lg font-bold mt-0.5">{k.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> AVG-safe · Elke garage volledig geïsoleerd
        </div>
      </div>

      {/* ── Sign-in panel ── */}
      <div className="relative z-10 w-full lg:w-[520px] flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile-only brand */}
          <div className="lg:hidden flex items-center justify-center gap-3 mb-10">
            <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center backdrop-blur">
              <Wrench className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-display text-xl font-bold tracking-tight">GarageFix</div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Workshop OS</div>
            </div>
          </div>

          <div className="relative rounded-2xl border border-border/70 bg-card/70 backdrop-blur-xl p-8 md:p-10 shadow-2xl">
            {/* subtle top rule */}
            <div className="absolute -top-px left-6 right-6 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

            <div className="mb-8">
              <div className="text-[10px] font-mono uppercase tracking-widest text-primary mb-2">Sign in</div>
              <h2 className="font-display text-3xl font-bold tracking-tight">{t("signIn")}</h2>
              <p className="text-sm text-muted-foreground mt-2">{t("accessSubtitle")}</p>
            </div>

            <form onSubmit={submit} className="space-y-5" data-testid="login-form">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground flex items-center gap-1.5">
                  <Mail className="h-3 w-3" /> {t("email")}
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@garage.nl"
                  data-testid="login-email-input"
                  className="h-11 bg-background/50 border-border focus-visible:ring-primary/40"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{t("password")}</Label>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="text-[11px] text-primary hover:text-primary/80 transition-colors"
                    data-testid="login-forgot-link"
                  >
                    {t("forgotPassword")}
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    data-testid="login-password-input"
                    className="h-11 bg-background/50 border-border focus-visible:ring-primary/40 pe-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? t("hidePassword") : t("showPassword")}
                    className="absolute inset-y-0 end-0 rtl:end-auto rtl:start-0 px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="login-password-toggle"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
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

            <div className="mt-8 pt-6 border-t border-border/60 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              <span>{t("secureNote")}</span>
            </div>
          </div>

          <div className="mt-6 text-center">
            <a href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="login-back-link">
              ← {t("backToHome")}
            </a>
          </div>
        </div>
      </div>

      {/* Forgot-password dialog */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="max-w-md" data-testid="forgot-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" /> {t("forgotDialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("forgotDialogDesc")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForgot} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">{t("email")}</Label>
              <Input
                id="forgot-email"
                type="email"
                required
                autoFocus
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@garage.nl"
                data-testid="forgot-email-input"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setForgotOpen(false)} disabled={forgotBusy}>
                {t("cancel")}
              </Button>
              <Button type="submit" className="rounded-full bg-primary" disabled={forgotBusy} data-testid="forgot-submit">
                {forgotBusy ? "..." : t("sendResetLink")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
