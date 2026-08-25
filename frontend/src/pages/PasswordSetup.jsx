import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, CheckCircle2, AlertTriangle } from "lucide-react";

/* Public page — no auth required.
   Staff click the link in the "welcome" email and land here. */
export default function PasswordSetup() {
  const { token } = useParams();
  const nav = useNavigate();
  const base = process.env.REACT_APP_BACKEND_URL;
  const [state, setState] = useState({ loading: true, error: "", email: "", name: "" });
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancel = false;
    axios.get(`${base}/api/auth/password-setup/${token}`)
      .then(r => { if (!cancel) setState({ loading: false, error: "", email: r.data.email, name: r.data.name }); })
      .catch(e => { if (!cancel) setState({ loading: false, error: e?.response?.data?.detail || "Link ongeldig", email: "", name: "" }); });
    return () => { cancel = true; };
  }, [base, token]);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 6) return toast.error("Min. 6 tekens");
    if (pw !== pw2) return toast.error("Wachtwoorden komen niet overeen");
    setBusy(true);
    try {
      await axios.post(`${base}/api/auth/password-setup/${token}`, { password: pw });
      setDone(true);
      toast.success("Wachtwoord ingesteld — je kunt nu inloggen");
      setTimeout(() => nav("/login"), 2000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kon wachtwoord niet opslaan");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-background via-background to-primary/5 p-6">
      <Card className="w-full max-w-md p-8 border-border shadow-xl" data-testid="password-setup-page">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">Welkom</div>
            <h1 className="font-display text-xl font-bold leading-tight">Stel je wachtwoord in</h1>
          </div>
        </div>

        {state.loading && (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" />Link controleren…</div>
        )}
        {!state.loading && state.error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="text-sm text-rose-800 dark:text-rose-300">
              <div className="font-semibold mb-1">{state.error}</div>
              <div className="text-xs">Vraag je manager om een nieuwe uitnodiging te sturen.</div>
            </div>
          </div>
        )}
        {!state.loading && !state.error && !done && (
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Account</div>
              <div className="font-semibold">{state.name}</div>
              <div className="text-xs text-muted-foreground font-mono">{state.email}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Nieuw wachtwoord</Label>
              <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} required data-testid="setup-pw-input" />
              <p className="text-[11px] text-muted-foreground">Min. 6 tekens.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2">Bevestig wachtwoord</Label>
              <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={6} required data-testid="setup-pw-confirm" />
            </div>
            <Button type="submit" disabled={busy} className="w-full rounded-full bg-primary hover:bg-primary/90 h-11" data-testid="setup-pw-submit">
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Lock className="h-4 w-4 mr-2" />}
              {busy ? "Opslaan…" : "Wachtwoord opslaan"}
            </Button>
          </form>
        )}
        {done && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="text-sm text-emerald-800 dark:text-emerald-300">
              <div className="font-semibold">Klaar!</div>
              <div className="text-xs">Je wordt over 2 seconden doorgestuurd naar de login-pagina.</div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
