import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Wrench, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { formatApiError } from "@/lib/api";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@garage.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      nav("/");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Left: image panel */}
      <div className="relative hidden lg:block overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1486006920555-c77dcf18193c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTZ8MHwxfHNlYXJjaHw0fHxjYXIlMjBnYXJhZ2UlMjB3b3Jrc2hvcCUyMGludGVyaW9yfGVufDB8fHx8MTc4NzIxNTA2N3ww&ixlib=rb-4.1.0&q=85"
          alt="Garage"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-background via-background/70 to-transparent" />
        <div className="absolute bottom-12 left-12 right-12 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-mono uppercase tracking-widest">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> Operational
          </div>
          <h1 className="font-display text-5xl xl:text-6xl font-black leading-[0.95]">
            Garage Ops <br /><span className="text-primary">Command Deck</span>
          </h1>
          <p className="text-muted-foreground max-w-md">
            Track every part, every euro, every movement. Purpose-built for busy workshops.
          </p>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-8 lg:p-16">
        <div className="w-full max-w-md space-y-10">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-primary/15 border border-primary/40 flex items-center justify-center">
              <Wrench className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-display text-lg font-bold tracking-tight">PitStock</div>
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Inventory OS</div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="font-display text-3xl font-bold">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Access your workshop's live inventory grid.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-6" data-testid="login-form">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-widest font-mono text-muted-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="login-email-input"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-widest font-mono text-muted-foreground">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="login-password-input"
                className="h-11"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              data-testid="login-submit-button"
              className="w-full h-11 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium group"
            >
              {loading ? "Signing in..." : (
                <span className="inline-flex items-center gap-2">
                  Enter workshop
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform duration-200" />
                </span>
              )}
            </Button>
          </form>

          <Card className="p-4 bg-muted/40 border-dashed">
            <p className="text-xs font-mono text-muted-foreground">
              <span className="text-primary">DEMO</span> · admin@garage.com / admin123
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
