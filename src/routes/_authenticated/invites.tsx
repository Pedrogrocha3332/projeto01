import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState, GradientButton } from "@/components/app/page";
import { Mail, Plus, Copy, Trash2, Ban, Clock, CheckCircle2, XCircle, Loader2, Share2, Check } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";
import { useIsAdminPrincipal } from "@/hooks/use-role";

export const Route = createFileRoute("/_authenticated/invites")({
  component: InvitesPage,
});

type Invite = {
  id: string;
  token: string;
  email_hint: string | null;
  role: "admin_principal" | "admin";
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

function generateToken(len = 24) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, len);
}

function InvitesPage() {
  const qc = useQueryClient();
  const { isAdminPrincipal, isLoading: rolesLoading } = useIsAdminPrincipal();

  const [emailHint, setEmailHint] = useState("");
  const [days, setDays] = useState(7);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ["invites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invites").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Invite[];
    },
    enabled: isAdminPrincipal,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const token = generateToken();
      const expires_at = addDays(new Date(), days).toISOString();
      const { error } = await supabase.from("invites").insert({
        token,
        email_hint: emailHint || null,
        role: "admin",
        created_by: u.user.id,
        expires_at,
      });
      if (error) throw error;
      return token;
    },
    onSuccess: (token) => {
      toast.success("Convite criado");
      setEmailHint("");
      qc.invalidateQueries({ queryKey: ["invites"] });
      const link = `${window.location.origin}/auth?invite=${encodeURIComponent(token)}`;
      setLastLink(link);
      setCopied(false);
      navigator.clipboard.writeText(link).then(
        () => { setCopied(true); toast.message("Link copiado — envie para a pessoa convidada"); },
        () => {}
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar convite"),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invites").update({ revoked_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Convite cancelado"); qc.invalidateQueries({ queryKey: ["invites"] }); },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Convite excluído"); qc.invalidateQueries({ queryKey: ["invites"] }); },
  });

  if (rolesLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdminPrincipal) {
    return (
      <div>
        <PageHeader title="Convites" description="Área restrita ao Administrador Principal." />
        <PageBody>
          <EmptyState
            icon={Ban}
            title="Acesso restrito"
            description="Apenas o Administrador Principal pode gerar e gerenciar convites."
          />
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Convites"
        description="Gere links únicos para novos usuários acessarem o ELITE."
      />
      <PageBody>
        {lastLink && (
          <div className="mb-5 card-elevated p-5 border border-primary/40 bg-primary/5">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <CheckCircle2 className="h-4 w-4" /> Link de convite gerado
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Envie este link para a pessoa. Ela poderá se cadastrar somente com ele.
            </p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                readOnly
                value={lastLink}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(lastLink).then(() => {
                    setCopied(true);
                    toast.success("Link copiado");
                  });
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-accent"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar"}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Seu convite ELITE: ${lastLink}`)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg ig-gradient px-3 py-2 text-xs font-semibold text-primary-foreground"
              >
                <Share2 className="h-3.5 w-3.5" /> WhatsApp
              </a>
            </div>
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <div className="card-elevated p-5 h-fit">
            <h3 className="font-display font-semibold">Gerar convite</h3>
            <p className="mt-1 text-xs text-muted-foreground">Cada convite serve para um único cadastro.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">E-mail sugerido (opcional)</label>
                <input value={emailHint} onChange={(e) => setEmailHint(e.target.value)}
                  placeholder="pessoa@exemplo.com"
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Validade</label>
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value={1}>1 dia</option>
                  <option value={3}>3 dias</option>
                  <option value={7}>7 dias</option>
                  <option value={14}>14 dias</option>
                  <option value={30}>30 dias</option>
                </select>
              </div>
              <GradientButton onClick={() => create.mutate()} disabled={create.isPending} className="w-full justify-center">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Gerar link de convite
              </GradientButton>
            </div>
          </div>

          <div>
            {isLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-24 rounded-xl shimmer" />)}</div>
            ) : invites.length === 0 ? (
              <EmptyState icon={Mail} title="Nenhum convite ainda" description="Gere seu primeiro convite ao lado." />
            ) : (
              <div className="card-elevated overflow-hidden divide-y divide-border/60">
                {invites.map((inv) => (
                  <InviteRow
                    key={inv.id}
                    invite={inv}
                    onRevoke={() => revoke.mutate(inv.id)}
                    onDelete={() => remove.mutate(inv.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </PageBody>
    </div>
  );
}

function InviteRow({ invite, onRevoke, onDelete }: { invite: Invite; onRevoke: () => void; onDelete: () => void }) {
  const now = new Date();
  const expired = new Date(invite.expires_at) < now;
  const link = `${window.location.origin}/auth?invite=${encodeURIComponent(invite.token)}`;

  let status: { label: string; icon: React.ReactNode; tone: string };
  if (invite.used_at) status = { label: "Utilizado", icon: <CheckCircle2 className="h-3.5 w-3.5" />, tone: "bg-success/15 text-success" };
  else if (invite.revoked_at) status = { label: "Cancelado", icon: <Ban className="h-3.5 w-3.5" />, tone: "bg-muted text-muted-foreground" };
  else if (expired) status = { label: "Expirado", icon: <XCircle className="h-3.5 w-3.5" />, tone: "bg-destructive/15 text-destructive" };
  else status = { label: "Ativo", icon: <Clock className="h-3.5 w-3.5" />, tone: "bg-primary/15 text-primary" };

  function copyLink() {
    navigator.clipboard.writeText(link).then(
      () => toast.success("Link copiado"),
      () => toast.error("Não foi possível copiar")
    );
  }

  return (
    <div className="p-4 flex flex-wrap items-center gap-3">
      <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.tone}`}>
        {status.icon} {status.label}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{invite.email_hint || "Sem e-mail sugerido"}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Criado {format(new Date(invite.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })} · Expira {formatDistanceToNow(new Date(invite.expires_at), { addSuffix: true, locale: ptBR })}
        </div>
        <div className="mt-1 font-mono text-[11px] text-muted-foreground truncate">{link}</div>
      </div>
      <div className="flex gap-1 shrink-0">
        <button onClick={copyLink} title="Copiar link"
          className="rounded p-2 hover:bg-accent"><Copy className="h-4 w-4" /></button>
        {!invite.used_at && !invite.revoked_at && (
          <button onClick={onRevoke} title="Cancelar convite"
            className="rounded p-2 text-warning hover:bg-warning/10"><Ban className="h-4 w-4" /></button>
        )}
        <button onClick={onDelete} title="Excluir convite"
          className="rounded p-2 text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
