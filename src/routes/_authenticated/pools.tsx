import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState, GradientButton } from "@/components/app/page";
import {
  Repeat, Plus, Play, Pause, Trash2, Film, Send, X, Clock, ChevronDown, ChevronUp,
  Search, ExternalLink, CheckCircle2, AlertCircle, Loader2, MessageSquare, Lock,
  ArrowUpRight, AlertTriangle
} from "lucide-react";
import { useMemo, useState, useRef } from "react";
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
      qc.invalidateQueries({ queryKey: ["pools-header-stats"] });
      toast.success(r.action === "enqueued" ? "Lote enfileirado!" : `Ação: ${r.action}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const { data: headerStats } = useQuery({
    queryKey: ["pools-header-stats"],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [todayRes, queueRes] = await Promise.all([
        supabase
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("status", "published")
          .gte("published_at", todayStart.toISOString()),
        supabase
          .from("scheduled_posts")
          .select("id", { count: "exact", head: true })
          .eq("status", "scheduled"),
      ]);
      return {
        publishedToday: todayRes.count ?? 0,
        queueCount: queueRes.count ?? 0,
      };
    },
    refetchInterval: 30_000,
  });

  const [confirmRunId, setConfirmRunId] = useState<string | null>(null);
  const confirmTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleRunNowClick = (poolId: string) => {
    if (confirmRunId === poolId) {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      setConfirmRunId(null);
      runNow.mutate(poolId);
    } else {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      setConfirmRunId(poolId);
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmRunId(null);
      }, 3500);
    }
  };

  const activePools = filtered.filter(
    (p) => p.status === "active" && !accountsMap[p.ig_account_id]?.is_restricted
  );
  const inactivePools = filtered.filter(
    (p) => p.status !== "active" || !!accountsMap[p.ig_account_id]?.is_restricted
  );

  const activeAccountsCount = accounts.filter((a) => !a.is_restricted).length;
  const suspendedAccountsCount = accounts.filter((a) => !!a.is_restricted).length;
  const totalPublishedReels = pools.reduce((sum, p) => sum + (p.reels_published || 0), 0);
  const totalLimitReels = pools.reduce((sum, p) => sum + (p.reel_limit || 30), 0);

  const renderPoolCard = (p: Pool) => {
    const acc = accountsMap[p.ig_account_id];
    const counts = videoCounts[p.id] ?? { total: 0, pending: 0 };
    const expanded = expandedPool === p.id;
    const isSuspended = !!acc?.is_restricted;
    const isLimitReached = Math.max(p.reels_reserved ?? 0, p.reels_published) >= (p.reel_limit ?? 30);
    const isConfirming = confirmRunId === p.id;

    return (
      <div key={p.id} className="card-elevated overflow-hidden border border-neutral-200/90 rounded-2xl bg-white shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display text-lg font-bold text-neutral-900 truncate">{p.name}</h3>

              {/* Badges de Status com Cores Harmoniosas */}
              {isSuspended ? (
                <span className="rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-[10.5px] font-bold text-rose-700">
                  🚨 Suspensa
                </span>
              ) : p.status === "active" ? (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                  ● Ativo
                </span>
              ) : isLimitReached ? (
                <span className="rounded-full border border-neutral-300 bg-neutral-100 px-2.5 py-0.5 text-[10.5px] font-semibold text-neutral-700">
                  🏁 Concluído
                </span>
              ) : (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10.5px] font-semibold text-amber-700">
                  ⏸️ Pausado
                </span>
              )}

              {isSuspended && (
                <span className="rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[9.5px] font-bold text-rose-800 uppercase tracking-wider">
                  Circuit Breaker
                </span>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500 font-medium">
              <span className={isSuspended ? "text-rose-600 font-bold" : "text-neutral-800 font-semibold"}>
                @{acc?.username ?? "?"}
              </span>
              <span>Lote: {p.batch_size} reels{p.first_batch_size != null && p.batches_published === 0 ? ` · Primeiro: ${p.first_batch_size}` : ""}</span>
              <span>Intervalo: {p.interval_minutes} min</span>
              <span>Fila: {counts.pending}/{counts.total} restantes no ciclo #{p.cycle_number}</span>
              <span>Total do pool: {Math.max(p.reels_reserved ?? 0, p.reels_published)}/{p.reel_limit ?? 30} reels · {p.batches_published} lotes</span>
            </div>

            <div className="mt-1 text-xs text-neutral-500">
              {p.status === "active" && p.next_batch_at && !isSuspended ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <Clock className="h-3 w-3" /> Próximo lote {formatDistanceToNow(new Date(p.next_batch_at), { locale: ptBR, addSuffix: true })} ({format(new Date(p.next_batch_at), "dd/MM HH:mm")})
                </span>
              ) : isSuspended ? (
                <span className="text-rose-600 font-medium">Pool travado — conta com restrição na Meta</span>
              ) : (
                <span>Pausado — retome para agendar o próximo lote</span>
              )}
            </div>

            {/* Alerta Destacado se Conta Suspensa */}
            {isSuspended && (
              <div className="mt-2.5 rounded-xl border border-rose-200 bg-rose-50/70 p-2.5 text-xs text-rose-800 flex items-start gap-2">
                <span className="text-base leading-none shrink-0">🚨</span>
                <div>
                  <p className="font-semibold">Conta restrita ou suspensa pela Meta</p>
                  <p className="text-[11px] text-rose-700 mt-0.5">
                    Para blindar seu Meta App ID, os disparos automáticos e manuais deste pool foram bloqueados pelo Circuit Breaker.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Botão Rodar Agora com Proteção de Missclick */}
            <button
              onClick={() => handleRunNowClick(p.id)}
              disabled={isSuspended || runNow.isPending || counts.total === 0}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                isConfirming
                  ? "bg-amber-50 border border-amber-400 text-amber-900 hover:bg-amber-100 animate-pulse"
                  : "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
              }`}
              title={
                isSuspended
                  ? "Conta suspensa pela Meta — disparo bloqueado"
                  : isConfirming
                  ? "Clique novamente para confirmar envio"
                  : "Enfileirar próximo lote agora"
              }
            >
              <Send className={`h-3.5 w-3.5 ${isConfirming ? "text-amber-600" : "text-neutral-600"}`} />
              {isConfirming ? "Confirmar envio de lote?" : "Rodar agora"}
            </button>

            <button
              onClick={() => toggleStatus.mutate(p)}
              disabled={isSuspended && p.status === "paused"}
              className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
              title={isSuspended ? "Conta suspensa pela Meta" : p.status === "active" ? "Pausar pool" : "Retomar pool"}
            >
              {p.status === "active" ? <><Pause className="h-3.5 w-3.5" /> Pausar</> : <><Play className="h-3.5 w-3.5" /> Retomar</>}
            </button>
            <button
              onClick={() => { if (confirm(`Excluir "${p.name}"? Os posts já agendados continuam na fila.`)) del.mutate(p.id); }}
              className="rounded-xl border border-neutral-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 shadow-xs"
              title="Excluir pool"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setExpandedPool(expanded ? null : p.id)}
              className="rounded-xl border border-neutral-200 bg-white p-1.5 text-neutral-600 hover:bg-neutral-50 shadow-xs"
              title="Detalhes do pool"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        {p.caption && (
          <div className="border-t border-neutral-100 bg-neutral-50/60 px-4 py-2 text-xs text-neutral-600 line-clamp-2">
            <span className="font-semibold text-neutral-800">Legenda:</span> {p.caption}
          </div>
        )}
        {expanded && <PoolDetail pool={p} accounts={accounts} />}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Pools de Rotação"
        description="Gestão de publicação contínua em lotes e rotação circular de Reels"
      />
      <PageBody>
        {/* CONTADORES MINIMALISTAS E TRANSLÚCIDOS (GLASS CLEAN) */}
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card 1: Reels Postados */}
          <div className="relative overflow-hidden rounded-2xl border border-neutral-200/80 bg-white/75 p-4.5 shadow-xs backdrop-blur-md transition-all hover:bg-white/95 hover:border-neutral-300 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-semibold text-neutral-500">
              <span className="flex items-center gap-1.5 uppercase tracking-wider">
                <Film className="h-3.5 w-3.5 text-neutral-600" /> Reels Postados
              </span>
              <span className="rounded-full bg-neutral-100 border border-neutral-200/80 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                Hoje
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold tracking-tight text-neutral-900">
                {headerStats?.publishedToday ?? 0}
              </span>
              <span className="text-xs font-medium text-neutral-500">reels publicados</span>
            </div>
            <div className="mt-2 text-[11px] text-neutral-400 font-medium">
              Ciclo dos pools: {totalPublishedReels}/{totalLimitReels} reels
            </div>
          </div>

          {/* Card 2: Contas Ativas (Verde) */}
          <div className="relative overflow-hidden rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-4.5 shadow-xs backdrop-blur-md transition-all hover:bg-emerald-50/70 hover:border-emerald-300 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-700">
              <span className="flex items-center gap-1.5 uppercase tracking-wider">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Contas Ativas
              </span>
              <span className="rounded-full bg-emerald-100/80 border border-emerald-300 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                Online
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold tracking-tight text-emerald-600">
                {activeAccountsCount}
              </span>
              <span className="text-xs font-medium text-emerald-700/80">contas conectadas</span>
            </div>
            <div className="mt-2 text-[11px] text-emerald-600 font-medium">
              {pools.filter((p) => p.status === "active").length} pools operando normalmente
            </div>
          </div>

          {/* Card 3: Contas Caídas / Suspensas (Vermelho) */}
          <div className={`relative overflow-hidden rounded-2xl border p-4.5 shadow-xs backdrop-blur-md transition-all flex flex-col justify-between ${
            suspendedAccountsCount > 0
              ? "border-rose-300 bg-rose-50/50 hover:bg-rose-50/80"
              : "border-neutral-200/80 bg-white/75 hover:bg-white/95"
          }`}>
            <div className={`flex items-center justify-between text-xs font-semibold ${
              suspendedAccountsCount > 0 ? "text-rose-700" : "text-neutral-500"
            }`}>
              <span className="flex items-center gap-1.5 uppercase tracking-wider">
                <AlertTriangle className={`h-3.5 w-3.5 ${suspendedAccountsCount > 0 ? "text-rose-600" : "text-neutral-400"}`} /> Contas Suspensas
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                suspendedAccountsCount > 0
                  ? "bg-rose-100 border border-rose-300 text-rose-800"
                  : "bg-neutral-100 border border-neutral-200/80 text-neutral-500"
              }`}>
                {suspendedAccountsCount > 0 ? "Alerta Meta" : "Estável"}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className={`font-mono text-3xl font-extrabold tracking-tight ${
                suspendedAccountsCount > 0 ? "text-rose-600" : "text-neutral-400"
              }`}>
                {suspendedAccountsCount}
              </span>
              <span className="text-xs font-medium text-neutral-500">contas restritas</span>
            </div>
            <div className="mt-2 text-[11px] text-neutral-400 font-medium">
              {suspendedAccountsCount > 0
                ? "Circuit Breaker ativado para blindagem"
                : "Zero bloqueios ou restrições"}
            </div>
          </div>

          {/* Card 4: Atalho para a Fila */}
          <Link
            to="/queue"
            className="group relative overflow-hidden rounded-2xl border border-neutral-200/80 bg-white/75 p-4.5 shadow-xs backdrop-blur-md transition-all hover:bg-white hover:border-[#E5B842] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-neutral-500 group-hover:text-neutral-900 transition-colors">
              <span className="flex items-center gap-1.5 uppercase tracking-wider">
                <Clock className="h-3.5 w-3.5 text-neutral-500 group-hover:text-[#D97706]" /> Fila de Postagem
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400 group-hover:text-neutral-900 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold tracking-tight text-neutral-900 group-hover:text-[#D97706] transition-colors">
                {headerStats?.queueCount ?? 0}
              </span>
              <span className="text-xs font-medium text-neutral-500">reels na fila</span>
            </div>
            <div className="mt-2 text-[11px] text-neutral-400 font-medium group-hover:text-neutral-600 transition-colors">
              Ver agendamentos em tempo real →
            </div>
          </Link>
        </div>

        {/* Barra de Filtros & Ações (com botão Novo Pool descido para abrir espaço no topo) */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-neutral-200 shadow-xs">
          {/* Filtro por conta */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setAccountFilter("all")}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                accountFilter === "all"
                  ? "bg-[#09090B] text-white shadow-xs"
                  : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
              }`}
            >
              Todas as contas <span className="rounded-full bg-neutral-200/80 px-1.5 py-0.5 text-[10px] text-neutral-800">{pools.length}</span>
            </button>
            {accounts.map((a) => {
              const count = pools.filter((p) => p.ig_account_id === a.id).length;
              if (count === 0) return null;
              const active = accountFilter === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAccountFilter(a.id)}
                  className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-[#09090B] text-white shadow-xs"
                      : "border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                  }`}
                >
                  @{a.username} <span className="rounded-full bg-neutral-200/80 px-1.5 py-0.5 text-[10px] text-neutral-800">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Botão Novo Pool Descendo para abrir espaço no topo */}
          <GradientButton onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Novo pool
          </GradientButton>
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
          <div className="space-y-6">
            {/* SEÇÃO 1: POOLS ATIVOS EM ANDAMENTO */}
            {activePools.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                    Pools Ativos em Andamento ({activePools.length})
                  </h4>
                </div>
                <div className="space-y-3">
                  {activePools.map(renderPoolCard)}
                </div>
              </div>
            )}

            {/* LINHA DIVISÓRIA SEPARADORA ("LINHA TIPO ATIVAS") */}
            {activePools.length > 0 && inactivePools.length > 0 && (
              <div className="relative py-3">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-neutral-300/80" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-background px-4 text-xs font-bold uppercase tracking-wider text-neutral-500">
                    Pools Pausados ou Concluídos ({inactivePools.length})
                  </span>
                </div>
              </div>
            )}

            {/* SEÇÃO 2: POOLS PAUSADOS OU CONCLUÍDOS */}
            {inactivePools.length > 0 && (
              <div className="space-y-3">
                {activePools.length === 0 && (
                  <div className="flex items-center gap-2 px-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                      Pools Pausados ou Concluídos ({inactivePools.length})
                    </h4>
                  </div>
                )}
                <div className="space-y-3">
                  {inactivePools.map(renderPoolCard)}
                </div>
              </div>
            )}
          </div>
        )}
      </PageBody>

      {showCreate && <CreatePoolDialog accounts={accounts} existingPools={pools} onClose={() => setShowCreate(false)} />}
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

function CoverPicker({ value, onChange, required = false }: { value: string | null; onChange: (id: string | null) => void; required?: boolean }) {
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
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-neutral-800">Capa fixa dos Reels</span>
          {required && <span className="text-xs font-bold text-red-500">* (Obrigatória)</span>}
          {value ? (
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">
              ✓ Capa selecionada
            </span>
          ) : required ? (
            <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10.5px] font-medium text-amber-700">
              Escolha uma capa abaixo
            </span>
          ) : null}
        </div>
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
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-emerald-300/80 bg-emerald-50/40 p-2.5">
          <AssetImage storagePath={selected.storage_path} publicUrl={selected.public_url} alt={selected.file_name} className="h-12 w-12 rounded-lg object-cover shadow-xs border border-emerald-200" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-neutral-900 truncate block">Capa: {selected.file_name}</span>
            <span className="text-[11px] text-emerald-700">Esta imagem será a capa fixa de todos os vídeos deste pool.</span>
          </div>
          <button type="button" onClick={() => onChange(null)} className="rounded px-2 py-1 text-xs font-medium text-neutral-500 hover:text-red-600 hover:bg-red-50 transition-colors">
            Trocar
          </button>
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

function CreatePoolDialog({ accounts, existingPools = [], onClose }: { accounts: Account[]; existingPools?: Pool[]; onClose: () => void }) {
  const qc = useQueryClient();

  // Contas com pool existente
  const usedAccountIds = useMemo(() => new Set(existingPools.map((p) => p.ig_account_id)), [existingPools]);
  const availableAccounts = useMemo(() => accounts.filter((a) => !usedAccountIds.has(a.id)), [accounts, usedAccountIds]);

  // Próximo número sequencial para o nome do pool
  const nextPoolNumber = useMemo(() => {
    const numbers = existingPools
      .map((p) => {
        const match = p.name.match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
      })
      .filter((n): n is number => n !== null && !isNaN(n));
    return numbers.length > 0 ? Math.max(...numbers) + 1 : existingPools.length + 1;
  }, [existingPools]);

  const defaultName = `Pool ${nextPoolNumber}`;
  const [name] = useState(defaultName);

  // Seleciona a primeira conta disponível que ainda não tem pool
  const [accountId, setAccountId] = useState(() => availableAccounts[0]?.id ?? accounts[0]?.id ?? "");

  const [videoSource, setVideoSource] = useState("all");
  const [firstComment, setFirstComment] = useState("");
  const [showCommentToggle, setShowCommentToggle] = useState(false);
  const [showAdvancedTiming, setShowAdvancedTiming] = useState(false);
  const [showOrderEditor, setShowOrderEditor] = useState(false);

  const [caption, setCaption] = useState("");
  const [caption2, setCaption2] = useState("");
  const [caption3, setCaption3] = useState("");
  const [activeTab, setActiveTab] = useState<1 | 2 | 3>(1);

  // Novos padrões: 30 reels de limite, 5 no primeiro lote, 5 nos lotes seguintes, 60m intervalo, 60s espaço
  const [batch, setBatch] = useState(5);
  const [interval, setInterval] = useState(60);
  const [spacing, setSpacing] = useState(60);
  const [reelLimit, setReelLimit] = useState(30);
  const [firstBatch, setFirstBatch] = useState<number | "">(5);

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
    mutationFn: async () =>
      await createFn({
        data: {
          ig_account_id: accountId,
          name,
          first_comment: firstComment.trim() || undefined,
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
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-pools"] });
      toast.success("Pool criado com sucesso!");
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro ao criar pool"),
  });

  const hasName = Boolean(name.trim());
  const hasValidAccount = Boolean(accountId && !usedAccountIds.has(accountId));
  const hasVideos = selectedVideos.length > 0;
  const hasCaption = Boolean(caption.trim());
  const hasCover = Boolean(coverId);

  const canSubmit =
    hasName &&
    hasValidAccount &&
    hasVideos &&
    hasCaption &&
    hasCover &&
    !create.isPending &&
    !loadingVideos &&
    !videoError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 bg-white">
          <div>
            <h2 className="font-display text-lg font-bold text-neutral-900">Novo Pool de Rotação</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Configure a automação contínua de Reels para uma conta do Instagram.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Top Grid: Nome Bloqueado & Conta Que Publica */}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-neutral-800">Nome do pool</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500">
                  <Lock className="h-3 w-3" /> Gerado automaticamente
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={name}
                  readOnly
                  disabled
                  tabIndex={-1}
                  className="w-full cursor-not-allowed select-none rounded-xl border border-neutral-200 bg-neutral-100/90 px-3.5 py-2.5 text-sm font-semibold text-neutral-800 shadow-xs focus:outline-none"
                />
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">
                Identificador sequencial travado pelo sistema para organização e rastreamento.
              </p>
            </label>

            <label className="block">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-neutral-800">Conta que publica</span>
                <span className="text-[11px] font-medium text-neutral-500">
                  {availableAccounts.length} {availableAccounts.length === 1 ? "disponível" : "disponíveis"}
                </span>
              </div>
              <select
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setVideoSource("all");
                  setSelectedVideos([]);
                }}
                className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm font-medium text-neutral-900 shadow-xs focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
              >
                <optgroup label="─── Contas Disponíveis (Sem pool) ───">
                  {accounts
                    .filter((a) => !usedAccountIds.has(a.id) && !a.is_restricted)
                    .map((a) => (
                      <option key={a.id} value={a.id} className="text-neutral-900">
                        @{a.username} (Livre)
                      </option>
                    ))}
                </optgroup>
                {accounts.some((a) => usedAccountIds.has(a.id) || a.is_restricted) && (
                  <optgroup label="─── Contas Ocupadas ou Restritas ───">
                    {accounts
                      .filter((a) => usedAccountIds.has(a.id) || a.is_restricted)
                      .map((a) => (
                        <option
                          key={a.id}
                          value={a.id}
                          disabled
                          className="text-neutral-400 bg-neutral-50"
                        >
                          @{a.username} {a.is_restricted ? "(Conta suspensa)" : "(Já possui pool ativo)"}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
              {availableAccounts.length === 0 ? (
                <p className="mt-1 text-xs font-semibold text-amber-600">
                  ⚠️ Todas as contas já possuem pool criado. Conecte uma nova conta ou pause/exclua um pool para liberar.
                </p>
              ) : usedAccountIds.has(accountId) ? (
                <p className="mt-1 text-xs font-medium text-amber-600">
                  Esta conta já possui um pool ativo. Escolha outra conta acima.
                </p>
              ) : null}
            </label>
          </div>

          {/* Toggle de Ritmo e Limites (fechado por padrão, substitui o card longo) */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3">
            <button
              type="button"
              onClick={() => setShowAdvancedTiming((v) => !v)}
              className="flex w-full items-center justify-between text-left text-xs font-semibold text-neutral-700 hover:text-neutral-900 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-neutral-500" />
                <span>Configurações de ritmo e limite</span>
                <span className="rounded-full bg-neutral-200/80 px-2 py-0.5 text-[10.5px] font-medium text-neutral-700">
                  {reelLimit} reels · 1º lote: {firstBatch || batch} · Lotes: {batch} · {interval}min
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-medium text-neutral-500">
                <span>{showAdvancedTiming ? "Ocultar" : "Personalizar"}</span>
                {showAdvancedTiming ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </div>
            </button>

            {showAdvancedTiming && (
              <div className="mt-3.5 space-y-3 pt-3 border-t border-neutral-200/80">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">Limite total de reels</span>
                    <input
                      type="number"
                      min={1}
                      value={reelLimit}
                      onChange={(e) => setReelLimit(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                    />
                    <p className="mt-1 text-[11px] text-neutral-500">Pool pausa automaticamente ao atingir este total.</p>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">Primeiro lote (reels, 1ª vez)</span>
                    <input
                      type="number"
                      min={1}
                      value={firstBatch}
                      placeholder="5"
                      onChange={(e) => setFirstBatch(e.target.value === "" ? "" : Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                    />
                    <p className="mt-1 text-[11px] text-neutral-500">Quantidade de reels postados no primeiro disparo.</p>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">Lotes seguintes</span>
                    <input
                      type="number"
                      min={1}
                      value={batch}
                      onChange={(e) => setBatch(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">Intervalo (minutos)</span>
                    <input
                      type="number"
                      min={5}
                      value={interval}
                      onChange={(e) => setInterval(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-neutral-700">Espaço (segundos)</span>
                    <input
                      type="number"
                      min={0}
                      max={1800}
                      value={spacing}
                      onChange={(e) => setSpacing(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Legendas dos Reels (OBRIGATÓRIA) */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider">Legenda dos Reels</span>
                <span className="text-xs font-bold text-red-500">* (Obrigatória)</span>
                <span className="text-[11px] text-neutral-500">· Gira a cada {batch} Reels</span>
              </div>
              <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5 text-[11px] font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab(1)}
                  className={`rounded-md px-2.5 py-1 transition ${
                    activeTab === 1 ? "bg-white text-neutral-900 shadow-xs font-semibold" : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  Legenda 1 *
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(2)}
                  className={`rounded-md px-2.5 py-1 transition ${
                    activeTab === 2 ? "bg-white text-neutral-900 shadow-xs font-semibold" : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  Legenda 2
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(3)}
                  className={`rounded-md px-2.5 py-1 transition ${
                    activeTab === 3 ? "bg-white text-neutral-900 shadow-xs font-semibold" : "text-neutral-600 hover:text-neutral-900"
                  }`}
                >
                  Legenda 3
                </button>
              </div>
            </div>

            {activeTab === 1 && (
              <div>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={4}
                  placeholder={`Escreva a legenda obrigatória dos Reels (usada nos posts 1-${batch}, ${batch * 3 + 1}-${batch * 4}, etc...)`}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                />
                {!caption.trim() && (
                  <p className="mt-1 text-[11px] text-amber-600 font-medium">
                    ⚠️ A Legenda 1 é obrigatória para a publicação dos reels.
                  </p>
                )}
              </div>
            )}
            {activeTab === 2 && (
              <textarea
                value={caption2}
                onChange={(e) => setCaption2(e.target.value)}
                rows={4}
                placeholder={`Escreva a legenda 2 (usada nos posts ${batch + 1}-${batch * 2}, etc... Deixe em branco se não quiser rodízio)`}
                className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
              />
            )}
            {activeTab === 3 && (
              <textarea
                value={caption3}
                onChange={(e) => setCaption3(e.target.value)}
                rows={4}
                placeholder={`Escreva a legenda 3 (usada nos posts ${batch * 2 + 1}-${batch * 3}, etc... Deixe em branco se não quiser rodízio)`}
                className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
              />
            )}

            {/* Toggle do Primeiro Comentário (Discreto e recolhido) */}
            <div className="pt-2 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => setShowCommentToggle((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-semibold text-neutral-600 hover:text-neutral-900 py-1 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-neutral-400" />
                  <span>Primeiro comentário automático (opcional)</span>
                  {firstComment.trim() && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      ✓ Comentário ativo
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[11px] font-medium text-neutral-500">
                  <span>{showCommentToggle ? "Recolher" : "Adicionar"}</span>
                  {showCommentToggle ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </div>
              </button>

              {showCommentToggle && (
                <div className="mt-2.5 pt-2 border-t border-neutral-200/80">
                  <textarea
                    value={firstComment}
                    onChange={(e) => setFirstComment(e.target.value)}
                    maxLength={2200}
                    rows={3}
                    placeholder="Escreva o comentário enviado logo após cada reel ser publicado..."
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                  />
                  <span className="mt-1 block text-[11px] text-neutral-500">
                    Opcional. Postado automaticamente pela conta logo após o vídeo entrar no ar.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Capa Obrigatória */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <CoverPicker value={coverId} onChange={setCoverId} required />
          </div>

          {/* Ordem dos vídeos (fechado por padrão para não poluir a tela) */}
          {selectedVideos.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
              <button
                type="button"
                onClick={() => setShowOrderEditor((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-semibold text-neutral-700 hover:text-neutral-900 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-neutral-500 font-bold">↕️</span>
                  <span>Ajustar ordem manual dos vídeos (opcional)</span>
                  <span className="rounded-full bg-neutral-200/80 px-2 py-0.5 text-[10.5px] font-medium text-neutral-600">
                    {selectedVideos.length} vídeos ordenados
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-medium text-neutral-500">
                  <span>{showOrderEditor ? "Ocultar" : "Personalizar ordem"}</span>
                  {showOrderEditor ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </div>
              </button>

              {showOrderEditor && (
                <div className="mt-3 pt-3 border-t border-neutral-200 space-y-2">
                  <p className="text-[11px] text-neutral-500">
                    Os vídeos serão publicados nesta ordem (do 1º ao último). Ajuste com as setas apenas se precisar alterar algum vídeo específico.
                  </p>
                  <VideoOrderList
                    items={selectedVideos.map((id) => ({
                      id,
                      label: videos.find((v) => v.id === id)?.file_name ?? id,
                    }))}
                    onChange={setSelectedVideos}
                  />
                </div>
              )}
            </div>
          )}

          {/* Vídeos */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-neutral-800">
                Vídeos ({selectedVideos.length} selecionados no total · {filteredVideos.length} nesta aba)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    // Invertido: do último vídeo para o primeiro!
                    const reversedIds = [...filteredVideos].reverse().map((v) => v.id);
                    const allSelected = reversedIds.length > 0 && reversedIds.every((id) => selectedVideos.includes(id));
                    setSelectedVideos((prev) => {
                      if (allSelected) {
                        return prev.filter((id) => !reversedIds.includes(id));
                      } else {
                        const newIds = reversedIds.filter((id) => !prev.includes(id));
                        return [...prev, ...newIds];
                      }
                    });
                  }}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors shadow-xs"
                >
                  {filteredVideos.length > 0 && filteredVideos.every((v) => selectedVideos.includes(v.id))
                    ? "Desmarcar todos"
                    : "Selecionar todos (do último ao 1º)"}
                </button>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar vídeos..."
                    className="rounded-lg border border-neutral-300 bg-white pl-8 pr-3 py-1.5 text-xs text-neutral-900 shadow-xs focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                  />
                </div>
              </div>
            </div>
            <p className="mb-2 text-xs text-neutral-500 font-medium">
              Publicação na conta: <strong className="text-neutral-800">@{accounts.find((a) => a.id === accountId)?.username ?? "conta selecionada"}</strong>
            </p>
            <VideoSourceTabs accounts={accounts} value={videoSource} onChange={setVideoSource} />
            {videoError ? (
              <p role="alert" className="text-sm text-destructive mt-2">
                Não foi possível carregar os vídeos da biblioteca. Confira a conexão e a atualização SQL.
              </p>
            ) : loadingVideos ? (
              <p className="text-xs text-neutral-500 py-4">Carregando vídeos…</p>
            ) : filteredVideos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-neutral-200 p-6 text-center text-xs text-neutral-500 mt-2">
                Nenhum vídeo nesta aba ou busca. Escolha outra conta ou Todas.
              </p>
            ) : (
              <div className="mt-2">
                <PoolVideoPicker
                  videos={filteredVideos}
                  selected={selectedVideos}
                  onToggle={(id) =>
                    setSelectedVideos((prev) =>
                      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                    )
                  }
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between shrink-0 border-t border-neutral-200 px-6 py-4 bg-neutral-50/50">
          <div className="flex items-center gap-2 text-xs">
            {!hasCover && selectedVideos.length > 0 && (
              <span className="text-amber-700 font-medium bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                ⚠️ Selecione a Capa obrigatória
              </span>
            )}
            {!hasCaption && selectedVideos.length > 0 && (
              <span className="text-amber-700 font-medium bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                ⚠️ Digite a Legenda 1 obrigatória
              </span>
            )}
            {selectedVideos.length === 0 && (
              <span className="text-neutral-500 font-medium">Selecione ao menos 1 vídeo</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors shadow-xs"
            >
              Cancelar
            </button>
            <GradientButton
              onClick={() => {
                if (!hasCover) {
                  toast.error("A seleção de capa é obrigatória para cada pool.");
                  return;
                }
                if (!hasCaption) {
                  toast.error("A Legenda 1 é obrigatória.");
                  return;
                }
                if (!hasValidAccount) {
                  toast.error("Selecione uma conta disponível sem pool ativo.");
                  return;
                }
                if (selectedVideos.length === 0) {
                  toast.error("Selecione ao menos um vídeo para o pool.");
                  return;
                }
                create.mutate();
              }}
              disabled={!canSubmit}
            >
              {create.isPending ? "Criando..." : "Criar pool"}
            </GradientButton>
          </div>
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

