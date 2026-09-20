import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, StatusBadge, EmptyState, GradientButton } from "@/components/app/page";
import { CalendarDays, PenSquare, Trash2, Copy, Send, Eye, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";
import { publishNow } from "@/lib/posts.functions";
import { refreshPostMetrics, refreshRecentMetrics } from "@/lib/metrics.functions";
import { AssetImage } from "@/components/app/asset-image";


export const Route = createFileRoute("/_authenticated/queue")({
  component: QueuePage,
});

const FILTER_LABEL: Record<string, string> = {
  all: "Todas",
  scheduled: "Agendadas",
  published: "Publicadas",
  failed: "Com falha",
  draft: "Rascunhos",
};

function QueuePage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "scheduled" | "published" | "failed" | "draft">("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: accounts = [] } = useQuery({
    queryKey: ["ig-accounts-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("instagram_accounts")
        .select("id, username, profile_picture_url")
        .order("username", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduled_posts")
        .select("*, instagram_accounts(username), cover:media_assets!cover_media_id(public_url, storage_path, mime_type), post_media(position, media_assets(public_url, storage_path, mime_type))")
        .order("scheduled_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data;
    },
  });

  const { data: healingLog = [] } = useQuery({
    queryKey: ["auto-healing-log"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auto_healing_log")
        .select("id, action, category, reason, error, original_scheduled_at, new_scheduled_at, created_at, ig_account_id, post_id, instagram_accounts(username, needs_manual_review), scheduled_posts(status, scheduled_at)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Array<{
        id: string;
        action: string;
        category: string | null;
        reason: string | null;
        error: string | null;
        original_scheduled_at: string | null;
        new_scheduled_at: string | null;
        created_at: string;
        ig_account_id: string | null;
        post_id: string | null;
        instagram_accounts: { username: string; needs_manual_review: boolean | null } | null;
        scheduled_posts: { status: string; scheduled_at: string | null } | null;
      }>;
    },
  });

  // Marca entradas como "resolvidas" quando:
  // - a conta em revisão manual já foi reativada, OU
  // - o post relacionado já foi publicado, OU
  // - o post foi reagendado com sucesso (nova data futura, status saudável)
  const nowMs = Date.now();
  const problemActions = new Set([
    "manual_review_required",
    "account_restricted",
    "rate_limited",
    "publish_failed",
    "failed",
    "failed_final",
    "retry_scheduled",
    "rescheduled",
    "delayed",
    "too_many_actions",
  ]);
  const visibleHealingLog = healingLog.map((h) => {
    const accountReactivated =
      (h.action === "manual_review_required" || h.action === "account_restricted") &&
      h.instagram_accounts &&
      h.instagram_accounts.needs_manual_review !== true;
    const postPublished = h.scheduled_posts?.status === "published";
    const postRescheduled =
      problemActions.has(h.action) &&
      h.scheduled_posts &&
      ["scheduled", "queued", "publishing"].includes(h.scheduled_posts.status) &&
      h.scheduled_posts.scheduled_at != null &&
      new Date(h.scheduled_posts.scheduled_at).getTime() > nowMs;
    const resolved = Boolean(accountReactivated || postPublished || postRescheduled);
    return { ...h, resolved };
  }).slice(0, 30);



  const del = useMutation({
    mutationFn: async (id: string) => (await supabase.from("scheduled_posts").delete().eq("id", id)).error,
    onSuccess: () => { toast.success("Excluído"); qc.invalidateQueries({ queryKey: ["queue"] }); },
  });

  const bulkDel = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return null;
      const { error } = await supabase.from("scheduled_posts").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`${n ?? 0} posts excluídos`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const deletePublished = useMutation({
    mutationFn: async () => {
      const { error, count } = await supabase
        .from("scheduled_posts")
        .delete({ count: "exact" })
        .eq("status", "published");
      if (error) throw error;
      return count ?? 0;
    },
    onSuccess: (n) => {
      toast.success(`${n} publicados removidos do histórico`);
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const publishFn = useServerFn(publishNow);
  const publish = useMutation({
    mutationFn: async (id: string) => publishFn({ data: { postId: id } }),
    onSuccess: (result) => {
      if (result.status === "published") toast.success("Publicado no Instagram");
      else if (result.status === "delayed") toast.info("Publicação reagendada para respeitar a restrição recente retornada pelo Instagram.");
      else toast.info("Vídeo enviado para processamento. O app vai finalizar automaticamente.");
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao publicar"),
  });

  const bulkPublish = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = { sent: 0, delayed: 0, failed: 0 };
      for (const id of ids) {
        try {
          const result = await publishFn({ data: { postId: id } });
          if (result.status === "delayed") results.delayed++;
          else results.sent++;
        } catch {
          results.failed++;
        }
      }
      return results;
    },
    onSuccess: ({ sent, delayed, failed }) => {
      toast.info(`Lote: ${sent} enviados, ${delayed} reagendados, ${failed} com falha.`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  const refreshSingleMetricsFn = useServerFn(refreshPostMetrics);
  const refreshSingle = useMutation({
    mutationFn: async (postId: string) => refreshSingleMetricsFn({ data: { postId } }),
    onSuccess: (res) => {
      toast.success(`Métricas atualizadas: ${res.views.toLocaleString("pt-BR")} views`);
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao puxar métricas da Meta"),
  });

  const refreshBatchMetricsFn = useServerFn(refreshRecentMetrics);
  const refreshBatch = useMutation({
    mutationFn: async () => refreshBatchMetricsFn({ data: { limit: 30 } }),
    onSuccess: (res) => {
      toast.success(`Sincronizados ${res.synced} posts com a Meta!`);
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao sincronizar métricas"),
  });

  const selectedPublishable = posts.filter((p) => selected.has(p.id) && ["scheduled", "failed", "draft"].includes(p.status));

  const filtered = posts.filter((p) => {
    if (filter !== "all" && p.status !== filter) return false;
    if (accountFilter !== "all" && p.ig_account_id !== accountFilter) return false;
    return true;
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selected);
      filtered.forEach((p) => next.delete(p.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((p) => next.add(p.id));
      setSelected(next);
    }
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const pendingByAccount = new Map<string, number>();
  for (const p of posts) {
    if (["scheduled", "queued", "publishing"].includes(p.status)) {
      pendingByAccount.set(p.ig_account_id, (pendingByAccount.get(p.ig_account_id) ?? 0) + 1);
    }
  }

  return (
    <div>
      <PageHeader
        title="Fila"
        description="Todas as publicações agendadas, publicadas e rascunhos."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshBatch.mutate()}
              disabled={refreshBatch.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
              title="Consulta a Meta Graph API para atualizar views e engajamento em tempo real"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshBatch.isPending ? "animate-spin text-primary" : ""}`} />
              {refreshBatch.isPending ? "Sincronizando..." : "Atualizar Views (Meta)"}
            </button>
            <Link to="/compose"><GradientButton><PenSquare className="h-4 w-4" /> Nova publicação</GradientButton></Link>
          </div>
        }
      />
      <PageBody>
        {visibleHealingLog.length > 0 && (
          <details className="mb-4 rounded-xl border border-border/60 bg-card/40 open:pb-3">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Correções automáticas aplicadas
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {visibleHealingLog.length} recentes
                </span>
              </span>
              <span className="text-xs text-muted-foreground">clique para expandir</span>
            </summary>
            <div className="max-h-72 overflow-y-auto px-3 space-y-1.5">
              {visibleHealingLog.map((h) => {
                const color = h.resolved
                  ? "text-green-600 border-green-500/40 bg-green-500/10"
                  : h.action.includes("published") || h.action.includes("recovered") || h.action.includes("recreated")
                    ? "text-green-600 border-green-500/30 bg-green-500/5"
                  : h.action === "manual_review_required" || h.action === "account_restricted"
                    ? "text-red-600 border-red-500/30 bg-red-500/5"
                  : h.action === "failed_final"
                    ? "text-red-500 border-red-500/20 bg-red-500/5"
                    : "text-amber-600 border-amber-500/30 bg-amber-500/5";
                return (
                  <div key={h.id} className={`rounded-md border px-2.5 py-1.5 text-xs ${color}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold uppercase tracking-wide text-[10px]">{h.action}</span>
                      {h.resolved && (
                        <span className="rounded-full bg-green-500 text-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                          ✓ Resolvido
                        </span>
                      )}
                      {h.instagram_accounts?.username && (
                        <span className="text-muted-foreground">@{h.instagram_accounts.username}</span>
                      )}
                      {h.category && (
                        <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{h.category}</span>
                      )}
                      <span className="ml-auto text-muted-foreground">
                        {format(new Date(h.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                      </span>
                    </div>

                    {h.reason && <div className="mt-0.5 text-foreground/80">{h.reason}</div>}
                    {(h.original_scheduled_at || h.new_scheduled_at) && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {h.original_scheduled_at && (
                          <>de {format(new Date(h.original_scheduled_at), "dd/MM HH:mm", { locale: ptBR })}</>
                        )}
                        {h.new_scheduled_at && (
                          <> → {format(new Date(h.new_scheduled_at), "dd/MM HH:mm", { locale: ptBR })}</>
                        )}
                      </div>
                    )}
                    {h.error && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground truncate" title={h.error}>
                        {h.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        )}

        <div className="mb-3 flex flex-wrap gap-1">
          {(["all","scheduled","published","failed","draft"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                filter === f ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"
              }`}>{FILTER_LABEL[f]}</button>
          ))}
        </div>

        {accounts.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Fila da conta:</span>
            <button
              onClick={() => setAccountFilter("all")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                accountFilter === "all" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"
              }`}
            >
              Todas
            </button>
            {accounts.map((a) => {
              const count = pendingByAccount.get(a.id) ?? 0;
              const active = accountFilter === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAccountFilter(a.id)}
                  className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                    active ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"
                  }`}
                >
                  {a.profile_picture_url ? (
                    <img src={a.profile_picture_url} alt="" className="h-4 w-4 rounded-full object-cover" />
                  ) : null}
                  @{a.username}
                  {count > 0 && (
                    <span className={`rounded-full px-1.5 text-[10px] ${active ? "bg-primary-foreground/20" : "bg-muted"}`}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="font-medium">Selecionar todos ({filtered.length})</span>
            </label>
            {selected.size > 0 && (
              <span className="text-muted-foreground">{selected.size} selecionados</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedPublishable.length > 0 && (
              <button
                onClick={() => bulkPublish.mutate(selectedPublishable.map((p) => p.id))}
                disabled={bulkPublish.isPending || publish.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> {bulkPublish.isPending ? "Enviando lote…" : `Publicar selecionados (${selectedPublishable.length})`}
              </button>
            )}
            {selected.size > 0 && (
              <button
                onClick={() => {
                  if (confirm(`Excluir ${selected.size} post(s)?`)) bulkDel.mutate(Array.from(selected));
                }}
                disabled={bulkDel.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir selecionados
              </button>
            )}
            <button
              onClick={() => {
                if (confirm("Apagar TODOS os posts já publicados do histórico? Isso não desfaz as postagens no Instagram — só limpa a fila.")) {
                  deletePublished.mutate();
                }
              }}
              disabled={deletePublished.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Limpar publicados
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 rounded-xl shimmer" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nada por aqui ainda" description="Crie sua primeira publicação para vê-la na fila."
            action={<Link to="/compose"><GradientButton><PenSquare className="h-4 w-4" /> Nova publicação</GradientButton></Link>} />
        ) : (
          <div className="card-elevated overflow-hidden divide-y divide-border/60">
            {filtered.map((p) => {
              const firstPostMedia = (p.post_media ?? []).slice().sort((a, b) => a.position - b.position)?.[0]?.media_assets;
              // Prefer cover (image), then a non-video post media, else the first media
              const nonVideo = (p.post_media ?? []).map(m => m.media_assets).find(m => m && !(m.mime_type || "").startsWith("video"));
              const thumb = p.cover ?? nonVideo ?? firstPostMedia;
              const isVideo = (thumb?.mime_type || "").startsWith("video");
              return (
                <div key={p.id} className="flex items-center gap-4 p-4 hover:bg-accent/40">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleOne(p.id)}
                    className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                  />
                  <div className="h-14 w-14 shrink-0 rounded-lg bg-muted overflow-hidden flex items-center justify-center text-[10px] text-muted-foreground">
                    {thumb?.storage_path && !isVideo ? (
                      <AssetImage
                        storagePath={thumb.storage_path}
                        publicUrl={thumb.public_url}
                        className="h-full w-full object-cover"
                      />
                    ) : isVideo ? "VÍDEO" : ""}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={p.status} />
                      <span className="text-xs text-muted-foreground">{p.post_type}</span>
                      {p.instagram_accounts && <span className="text-xs text-muted-foreground">· @{p.instagram_accounts.username}</span>}
                    </div>
                    <div className="mt-1 truncate text-sm">{p.caption?.slice(0, 100) || "(sem legenda)"}</div>
                    {p.status === "published" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                          <Eye className="h-3 w-3" />
                          {(p.view_count ?? 0).toLocaleString("pt-BR")} views
                        </span>
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                          ❤️ {(p.like_count ?? 0).toLocaleString("pt-BR")} likes
                        </span>
                        {(p.reach_count ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                            🎯 {(p.reach_count ?? 0).toLocaleString("pt-BR")} alcance
                          </span>
                        )}
                        {/* Alerta de 0 Views / Possível restrição se publicado há mais de 2 horas sem views e sem likes */}
                        {p.published_at &&
                          Date.now() - new Date(p.published_at).getTime() > 2 * 3600 * 1000 &&
                          (p.view_count ?? 0) === 0 &&
                          (p.like_count ?? 0) === 0 && (
                            <span className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                              <AlertTriangle className="h-3 w-3" />
                              0 Views (Sem entrega / Alerta)
                            </span>
                          )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            refreshSingle.mutate(p.id);
                          }}
                          disabled={refreshSingle.isPending}
                          className="text-[11px] text-muted-foreground hover:text-foreground underline decoration-dotted"
                          title="Atualizar views deste Reel agora na Meta"
                        >
                          {refreshSingle.isPending ? "Atualizando…" : "Atualizar"}
                        </button>
                      </div>
                    )}
                    {p.last_error && (
                      <div className="mt-1 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive whitespace-pre-wrap break-words">
                        <span className="font-semibold">Erro da API do Instagram:</span> {p.last_error}
                      </div>
                    )}
                  </div>
                  <div className="hidden md:block text-right shrink-0">
                    <div className="text-xs text-muted-foreground">{format(new Date(p.scheduled_at), "dd MMM, HH:mm", { locale: ptBR })}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {(p.status === "scheduled" || p.status === "failed" || p.status === "draft") && (
                      <button
                        onClick={() => publish.mutate(p.id)}
                        disabled={publish.isPending || bulkPublish.isPending}
                        className="rounded p-2 hover:bg-primary/10 text-primary"
                        title={p.status === "failed" ? "Tentar novamente" : "Publicar agora"}
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    <button className="rounded p-2 hover:bg-accent" title="Duplicar"><Copy className="h-4 w-4" /></button>
                    <button onClick={() => del.mutate(p.id)} className="rounded p-2 hover:bg-destructive/10 text-destructive" title="Excluir"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageBody>
    </div>
  );
}
