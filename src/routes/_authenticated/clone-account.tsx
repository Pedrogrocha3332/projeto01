import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Copy } from "lucide-react";
import { PageHeader, PageBody } from "@/components/app/page";
import { cloneMyAccount } from "@/lib/admin-clone.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/clone-account")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userData.user.id);
    if (!(roles ?? []).some((r) => r.role === "admin_principal")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ClonePage,
});

function ClonePage() {
  const [email, setEmail] = useState("matheus123@elite.local");
  const [password, setPassword] = useState("admin123");
  const [fullName, setFullName] = useState("Matheus 2");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | { email: string; counts: Record<string, number> }>(null);
  const clone = useServerFn(cloneMyAccount);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Isso vai criar a conta ${email} com senha "${password}" e copiar TODOS os seus dados. Confirmar?`)) return;
    setLoading(true);
    try {
      const res = await clone({ data: { email, password, fullName } });
      setResult({ email: res.email, counts: res.counts });
      toast.success("Conta clonada com sucesso!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao clonar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="Clonar minha conta" description="Cria um novo usuário admin_principal e copia todos os seus dados (contas IG, mídia, pools, posts, templates, credenciais Meta)." />
      <PageBody>
        <div className="max-w-xl card-elevated p-6 space-y-4">
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">E-mail de login</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email"
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Senha</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <button disabled={loading} type="submit"
              className="flex items-center justify-center gap-2 w-full rounded-lg ig-gradient px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg hover:scale-[1.01] disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              Criar conta e copiar tudo
            </button>
          </form>

          {result && (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4 text-sm space-y-1">
              <div className="font-semibold">✅ Conta criada: {result.email}</div>
              {Object.entries(result.counts).map(([k, v]) => (
                <div key={k} className="text-muted-foreground">{k}: <span className="text-foreground font-medium">{v}</span></div>
              ))}
              <div className="pt-2 text-xs">Faça logout e entre com o novo e-mail e senha.</div>
            </div>
          )}
        </div>
      </PageBody>
    </div>
  );
}
