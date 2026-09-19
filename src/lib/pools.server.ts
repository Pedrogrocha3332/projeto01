// Server-only: processador de Pools de Rotação de Reels.
// Enfileira lotes em scheduled_posts para o cron de publicação já existente publicar.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeSafePublishSlot } from "@/lib/publish.server";

type Pool = {
  id: string;
  user_id: string;
  ig_account_id: string;
  caption: string;
  manual_order?: boolean;
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

type PoolVideo = {
  id: string;
  pool_id: string;
  media_asset_id: string;
  position: number;
  posted_in_current_cycle: boolean;
  fromPreviousCycle?: boolean;
};

// Offset determinístico por conta (0..intervalMinutes-1 minutos) para
// espalhar disparos de várias contas dentro do mesmo intervalo.
export function accountOffsetMinutes(accountId: string, intervalMinutes: number): number {
  let h = 0;
  for (let i = 0; i < accountId.length; i++) h = (h * 31 + accountId.charCodeAt(i)) | 0;
  const mod = Math.max(1, Math.min(intervalMinutes, 30));
  return Math.abs(h) % mod;
}

async function getPendingVideos(poolId: string): Promise<PoolVideo[]> {
  const { data, error } = await supabaseAdmin
    .from("pool_videos")
    .select("id, pool_id, media_asset_id, position, posted_in_current_cycle")
    .eq("pool_id", poolId)
    .eq("posted_in_current_cycle", false)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PoolVideo[];
}

async function resetCycle(poolId: string, manualOrder = false): Promise<void> {
  if (manualOrder) {
    const { error } = await supabaseAdmin.from("pool_videos")
      .update({ posted_in_current_cycle: false }).eq("pool_id", poolId);
    if (error) throw error;
    return;
  }
  // Reembaralha ordem e libera todos para o próximo ciclo.
  // Garante que o primeiro do novo ciclo seja diferente do último postado.
  const { data: vids } = await supabaseAdmin
    .from("pool_videos")
    .select("id, media_asset_id, last_posted_at")
    .eq("pool_id", poolId);
  const list = (vids ?? []) as Array<{ id: string; media_asset_id: string; last_posted_at: string | null }>;
  if (list.length === 0) return;

  // Descobre qual foi o último vídeo postado (para não ser o primeiro do próximo ciclo)
  const lastPosted = list
    .filter((v) => v.last_posted_at)
    .sort((a, b) => (b.last_posted_at ?? "").localeCompare(a.last_posted_at ?? ""))[0];

  const shuffled = list.slice().sort(() => Math.random() - 0.5);
  if (lastPosted && shuffled.length > 1 && shuffled[0].id === lastPosted.id) {
    // Troca o primeiro por outro para evitar sequência repetida
    const swapIdx = 1 + Math.floor(Math.random() * (shuffled.length - 1));
    [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
  }
  for (let i = 0; i < shuffled.length; i++) {
    await supabaseAdmin
      .from("pool_videos")
      .update({ position: i, posted_in_current_cycle: false })
      .eq("id", shuffled[i].id);
  }
}

async function pickBatch(pool: Pool): Promise<PoolVideo[]> {
  let pending = await getPendingVideos(pool.id);
  const picked: PoolVideo[] = [];
  const remaining = Math.max(0, (pool.reel_limit ?? 40) - Math.max(pool.reels_reserved ?? 0, pool.reels_published ?? 0));
  const N = Math.min(remaining, pool.batches_published === 0 ? (pool.first_batch_size ?? pool.batch_size) : pool.batch_size);
  if (N === 0) return [];

  // Total de vídeos no pool
  const { count: total } = await supabaseAdmin
    .from("pool_videos")
    .select("id", { count: "exact", head: true })
    .eq("pool_id", pool.id);
  const totalVideos = total ?? 0;
  if (totalVideos === 0) return [];

  const takeFromPending = Math.min(pending.length, N);
  picked.push(...pending.slice(0, takeFromPending));

  // Se não conseguiu fechar o lote, reinicia ciclo e completa
  if (picked.length < N) {
    if (pool.manual_order) picked.forEach(v => { v.fromPreviousCycle = true; });
    await resetCycle(pool.id, pool.manual_order);
    // Aumenta cycle_number (será persistido junto com o restante do lote depois)
    pool.cycle_number += 1;
    const remaining = N - picked.length;
    const fresh = await getPendingVideos(pool.id);
    // evita repetir dentro do mesmo lote se totalVideos < N
    const pickedIds = new Set(picked.map((p) => p.media_asset_id));
    for (const v of fresh) {
      if (picked.length >= N) break;
      if (pickedIds.has(v.media_asset_id)) continue;
      picked.push(v);
      pickedIds.add(v.media_asset_id);
    }
    // Se totalVideos < N mesmo assim, retornamos só os únicos disponíveis
    if (picked.length === 0) picked.push(...fresh.slice(0, remaining));
  }

  return picked.slice(0, N);
}

async function enqueueBatch(pool: Pool, videos: PoolVideo[]): Promise<{ scheduled: number; firstAt: string; lastAt: string }> {
  let scheduled = 0;
  const batchNumber = pool.batches_published + 1;
  // Desempata horários de uma ordem manual sem impor espera em segundos.
  const spacingMs = Math.max(pool.manual_order ? 1 : 0, pool.spacing_seconds * 1000);

  // Conta quantos posts já foram agendados/registrados no log deste pool
  const { count } = await supabaseAdmin
    .from("pool_execution_log")
    .select("id", { count: "exact", head: true })
    .eq("pool_id", pool.id);
  const startCount = count ?? 0;

  let cursor = new Date(Math.max(Date.now(), pool.next_batch_at ? new Date(pool.next_batch_at).getTime() : Date.now()));
  let lastIso = cursor.toISOString();
  let firstIso = lastIso;

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const desiredAt = new Date(cursor.getTime() + (i === 0 ? 0 : spacingMs));
    const safe = await computeSafePublishSlot(pool.ig_account_id, desiredAt);
    const scheduledAt = safe.scheduledAt;
    cursor = new Date(scheduledAt);
    if (i === 0) firstIso = scheduledAt;
    lastIso = scheduledAt;

    // Lógica de Rodízio: a cada 6 posts, rotaciona a legenda (1 -> 2 -> 3 -> 1)
    const totalIndex = startCount + i;
    const captionIndex = Math.floor(totalIndex / 6) % 3;
    let selectedCaption = pool.caption;
    if (captionIndex === 1 && pool.caption_2) {
      selectedCaption = pool.caption_2;
    } else if (captionIndex === 2 && pool.caption_3) {
      selectedCaption = pool.caption_3;
    }

    // Cria scheduled_post do tipo Reel
    const { data: post, error: postErr } = await supabaseAdmin
      .from("scheduled_posts")
      .insert({
        user_id: pool.user_id,
        ig_account_id: pool.ig_account_id,
        post_type: "reel",
        caption: selectedCaption,
        scheduled_at: scheduledAt,
        status: "scheduled",
        source_pool_id: pool.id,
        cover_media_id: pool.cover_media_asset_id,
      } as never)
      .select("id")
      .single();
    if (postErr || !post) {
      console.error("[pools] failed to create scheduled_post", postErr?.message);
      break;
    }
    scheduled += 1;

    // Anexa o vídeo
    await supabaseAdmin.from("post_media").insert({
      post_id: post.id,
      media_asset_id: v.media_asset_id,
      position: 0,
    } as never);

    // Log de execução (pending; sucesso/erro será refletido via join com scheduled_posts)
    await supabaseAdmin.from("pool_execution_log").insert({
      pool_id: pool.id,
      ig_account_id: pool.ig_account_id,
      media_asset_id: v.media_asset_id,
      scheduled_post_id: post.id,
      batch_number: batchNumber,
      batch_index: i + 1,
      cycle_number: pool.cycle_number,
      scheduled_at: scheduledAt,
    } as never);

    // Marca vídeo como postado no ciclo
    const { data: cur } = await supabaseAdmin
      .from("pool_videos")
      .select("times_posted")
      .eq("id", v.id)
      .maybeSingle();
    await supabaseAdmin
      .from("pool_videos")
      .update({
        posted_in_current_cycle: !v.fromPreviousCycle,
        times_posted: (cur?.times_posted ?? 0) + 1,
        last_posted_at: new Date().toISOString(),
      })
      .eq("id", v.id);
  }

  return { scheduled, firstAt: firstIso, lastAt: lastIso };
}

/**
 * Processa 1 pool: se está na hora, enfileira o próximo lote.
 * Retorna resumo da ação.
 */
export async function processPoolTick(poolId: string): Promise<{ action: string; details?: unknown }> {
  const { data: pool, error } = await supabaseAdmin
    .from("media_pools")
    .select("*")
    .eq("id", poolId)
    .single<Pool>();
  if (error || !pool) throw new Error(`Pool não encontrado: ${poolId}`);
  if (pool.status !== "active") return { action: "paused" };

  if (Math.max(pool.reels_reserved ?? 0, pool.reels_published) >= (pool.reel_limit ?? 40)) {
    const { error: pauseError } = await supabaseAdmin.from("media_pools").update({ status: "paused", next_batch_at: null }).eq("id", pool.id);
    if (pauseError) throw pauseError;
    return { action: "limit_reached" };
  }

  const now = Date.now();
  const nextAt = pool.next_batch_at ? new Date(pool.next_batch_at).getTime() : now;
  if (nextAt > now) return { action: "not_due", details: { next_batch_at: pool.next_batch_at } };

  const videos = await pickBatch(pool);
  if (videos.length === 0) return { action: "empty_pool" };

  const enqueued = await enqueueBatch(pool, videos);

  if (enqueued.scheduled === 0) return { action: "nothing_enqueued" };
  const limitReached = Math.max(pool.reels_reserved ?? 0, pool.reels_published) + enqueued.scheduled >= (pool.reel_limit ?? 40);

  // Próximo lote = após o último reel enfileirado + intervalo
  const nextBatchMs = new Date(enqueued.lastAt).getTime() + pool.interval_minutes * 60_000;

  await supabaseAdmin
    .from("media_pools")
    .update({
      last_batch_at: new Date().toISOString(),
      next_batch_at: limitReached ? null : new Date(nextBatchMs).toISOString(),
      ...(limitReached ? { status: "paused" } : {}),
      batches_published: pool.batches_published + 1,
      reels_published: pool.reels_published + enqueued.scheduled,
      cycle_number: pool.cycle_number,
    })
    .eq("id", pool.id);

  return { action: "enqueued", details: enqueued };
}

/**
 * Varre todos os pools ativos que estão vencidos e processa cada um.
 */
export async function processAllDuePools(): Promise<{ processed: number; results: Array<{ pool_id: string; action: string; error?: string }> }> {
  const nowIso = new Date().toISOString();
  const { data: pools, error } = await supabaseAdmin
    .from("media_pools")
    .select("id")
    .eq("status", "active")
    .or(`next_batch_at.is.null,next_batch_at.lte.${nowIso}`)
    .limit(100);
  if (error) throw error;

  const results: Array<{ pool_id: string; action: string; error?: string }> = [];
  for (const p of pools ?? []) {
    try {
      const r = await processPoolTick(p.id);
      results.push({ pool_id: p.id, action: r.action });
    } catch (e) {
      results.push({ pool_id: p.id, action: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { processed: results.length, results };
}
