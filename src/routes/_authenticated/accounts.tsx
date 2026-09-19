import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState, GradientButton } from "@/components/app/page";
import { Instagram, RefreshCw, Trash2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { startInstagramOAuth } from "@/lib/meta.functions";

export const Route = createFileRoute("/_authenticated/accounts")({
  component: AccountsPage,
});

function AccountsPage() {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["ig-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("instagram_accounts").select("id, user_id, ig_user_id, username, account_type, profile_picture_url, page_id, page_name, token_expires_at, followers_count, media_count, is_active, created_at, updated_at").order("created_at");
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("instagram_accounts").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Conta desconectada");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha"),
  });

  const startOAuthFn = useServerFn(startInstagramOAuth);
  const startOAuth = useMutation({
    mutationFn: async () => await startOAuthFn(),
    onSuccess: (res) => {
      if (res.ok) window.location.href = res.url;
      else toast.error(res.message);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao iniciar OAuth"),
  });

  return (
    <div>
      <PageHeader
        title="Contas do Instagram"
        description="Conecte direto pelo Instagram (Business Login), sem passar pelo Facebook."
        actions={
          <GradientButton onClick={() => startOAuth.mutate()} disabled={startOAuth.isPending}>
            {startOAuth.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Instagram className="h-4 w-4" />}
            {startOAuth.isPending ? "Redirecionando..." : "Conectar Instagram"}
          </GradientButton>
        }
      />

      <PageBody>
        <div className="card-elevated mb-5 p-4 flex items-start gap-3 border-warning/40">
          <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium">Como conectar</div>
            <p className="text-muted-foreground mt-1">
              Clique em <b>Conectar Instagram</b> — você será levado direto ao site do Instagram para autorizar. Sem tela do Facebook, sem Página vinculada.
              <br />
              <b>Importante:</b> no seu app Meta em <i>Instagram → API setup with Instagram business login → Business login settings</i>, adicione esta <i>OAuth redirect URI</i>:
              <code className="block mt-2 p-2 rounded bg-muted text-xs break-all">https://meuprojetoeu.lovable.app/api/public/instagram/callback</code>
              A conta precisa ser <b>Profissional (Business ou Creator)</b>.
            </p>
          </div>
        </div>


        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">{[1,2].map(i => <div key={i} className="h-32 rounded-xl shimmer" />)}</div>
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={Instagram}
            title="Nenhuma conta conectada"
            description="Clique em 'Conectar Instagram' para autorizar direto pelo Instagram."
            action={
              <GradientButton onClick={() => startOAuth.mutate()} disabled={startOAuth.isPending}>
                {startOAuth.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Instagram className="h-4 w-4" />}
                {startOAuth.isPending ? "Redirecionando..." : "Conectar Instagram"}
              </GradientButton>
            }
          />

        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {accounts.map((a) => (
              <div key={a.id} className="card-elevated p-5">
                <div className="flex items-start gap-4">
                  <div className="h-14 w-14 rounded-full ig-gradient p-0.5">
                    <div className="h-full w-full rounded-full bg-card flex items-center justify-center overflow-hidden">
                      {a.profile_picture_url
                        ? <img src={a.profile_picture_url} alt="" className="h-full w-full object-cover" />
                        : <Instagram className="h-6 w-6 text-primary" />}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-semibold truncate">@{a.username}</div>
                    <div className="text-xs text-muted-foreground">{a.account_type ?? "Comercial"} · {a.followers_count?.toLocaleString("pt-BR") ?? 0} seguidores</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Token {a.token_expires_at ? `expira ${formatDistanceToNow(new Date(a.token_expires_at), { addSuffix: true, locale: ptBR })}` : "sem expiração"}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-accent inline-flex items-center justify-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Renovar token
                  </button>
                  <button disabled={disconnect.isPending} onClick={() => { if (window.confirm(`Desconectar @${a.username}? Os pools e posts vinculados serão removidos conforme as regras do painel. O histórico das rodadas será preservado e as outras contas continuarão.`)) disconnect.mutate(a.id); }} className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 inline-flex items-center gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Desconectar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </div>
  );
}
