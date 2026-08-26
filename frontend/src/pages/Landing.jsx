import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Wrench, ShieldCheck, Zap, LineChart, LogIn, LayoutDashboard } from "lucide-react";

/**
 * Public landing page.  Kept intentionally minimal so we have room to add
 * marketing sections (pricing, testimonials, screenshots …) later.
 *
 * The Login CTA is discreet — a small pill button in the top-right corner
 * plus a matching link in the footer, so visitors focused on browsing the
 * marketing content aren't shouted at while still finding their way in.
 *
 * All copy is translated — Dutch is the default because our audience is
 * NL workshops.  The `<LanguageSwitcher>` next to the sign-in button lets
 * a visitor flip to English / Arabic on the fly.
 */
export default function Landing() {
  const { user, ready } = useAuth();
  const { t, meta } = useLang();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden" dir={meta.dir}>
      {/* Ambient decoration */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute top-1/3 -left-40 h-[420px] w-[420px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }} />
      </div>

      {/* Top nav — brand + language + discreet sign-in */}
      <nav className="relative z-10 flex items-center justify-between px-6 lg:px-10 py-5">
        <Link to="/" className="flex items-center gap-3" data-testid="landing-brand">
          <div className="h-10 w-10 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center">
            <Wrench className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="font-display text-lg font-bold tracking-tight">GarageFix</div>
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Workshop OS</div>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {ready && user ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors px-4 py-2 rounded-full border border-slate-700 hover:border-primary/60"
              data-testid="landing-dashboard-link"
            >
              <LayoutDashboard className="h-4 w-4" /> {t("landingOpenDashboard")}
            </Link>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors px-4 py-2 rounded-full border border-slate-700 hover:border-primary/60"
              data-testid="landing-signin-link"
            >
              <LogIn className="h-4 w-4" /> {t("landingSignIn")}
            </Link>
          )}
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 px-6 lg:px-10 pt-16 lg:pt-24 pb-24">
        <div className="max-w-5xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono uppercase tracking-widest">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t("landingBadge")}
          </div>

          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-black leading-[0.95] tracking-tight">
            {t("landingHeroLine1")}<br />
            {t("landingHeroLine2")}<br />
            <span className="bg-gradient-to-r from-primary via-sky-400 to-emerald-400 bg-clip-text text-transparent">
              {t("landingHeroLine3")}
            </span>
          </h1>

          <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            {t("landingSubtitle")}
          </p>
        </div>

        <div className="max-w-5xl mx-auto mt-24 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Feature icon={LineChart} title={t("landingF1Title")} body={t("landingF1Body")} />
          <Feature icon={Zap}       title={t("landingF2Title")} body={t("landingF2Body")} />
          <Feature icon={ShieldCheck} title={t("landingF3Title")} body={t("landingF3Body")} />
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-800/70 px-6 lg:px-10 py-8 text-xs text-slate-500 flex items-center justify-between flex-wrap gap-2">
        <div>© {new Date().getFullYear()} GarageFix — Workshop OS.</div>
        <div className="flex items-center gap-4">
          <Link to="/login" className="hover:text-slate-300 transition-colors" data-testid="footer-signin-link">{t("landingSignIn")}</Link>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, body }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur p-6 hover:border-primary/40 transition-colors">
      <div className="h-10 w-10 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center mb-4">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="font-display font-bold text-lg mb-1">{title}</div>
      <div className="text-sm text-slate-400 leading-relaxed">{body}</div>
    </div>
  );
}
