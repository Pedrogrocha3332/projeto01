import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState, GradientButton } from "@/components/app/page";
import { Repeat, Plus, Play, Pause, Trash2, Film, Send, X, Clock, ChevronDown, ChevronUp, Search, ExternalLink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AssetImage } from "@/components/app/asset-image";
import { VideoSourceTabs } from "@/components/app/video-source-tabs";
import { filterPoolVideos, loadPoolLibrary } from "@/lib/pool-library";
import { PoolVideoPicker } from "@/components/app/pool-video-picker";
import { VideoThumb } from "@/components/app/video-thumb";
import { savePoolVideoOrder } from "@/lib/media-account.functions";
import { VideoOrderList } from "@/components/app/video-order-list";
import { createPool, updatePool, deletePool, addPoolVideos, removePoolVideo, runPoolNow } from "@/lib/pools.functions";

export const Route = createFileRoute("/_authenticated/pools")({
  component: PoolsPage,
});

type Account = { id: string; username: string; profile_picture_url: string | null; is_restricted?: boolean; restricted_at?: string | null };
type Pool = {
  id: string;
  ig_account_id: string;
  name: string;
  first_comment?: string | null;
  caption: string;
  manual_order: boolean;
  caption_2: string;
  caption_3: string;
  batch_size: number;
  first_batch_size?: number | null;
  interval_minutes: number;
  spacing_seconds: number;
  status: string;
  cycle_number: number;
  last_batch_at: string | null;
  next_batch_at: string | null;
  batches_published: number;
  reels_published: number;
  reels_reserved?: number;
  reel_limit?: number;
  cover_media_asset_id: string | null;
};
type ImageAsset = { id: string; file_name: string; storage_path: string; public_url: string };

function PoolsPage() {
  const qc = useQueryClient();
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedPool, setExpandedPool] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["pools-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("instagram_accounts")
        .select("id, username, profile_picture_url, is_restricted, restricted_at").order("username");
      if (error) throw error;
      return data as Account[];
    },
  });

  const { data: pools = [], isLoading } = useQuery({
    queryKey: ["media-pools"],
    queryFn: async () => {
      const { data, error } = await supabase.from("media_pools").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Pool[];
    },
    refetchInterval: 30_000,
  });

  const { data: videoCounts = {} } = useQuery({
    queryKey: ["pool-video-counts", pools.map((p) => p.id).join(",")],
    enabled: pools.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("pool_videos")
        .select("pool_id, posted_in_current_cycle");
      if (error) throw error;
      const map: Record<string, { total: number; pending: number }> = {};
      for (const row of data as { pool_id: string; posted_in_current_cycle: boolean }[]) {
        if (!map[row.pool_id]) map[row.pool_id] = { total: 0, pending: 0 };
        map[row.pool_id].total++;
        if (!row.posted_in_current_cycle) map[row.pool_id].pending++;
      }
      return map;
    },
  });

  const filtered = pools.filter((p) => accountFilter === "all" || p.ig_account_id === accountFilter);
  const accountsMap = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  const updateFn = useServerFn(updatePool);
  const deleteFn = useServerFn(deletePool);
  const runFn = useServerFn(runPoolNow);

  const toggleStatus = useMutation({
    mutationFn: async (p: Pool) => {
      const goingActive = p.status !== "active";
      await updateFn({ data: { id: p.id, status: goingActive ? "active" : "paused" } });
      if (goingActive && p.ig_account_id) {
        // Retomar um pool reativa a conta por completo: limpa restrição,
        // limpa a flag de revisão manual e marca a conta como ativa.
        await supabase.from("instagram_accounts")
          .update({
            is_restricted: false,
            restricted_at: null,
            restricted_reason: null,
            is_active: true,
            needs_manual_review: false,
          })
          .eq("id", p.ig_account_id);
        // Dispara o pool imediatamente pra reagendar/publicar o quanto antes,
        // sem esperar o cron de 1 minuto.
        try { await runFn({ data: { id: p.id } }); } catch { /* best-effort */ }
      }
    },
    onSuccess: (_r, p) => {
      qc.invalidateQueries({ queryKey: ["media-pools"] });
      qc.invalidateQueries({ queryKey: ["pools-accounts"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["auto-healing-log"] });
      toast.success(p.status !== "active" ? "Conta reativada — pool disparado" : "Status atualizado");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { await deleteFn({ data: { id } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["media-pools"] }); toast.success("Pool excluído"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const runNow = useMutation({
    mutationFn: async (id: string) => await runFn({ data: { id } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["media-pools"] });
      toast.success(r.action === "enqueued" ? "Lote enfileirado!" : `Ação: ${r.action}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <div>
      <PageHeader
        title="Pools de Rotação"
        description={`${pools.length} pools · ${pools.filter((p) => p.status === "active").length} ativos · publica Reels em lotes com rotação circular`}
        actions={
          <GradientButton onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Novo pool
          </GradientButton>
        }
      />
      <PageBody>
        {/* Filtro por conta */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setAccountFilter("all")}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${accountFilter === "all" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
          >
            Todas as contas <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{pools.length}</span>
          </button>
          {accounts.map((a) => {
            const count = pools.filter((p) => p.ig_account_id === a.id).length;
            if (count === 0) return null;
            const active = accountFilter === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setAccountFilter(a.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
              >
                @{a.username} <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{count}</span>
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="grid gap-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 rounded-lg shimmer" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={accountFilter === "all" ? "Nenhum pool criado" : "Nenhum pool nessa conta"}
            description="Crie um pool para postar Reels em lotes com rotação automática dos vídeos."
            action={<GradientButton onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> Criar primeiro pool</GradientButton>}
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((p) => {
              const acc = accountsMap[p.ig_account_id];
              const counts = videoCounts[p.id] ?? { total: 0, pending: 0 };
              const expanded = expandedPool === p.id;
              return (
                <div key={p.id} className="card-elevated overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display text-lg font-semibold truncate">{p.name}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${p.status === "active" ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground border-border"}`}>
                          {p.status === "active" ? "Ativo" : "Pausado"}
                        </span>
                        {acc?.is_restricted && (
                          <span className="rounded-full border border-destructive/40 bg-destructive/15 text-destructive px-2 py-0.5 text-[10px] font-semibold uppercase">
                            Restricted
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className={acc?.is_restricted ? "text-destructive font-medium" : ""}>@{acc?.username ?? "?"}</span>
                        <span>Lote: {p.batch_size} reels{p.first_batch_size != null && p.batches_published === 0 ? ` · Primeiro: ${p.first_batch_size}` : ""}</span>
                        <span>Intervalo: {p.interval_minutes} min</span>
                        <span>Fila: {counts.pending}/{counts.total} restantes no ciclo #{p.cycle_number}</span>
                        <span>Total do pool: {Math.max(p.reels_reserved ?? 0, p.reels_published)}/{p.reel_limit ?? 40} reels · {p.batches_published} lotes</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {p.status === "active" && p.next_batch_at ? (
                          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Próximo lote {formatDistanceToNow(new Date(p.next_batch_at), { locale: ptBR, addSuffix: true })} ({format(new Date(p.next_batch_at), "dd/MM HH:mm")})</span>
                        ) : p.status === "paused" ? (
                          <span>Pausado — retome para agendar o próximo lote</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => runNow.mutate(p.id)}
                        disabled={runNow.isPending || counts.total === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                        title="Enfileirar próximo lote agora"
                      >
                        <Send className="h-3.5 w-3.5" /> Rodar agora
                      </button>
                      <button
                        onClick={() => toggleStatus.mutate(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
                      >
                        {p.status === "active" ? <><Pause className="h-3.5 w-3.5" /> Pausar</> : <><Play className="h-3.5 w-3.5" /> Retomar</>}
                      </button>
                      <button
                        onClick={() => { if (confirm(`Excluir "${p.name}"? Os posts já agendados continuam na fila.`)) del.mutate(p.id); }}
                        className="rounded-lg border border-border bg-card p-1.5 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setExpandedPool(expanded ? null : p.id)}
                        className="rounded-lg border border-border bg-card p-1.5 hover:bg-muted"
                      >
                        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  {p.caption && (
                    <div className="border-t border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground line-clamp-2">
                      <span className="font-medium">Legenda:</span> {p.caption}
                    </div>
                  )}
                  {expanded && <PoolDetail pool={p} accounts={accounts} />}
                </div>
              );
            })}
          </div>
        )}
      </PageBody>

      {showCreate && <CreatePoolDialog accounts={accounts} onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function PoolDetail({ pool, accounts }: { pool: Pool; accounts: Account[] }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"videos" | "history" | "config">("videos");
  const [showAdd, setShowAdd] = useState(false);

  const { data: videos = [] } = useQuery({
    queryKey: ["pool-videos", pool.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("pool_videos")
        .select("id, position, posted_in_current_cycle, times_posted, last_posted_at, media_assets(id, file_name, storage_path, public_url, thumbnail_url, thumbnail_path, mime_type, media_kind)")
        .eq("pool_id", pool.id)
        .order("position");
      if (error) throw error;
      return data;
    },
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["pool-logs", pool.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("pool_execution_log")
        .select("id, batch_number, batch_index, cycle_number, scheduled_at, executed_at, ig_media_id, error, scheduled_posts(status, ig_media_id, ig_permalink, last_error, published_at), media_assets(file_name, storage_path, public_url, thumbnail_url, thumbnail_path)")
        .eq("pool_id", pool.id)
        .order("batch_number", { ascending: false })
        .order("batch_index")
        .limit(200);
      if (error) throw error;
      return data;
    },
    refetchInterval: 15_000,
  });

  const removeFn = useServerFn(removePoolVideo);
  const removeVideo = useMutation({
    mutationFn: async (id: string) => await removeFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pool-videos", pool.id] }); toast.success("Vídeo removido"); },
  });

  // Agrupa logs por lote
  const batches = useMemo(() => {
    const map = new Map<string, typeof logs>();
    for (const l of logs) {
      const key = `${l.cycle_number}-${l.batch_number}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }));
  }, [logs]);

  return (
    <div className="border-t border-border/60 bg-muted/10">
      <div className="flex gap-1 overflow-x-auto border-b border-border/60 px-4 pt-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[
          { k: "videos", label: `Vídeos (${videos.length})` },
          { k: "history", label: `Histórico (${batches.length} lotes)` },
          { k: "config", label: "Config" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k as never)}
            className={`whitespace-nowrap shrink-0 rounded-t-md px-3 py-1.5 text-xs transition ${tab === t.k ? "bg-background border border-border border-b-transparent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "videos" && (
        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Ordem embaralhada a cada ciclo. Vídeos já postados no ciclo atual ficam esmaecidos.</span>
            <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted">
              <Plus className="h-3.5 w-3.5" /> Adicionar vídeos
            </button>
          </div>
          {videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum vídeo. Adicione vídeos da biblioteca para começar.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/60 bg-background/40 p-2 sm:grid-cols-3 lg:grid-cols-4">
              {videos.map((v) => {
                const ma = v.media_assets as { file_name: string; storage_path: string; public_url: string; thumbnail_url: string | null; thumbnail_path: string | null } | null;
                if (!ma) return null;
                return (
                  <div key={v.id} className={`group relative aspect-square overflow-hidden rounded border border-border bg-muted ${v.posted_in_current_cycle ? "opacity-40" : ""}`}>
                    <VideoThumb storagePath={ma.storage_path} thumbnailUrl={ma.thumbnail_url} thumbnailPath={ma.thumbnail_path} videoUrl={ma.public_url} fileName={ma.file_name} className="h-full w-full" />
                    {v.posted_in_current_cycle && (
                      <span className="absolute inset-x-0 top-0 bg-success/80 py-0.5 text-center text-[9px] font-medium text-white">Postado</span>
                    )}
                    <button
                      onClick={() => removeVideo.mutate(v.id)}
                      className="absolute right-1 top-1 rounded bg-black/60 p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive"
                      aria-label="Remover"
                    ><X className="h-3 w-3 text-white" /></button>
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] text-white">#{v.position + 1}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="p-4">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lote publicado ainda.</p>
          ) : (
            <div className="space-y-3">
              {batches.map((b) => (
                <div key={b.key} className="rounded-lg border border-border bg-background/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium">Ciclo #{b.items[0].cycle_number} · Lote #{b.items[0].batch_number}</span>
                    <span className="text-[10px] text-muted-foreground">{format(new Date(b.items[0].scheduled_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {b.items.map((item) => {
                      const sp = item.scheduled_posts as { status: string; ig_permalink: string | null; last_error: string | null; published_at: string | null } | null;
                      const status = sp?.status ?? "scheduled";
                      const Icon = status === "published" ? CheckCircle2 : status === "failed" ? AlertCircle : status === "publishing" ? Loader2 : Clock;
                      const color = status === "published" ? "text-success" : status === "failed" ? "text-destructive" : status === "publishing" ? "text-warning" : "text-muted-foreground";
                      const ma = item.media_assets as { file_name: string } | null;
                      return (
                        <div key={item.id} className="flex items-center gap-2 rounded border border-border/60 bg-card px-2 py-1.5 text-[11px]">
                          <Icon className={`h-3.5 w-3.5 shrink-0 ${color} ${status === "publishing" ? "animate-spin" : ""}`} />
                          <span className="truncate flex-1">{ma?.file_name ?? "vídeo"}</span>
                          {sp?.ig_permalink && (
                            <a href={sp.ig_permalink} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {sp?.last_error && <span className="text-destructive" title={sp.last_error}>!</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "config" && <PoolConfig pool={pool} />}

      {tab === "videos" && <PoolOrderEditor key={videos.map(v => v.id + ":" + v.position).join(",") + String(pool.manual_order)} pool={pool}
        items={videos.map(v => ({ id: v.id, label: (v.media_assets as { file_name?: string } | null)?.file_name ?? "Vídeo", consumed: v.posted_in_current_cycle }))} />}
      {showAdd && <AddVideosDialog accounts={accounts} accountId={pool.ig_account_id} poolId={pool.id} onClose={() => setShowAdd(false)} existingIds={videos.map((v) => (v.media_assets as { id: string })?.id).filter(Boolean)} />}
    </div>
  );
}

function PoolConfig({ pool }: { pool: Pool }) {
  const qc = useQueryClient();
  const [name, setName] = useState(pool.name);
  const [firstComment, setFirstComment] = useState(pool.first_comment ?? "");
  const [caption, setCaption] = useState(pool.caption);
  const [caption2, setCaption2] = useState(pool.caption_2 ?? "");
  const [caption3, setCaption3] = useState(pool.caption_3 ?? "");
  const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1);
  const [reelLimit, setReelLimit] = useState(pool.reel_limit ?? 40);
  const [firstBatch, setFirstBatch] = useState<number | "">(pool.first_batch_size ?? "");
  const [batch, setBatch] = useState(pool.batch_size);
  const [interval, setInterval] = useState(pool.interval_minutes);
  const [spacing, setSpacing] = useState(pool.spacing_seconds);
  const [coverId, setCoverId] = useState<string | null>(pool.cover_media_asset_id);
  const updateFn = useServerFn(updatePool);
  const save = useMutation({
    mutationFn: async () => await updateFn({ data: { id: pool.id, reel_limit: reelLimit, ...(pool.status === "paused" && pool.batches_published === 0 ? { first_batch_size: firstBatch === "" ? null : firstBatch } : {}), name, ...(firstComment.trim() || pool.first_comment !== undefined ? { first_comment: firstComment } : {}), caption, caption_2: caption2, caption_3: caption3, batch_size: batch, interval_minutes: interval, spacing_seconds: spacing, cover_media_asset_id: coverId } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["media-pools"] }); toast.success("Salvo"); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  return (
    <div className="grid gap-3 p-4 md:grid-cols-2">
      <label className="block">
        <span className="text-xs font-medium">Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
      </label>
<label className="block">
 <span className="text-xs font-medium">Limite total de reels</span>
 <input type="number" min={1} max={2147483647} value={reelLimit} onChange={e => setReelLimit(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
 <p className="text-xs text-muted-foreground">Inclui os já enfileirados. Não zera por dia. Reduzir não remove posts da fila.</p>
</label>
      <label className="block">
        <span className="text-xs font-medium">Primeiro lote (somente antes de iniciar)</span>
        <input type="number" min={1} value={firstBatch} disabled={pool.status !== "paused" || pool.batches_published > 0} placeholder="Mesmo tamanho dos seguintes" onChange={e => setFirstBatch(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-50" />
        <p className="text-xs text-muted-foreground">Pause antes do primeiro lote para editar. Não se repete ao retomar.</p>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <span className="text-xs font-medium">Lote</span>
          <input type="number" min={1} value={batch} onChange={(e) => setBatch(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Intervalo (min)</span>
          <input type="number" min={5} value={interval} onChange={(e) => setInterval(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium">Espaço (seg)</span>
          <input type="number" min={0} max={1800} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="md:col-span-2">
        <CoverPicker value={coverId} onChange={setCoverId} />
      </div>
      <div className="md:col-span-2 block space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Rodízio de Legendas (Gira a cada 6 Reels)</span>
          <div className="flex gap-1 rounded bg-muted p-0.5 text-[11px] font-medium">
            <button type="button" onClick={() => setActiveTab(1)} className={`rounded px-2 py-0.5 transition ${activeTab === 1 ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Legenda 1</button>
            <button type="button" onClick={() => setActiveTab(2)} className={`rounded px-2 py-0.5 transition ${activeTab === 2 ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Legenda 2</button>
            <button type="button" onClick={() => setActiveTab(3)} className={`rounded px-2 py-0.5 transition ${activeTab === 3 ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Legenda 3</button>
          </div>
        </div>
        <label className="block text-sm">Primeiro comentário (opcional)<textarea value={firstComment} onChange={e=>setFirstComment(e.target.value)} maxLength={2200} rows={3} placeholder="Comentário enviado após cada reel" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"/><span className="text-xs text-muted-foreground">Aplicado aos novos posts. A fila já criada permanece como está.</span></label>
        {activeTab === 1 && (
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} placeholder="Escreva a legenda 1 (usada nos posts 1-6, 19-24, etc...)" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20" />
        )}
        {activeTab === 2 && (
          <textarea value={caption2} onChange={(e) => setCaption2(e.target.value)} rows={4} placeholder="Escreva a legenda 2 (usada nos posts 7-12, 25-30, etc... Deixe em branco se não quiser rodízio)" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20" />
        )}
        {activeTab === 3 && (
          <textarea value={caption3} onChange={(e) => setCaption3(e.target.value)} rows={4} placeholder="Escreva a legenda 3 (usada nos posts 13-18, 31-36, etc... Deixe em branco se não quiser rodízio)" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20" />
        )}
      </div>
      <div className="md:col-span-2 flex justify-end">
        <GradientButton onClick={() => save.mutate()} disabled={save.isPending}>Salvar</GradientButton>
      </div>
    </div>
  );
}

function CoverPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [search, setSearch] = useState("");
  const { data: images = [] } = useQuery({
    queryKey: ["media-images-selectable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("media_assets")
        .select("id, file_name, storage_path, public_url")
        .in("media_kind", ["image", "cover"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ImageAsset[];
    },
  });
  const filtered = images.filter((i) => !search || i.file_name.toLowerCase().includes(search.toLowerCase()));
  const selected = images.find((i) => i.id === value) ?? null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">Capa fixa dos Reels (imagem única aplicada em todos os vídeos)</span>
        <div className="flex items-center gap-2">
          {value && (
            <button type="button" onClick={() => onChange(null)} className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted">
              Remover capa
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar imagem..." className="rounded border border-input bg-background pl-7 pr-2 py-1 text-xs" />
          </div>
        </div>
      </div>
      {selected && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2">
          <AssetImage storagePath={selected.storage_path} publicUrl={selected.public_url} alt={selected.file_name} className="h-12 w-12 rounded object-cover" />
          <span className="text-xs text-muted-foreground truncate flex-1">Capa: {selected.file_name}</span>
        </div>
      )}
      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">Nenhuma imagem na biblioteca. Envie uma imagem primeiro em Biblioteca para usar como capa.</p>
      ) : (
        <div className="grid max-h-40 grid-cols-4 gap-2 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-6 md:grid-cols-8">
          {filtered.map((img) => {
            const sel = img.id === value;
            return (
              <button key={img.id} type="button" onClick={() => onChange(sel ? null : img.id)}
                className={`group relative aspect-square overflow-hidden rounded border-2 transition ${sel ? "border-primary ring-2 ring-primary/40" : "border-transparent hover:border-border"}`}>
                <AssetImage storagePath={img.storage_path} publicUrl={img.public_url} alt={img.file_name} className="h-full w-full object-cover" />
                {sel && <div className="absolute inset-0 flex items-center justify-center bg-primary/40"><CheckCircle2 className="h-5 w-5 text-white" /></div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreatePoolDialog({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [videoSource, setVideoSource] = useState("all");
  const [firstComment, setFirstComment] = useState("");
  const [caption, setCaption] = useState("");
  const [caption2, setCaption2] = useState("");
  const [caption3, setCaption3] = useState("");
  const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1);
  const [batch, setBatch] = useState(3);
  const [interval, setInterval] = useState(60);
  const [spacing, setSpacing] = useState(60);
  const [reelLimit, setReelLimit] = useState(40);
  const [firstBatch, setFirstBatch] = useState<number | "">(6);
  const manualOrder = true;
  const [selectedVideos, setSelectedVideos] = useState<string[]>([]);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: videos = [], isLoading: loadingVideos, error: videoError } = useQuery({
    queryKey: ["media-videos-selectable", "shared"],
    enabled: Boolean(accountId),
    queryFn: () => loadPoolLibrary(supabase),
  });

  const filteredVideos = filterPoolVideos(videos, videoSource, search);

  const createFn = useServerFn(createPool);
  const create = useMutation({
    mutationFn: async () => await createFn({ data: {
      ig_account_id: accountId,
      name,
      first_comment: firstComment,
      caption,
      caption_2: caption2,
      caption_3: caption3,
      batch_size: batch,
      reel_limit: reelLimit,
      first_batch_size: firstBatch === "" ? null : firstBatch,
      interval_minutes: interval,
      spacing_seconds: spacing,
      video_ids: selectedVideos,
      manual_order: manualOrder,
      cover_media_asset_id: coverId,
    } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-pools"] });
      toast.success("Pool criado!");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const canSubmit = name.trim() && accountId && selectedVideos.length > 0 && !create.isPending && !loadingVideos && !videoError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="relative flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-display text-lg font-semibold">Novo Pool de Rotação</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium">Nome do pool</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Campanha Julho - Conta X" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Conta que publica</span>
              <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setVideoSource("all"); setSelectedVideos([]); }} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                {accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
              </select>
            </label>
          </div>
<label className="block">
 <span className="text-xs font-medium">Limite total de reels</span>
 <input type="number" min={1} max={2147483647} value={reelLimit} onChange={e => setReelLimit(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
 <p className="text-xs text-muted-foreground">Inclui os já enfileirados. Não zera por dia. Reduzir não remove posts da fila.</p>
</label>
          <label className="block">
            <span className="text-xs font-medium">Primeiro lote (reels, uma única vez)</span>
            <input type="number" min={1} value={firstBatch} placeholder="Usar tamanho dos lotes seguintes" onChange={e => setFirstBatch(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs font-medium">Lotes seguintes (reels por vez)</span>
              <input type="number" min={1} value={batch} onChange={(e) => setBatch(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Intervalo (minutos)</span>
              <input type="number" min={5} value={interval} onChange={(e) => setInterval(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium">Espaço (segundos)</span>
              <input type="number" min={0} max={1800} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
            <div className="flex items-center gap-2 font-semibold text-primary mb-1">
              <Clock className="h-3.5 w-3.5" /> Ritmo de publicação
            </div>
            <p className="text-muted-foreground">
              Limite total de {reelLimit} reels por pool, incluindo os já enfileirados. Ao atingir o limite, o pool pausa. O primeiro lote terá até <strong>{firstBatch === "" ? batch : firstBatch} Reels</strong>; os seguintes, até <strong>{batch} Reels</strong>, conforme os vídeos disponíveis. Após o último vídeo de cada lote, o sistema espera <strong>{interval} minutos</strong> para iniciar o próximo. Os posts do mesmo lote serão enfileirados com <strong>{spacing} segundos</strong> de espaçamento, com os vídeos <strong>{manualOrder ? "na ordem escolhida" : "embaralhados a cada ciclo"}</strong> e horários <strong>escalonados</strong> entre contas para não colidir com outros pools ativos.
            </p>
          </div>
          <div className="block space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Rodízio de Legendas (Gira a cada 6 Reels)</span>
              <div className="flex gap-1 rounded bg-muted p-0.5 text-[11px] font-medium">
                <button type="button" onClick={() => setActiveTab(1)} className={`rounded px-2 py-0.5 transition ${activeTab === 1 ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Legenda 1</button>
                <button type="button" onClick={() => setActiveTab(2)} className={`rounded px-2 py-0.5 transition ${activeTab === 2 ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Legenda 2</button>
                <button type="button" onClick={() => setActiveTab(3)} className={`rounded px-2 py-0.5 transition ${activeTab === 3 ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Legenda 3</button>
              </div>
            </div>
            <label className="block text-sm">Primeiro comentário (opcional)<textarea value={firstComment} onChange={e=>setFirstComment(e.target.value)} maxLength={2200} rows={3} placeholder="Comentário enviado após cada reel" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"/><span className="text-xs text-muted-foreground">Aplicado aos novos posts. A fila já criada permanece como está.</span></label>
        {activeTab === 1 && (
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} placeholder="Escreva a legenda 1 (usada nos posts 1-6, 19-24, etc...)" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20" />
            )}
            {activeTab === 2 && (
              <textarea value={caption2} onChange={(e) => setCaption2(e.target.value)} rows={4} placeholder="Escreva a legenda 2 (usada nos posts 7-12, 25-30, etc... Deixe em branco se não quiser rodízio)" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20" />
            )}
            {activeTab === 3 && (
              <textarea value={caption3} onChange={(e) => setCaption3(e.target.value)} rows={4} placeholder="Escreva a legenda 3 (usada nos posts 13-18, 31-36, etc... Deixe em branco se não quiser rodízio)" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20" />
            )}
          </div>

          <CoverPicker value={coverId} onChange={setCoverId} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={manualOrder} disabled /> Ordem dos vídeos obrigatória — selecione os vídeos e ajuste pelas setas
          </label>
          {manualOrder && <VideoOrderList items={selectedVideos.map(id => ({ id, label: videos.find(v => v.id === id)?.file_name ?? id }))}
            onChange={setSelectedVideos} />}


          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">Vídeos ({selectedVideos.length} selecionados no total · {filteredVideos.length} nesta aba)</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const ids = filteredVideos.map((v) => v.id);
                    const allSelected = ids.length > 0 && ids.every((id) => selectedVideos.includes(id));
                    setSelectedVideos((prev) => allSelected ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])));
                  }}
                  className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                >
                  {filteredVideos.length > 0 && filteredVideos.every((v) => selectedVideos.includes(v.id)) ? "Desmarcar todos" : "Selecionar todos"}
                </button>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." className="rounded border border-input bg-background pl-7 pr-2 py-1 text-xs" />
                </div>
              </div>
            </div>
            <p className="mb-2 text-sm">Publicação: @{accounts.find(a => a.id === accountId)?.username ?? "conta deste pool"}</p>
            <VideoSourceTabs accounts={accounts} value={videoSource} onChange={setVideoSource} />
            {videoError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os vídeos da biblioteca. Confira a conexão e a atualização SQL.</p> : loadingVideos ? <p>Carregando vídeos…</p> : filteredVideos.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Nenhum vídeo nesta aba ou busca. Escolha outra conta ou Todas.</p>
            ) : (
              <PoolVideoPicker videos={filteredVideos} selected={selectedVideos}
                onToggle={id => setSelectedVideos(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 shrink-0 border-t border-border p-4">
          <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-muted">Cancelar</button>
          <GradientButton onClick={() => create.mutate()} disabled={!canSubmit}>
            {create.isPending ? "Criando..." : "Criar pool"}
          </GradientButton>
        </div>
      </div>
    </div>
  );
}

function AddVideosDialog({ poolId, accountId, accounts, existingIds, onClose }: { poolId: string; accountId: string; accounts: Account[]; existingIds: string[]; onClose: () => void }) {
  const [videoSource, setVideoSource] = useState("all");
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const { data: videos = [], isLoading: loadingVideos, error: videoError } = useQuery({
    queryKey: ["media-videos-selectable", "shared"],
    enabled: Boolean(accountId),
    queryFn: () => loadPoolLibrary(supabase),
  });
  const available = videos.filter((v) => !existingIds.includes(v.id));
  const filtered = filterPoolVideos(available, videoSource, search);
  const addFn = useServerFn(addPoolVideos);
  const add = useMutation({
    mutationFn: async () => await addFn({ data: { pool_id: poolId, video_ids: selected } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pool-videos", poolId] }); toast.success("Vídeos adicionados"); onClose(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-display text-lg font-semibold">Adicionar vídeos</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." className="rounded border border-input bg-background pl-7 pr-2 py-1 text-xs" />
            </div>
            <button onClick={onClose} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-sm">Publicação: @{accounts.find(a => a.id === accountId)?.username ?? "conta deste pool"}</p>
          <VideoSourceTabs accounts={accounts} value={videoSource} onChange={setVideoSource} />
          {videoError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os vídeos da biblioteca. Confira a conexão e a atualização SQL.</p> : loadingVideos ? <p>Carregando vídeos…</p> : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum vídeo novo nesta aba ou busca. Escolha outra conta ou Todas.</p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{selected.length} selecionados no total · {filtered.length} nesta aba</span>
                <button
                  type="button"
                  onClick={() => {
                    const ids = filtered.map((v) => v.id);
                    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
                    setSelected((prev) => allSelected ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])));
                  }}
                  className="rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                >
                  {filtered.length > 0 && filtered.every((v) => selected.includes(v.id)) ? "Desmarcar todos" : "Selecionar todos"}
                </button>
              </div>
              <PoolVideoPicker videos={filtered} selected={selected}
                onToggle={id => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 shrink-0 border-t border-border p-4">
          <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-muted">Cancelar</button>
          <GradientButton onClick={() => add.mutate()} disabled={selected.length === 0 || add.isPending || loadingVideos || Boolean(videoError)}>
            Adicionar {selected.length > 0 && `(${selected.length})`}
          </GradientButton>
        </div>
      </div>
    </div>
  );
}

function PoolOrderEditor({ pool, items }: { pool: Pool; items: { id: string; label: string; consumed: boolean }[] }) {
  const qc = useQueryClient();
  const manual = true;
  const [ids, setIds] = useState(items.map(item => item.id));
  const saveFn = useServerFn(savePoolVideoOrder);
  const save = useMutation({
    mutationFn: () => saveFn({ data: { poolId: pool.id, ids, manual } }),
    onSuccess: () => {
      toast.success("Ordem salva para os próximos lotes");
      qc.invalidateQueries({ queryKey: ["pool-videos", pool.id] });
      qc.invalidateQueries({ queryKey: ["media-pools"] });
    },
    onError: e => toast.error(e instanceof Error ? e.message : "Falha ao salvar ordem"),
  });
  const disabled = pool.status !== "paused" || save.isPending;
  return <div className="space-y-2 border-t border-border p-4">
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={manual} disabled /> Ordem dos vídeos obrigatória
    </label>
    <p className="text-xs text-muted-foreground">{pool.status !== "paused" ? "Pause o pool para editar a ordem. " : ""}Vale para os próximos lotes. Os posts na fila e os vídeos já enfileirados neste ciclo são preservados.</p>
    {manual && <VideoOrderList items={ids.map(id => items.find(item => item.id === id)!)} onChange={setIds} disabled={disabled} />}
    <button onClick={() => save.mutate()} disabled={disabled} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40">{save.isPending ? "Salvando…" : "Salvar ordem"}</button>
  </div>;
}

