import { createFileRoute, useNavigate, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { Loader2, Crown, ShieldCheck } from "lucide-react";

type Search = { invite?: string; redirect?: string };

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): Search => ({
    invite: typeof s.invite === "string" ? s.invite : undefined,
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});



function AuthPage() {
  const navigate = useNavigate();
  const { invite, redirect } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(invite ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteToken, setInviteToken] = useState(invite ?? "");
  const [loading, setLoading] = useState(false);
  const redirectTo = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/dashboard";

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") navigate({ to: redirectTo as never });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, redirectTo]);

  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      toast.error(result.error.message ?? "Falha no login com Google");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      toast.error("Sessão não foi confirmada. Tente entrar novamente.");
      setLoading(false);
      return;
    }
    navigate({ to: redirectTo as never });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        if (!inviteToken.trim()) {
          throw new Error("É necessário um token de convite válido para se cadastrar.");
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name,
              invite_token: inviteToken.trim() || null,
            },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Conta criada. Verifique seu e-mail para confirmar e depois entre.");
        setMode("signin");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (/invalid login credentials/i.test(error.message)) throw new Error("E-mail ou senha incorretos.");
          throw error;
        }
        if (!data.session) throw new Error("Sessão não foi criada. Tente entrar novamente.");
        navigate({ to: redirectTo as never });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na autenticação");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-50" style={{ background: "radial-gradient(60% 60% at 50% 0%, oklch(0.80 0.14 85 / 0.18), transparent 60%), radial-gradient(50% 50% at 100% 100%, oklch(0.72 0.12 75 / 0.15), transparent 60%)" }} />
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2.5">
          <div className="h-10 w-10 rounded-lg ig-gradient flex items-center justify-center">
            <Crown className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-2xl font-bold gold-text tracking-wider">ELITE</span>
        </Link>
        <div className="card-elevated p-7">
          <h1 className="font-display text-2xl font-semibold">
            {mode === "signin" ? "Bem-vindo de volta" : "Ativar convite"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Acesse seu painel privado ELITE."
              : "Sistema privado. Utilize seu token de convite para criar sua conta."}
          </p>

          {mode === "signin" && (
            <>
              <button
                onClick={handleGoogle}
                disabled={loading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Continuar com Google
              </button>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> ou <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    <ShieldCheck className="inline h-3 w-3 mr-1 text-primary" /> Token de convite
                  </label>
                  <input
                    value={inviteToken}
                    onChange={(e) => setInviteToken(e.target.value)}
                    placeholder="Cole aqui o token recebido"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    O acesso ao ELITE é exclusivamente por convite.
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome completo</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} required
                    className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Senha</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <button type="submit" disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg ig-gradient px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.01] disabled:opacity-70">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-5 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "signin"
              ? "Recebeu um convite? Ativar cadastro"
              : "Já tem conta? Entrar"}
          </button>
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Sistema privado ELITE · Acesso monitorado
        </p>
      </div>
    </div>
  );
}
