import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { validatePoolVideos } from "./media-account.server";

// Valores padrão; cada pool pode definir seu próprio ritmo.
const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_INTERVAL_MIN = 60;
const DEFAULT_SPACING_SEC = 60;
const ACCOUNT_STAGGER_SEC = 90;

const CreateSchema = z.object({
  reel_limit: z.number().int().min(1).max(2147483647).default(40),
  ig_account_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  first_comment: z.string().max(2200).optional(),
  caption: z.string().max(2200).default(""),
  caption_2: z.string().max(2200).default(""),
  caption_3: z.string().max(2200).default(""),
  batch_size: z.number().int().min(1).optional(),
  interval_minutes: z.number().int().min(5).max(10080).optional(),
  spacing_seconds: z.number().int().min(0).max(1800).optional(),
  first_batch_size: z.number().int().min(1).nullable().default(6),
  video_ids: z.array(z.string().uuid()).min(1),
  manual_order: z.literal(true),
  cover_media_asset_id: z.string().uuid().nullable().optional(),
});

// Calcula um next_batch_at que NÃO colida com nenhum outro pool ativo,
// respeitando um espaçamento mínimo entre contas diferentes.
async function computeStaggeredStart(ownAccountId: string, intervalMinutes: number): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { accountOffsetMinutes } = await import("./pools.server");
  const offsetMin = accountOffsetMinutes(ownAccountId, intervalMinutes);
  const desired = Date.now() + offsetMin * 60_000;

  // Pega horários já reservados por outros pools ativos e posts scheduled recentes.
  const [{ data: pools }, { data: posts }] = await Promise.all([
    supabaseAdmin
      .from("media_pools")
      .select("id, ig_account_id, next_batch_at")
      .eq("status", "active")
      .not("next_batch_at", "is", null),
    supabaseAdmin
      .from("scheduled_posts")
      .select("ig_account_id, scheduled_at")
      .in("status", ["scheduled", "publishing"])
      .gte("scheduled_at", new Date(Date.now() - 5 * 60_000).toISOString())
      .lte("scheduled_at", new Date(Date.now() + 6 * 60 * 60_000).toISOString()),
  ]);
  const busy: number[] = [];
  for (const p of (pools ?? []) as Array<{ ig_account_id: string; next_batch_at: string }>) {
    if (p.ig_account_id === ownAccountId) continue;
    busy.push(new Date(p.next_batch_at).getTime());
  }
  for (const p of (posts ?? []) as Array<{ ig_account_id: string; scheduled_at: string }>) {
    if (p.ig_account_id === ownAccountId) continue;
    busy.push(new Date(p.scheduled_at).getTime());
  }
  busy.sort((a, b) => a - b);

  let candidate = desired;
  const staggerMs = ACCOUNT_STAGGER_SEC * 1000;

  for (const b of busy) {
    if (Math.abs(candidate - b) < staggerMs) {
      candidate = b + staggerMs;
    }
  }
  return new Date(candidate).toISOString();
}

export const createPool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await validatePoolVideos(context.supabase, data.ig_account_id, data.video_ids);
    const batchSize = data.batch_size ?? DEFAULT_BATCH_SIZE;
    const intervalMinutes = data.interval_minutes ?? DEFAULT_INTERVAL_MIN;
    const spacingSeconds = data.spacing_seconds ?? DEFAULT_SPACING_SEC;

    const firstAt = await computeStaggeredStart(data.ig_account_id, intervalMinutes);

    const { data: pool, error } = await context.supabase
      .from("media_pools")
      .insert({
        user_id: context.userId,
        reel_limit: data.reel_limit,
        manual_order: data.manual_order,
        ig_account_id: data.ig_account_id,
        name: data.name,
        ...(data.first_comment?.trim() ? { first_comment: data.first_comment.trim() } : {}),
        caption: data.caption,
        caption_2: data.caption_2,
        caption_3: data.caption_3,
        batch_size: batchSize,
        first_batch_size: data.first_batch_size,
        interval_minutes: intervalMinutes,
        spacing_seconds: spacingSeconds,
        next_batch_at: firstAt,
        cover_media_asset_id: data.cover_media_asset_id ?? null,
      } as never)
      .select("id")
      .single();
    if (error || !pool) throw new Error(error?.message ?? "Falha ao criar pool");

    // Novos pools sempre preservam a ordem selecionada.
    if (data.video_ids.length > 0) {
      const shuffled = data.video_ids;
      const rows = shuffled.map((id, i) => ({
        pool_id: pool.id,
        media_asset_id: id,
        position: i,
      }));
      const { error: vErr } = await context.supabase.from("pool_videos").insert(rows as never);
      if (vErr) throw new Error(vErr.message);
    }
    return { id: pool.id, next_batch_at: firstAt };
  });

const UpdateSchema = z.object({
  reel_limit: z.number().int().min(1).max(2147483647).optional(),
  first_batch_size: z.number().int().min(1).nullable().optional(),
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  first_comment: z.string().max(2200).optional(),
  caption: z.string().max(2200).optional(),
  caption_2: z.string().max(2200).optional(),
  caption_3: z.string().max(2200).optional(),
  batch_size: z.number().int().min(1).optional(),
  interval_minutes: z.number().int().min(5).max(10080).optional(),
  spacing_seconds: z.number().int().min(0).max(1800).optional(),
  status: z.enum(["active", "paused"]).optional(),
  cover_media_asset_id: z.string().uuid().nullable().optional(),
});

export const updatePool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...raw } = data;
    const patch: Record<string, unknown> = {};
    if (raw.reel_limit !== undefined) patch.reel_limit = raw.reel_limit;
    if (raw.first_batch_size !== undefined) {
      const { data: current, error: readError } = await context.supabase.from("media_pools").select("batches_published, status").eq("id", id).single();
      if (readError || !current) throw new Error("Pool não encontrado");
      if (current.batches_published !== 0 || current.status !== "paused") throw new Error("Pause o pool antes do primeiro lote para alterar seu tamanho inicial");
      patch.first_batch_size = raw.first_batch_size;
    }
    if (raw.batch_size !== undefined) patch.batch_size = raw.batch_size;
    if (raw.interval_minutes !== undefined) patch.interval_minutes = raw.interval_minutes;
    if (raw.spacing_seconds !== undefined) patch.spacing_seconds = raw.spacing_seconds;
    if (raw.name !== undefined) patch.name = raw.name;
    if (raw.first_comment !== undefined) patch.first_comment = raw.first_comment.trim() || null;
    if (raw.caption !== undefined) patch.caption = raw.caption;
    if (raw.caption_2 !== undefined) patch.caption_2 = raw.caption_2;
    if (raw.caption_3 !== undefined) patch.caption_3 = raw.caption_3;
    if (raw.status !== undefined) patch.status = raw.status;
    if (raw.cover_media_asset_id !== undefined) patch.cover_media_asset_id = raw.cover_media_asset_id;

    // Se está reativando um pool, recomputa o próximo horário para não colidir com outros.
    if (raw.status === "active") {
      const { data: cur } = await context.supabase
        .from("media_pools")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (Math.max((cur as any)?.reels_reserved ?? 0, cur?.reels_published ?? 0) >= (raw.reel_limit ?? (cur as any)?.reel_limit ?? 40)) throw new Error("Este pool atingiu o limite total de reels configurado");
      const nextAt = cur?.next_batch_at ? new Date(cur.next_batch_at).getTime() : 0;
      if (!nextAt || nextAt <= Date.now()) {
        const intervalVal = raw.interval_minutes ?? cur?.interval_minutes ?? DEFAULT_INTERVAL_MIN;
        patch.next_batch_at = await computeStaggeredStart((cur as any)?.ig_account_id ?? "", intervalVal);
      }
    }

    const { error } = await context.supabase.from("media_pools").update(patch as never).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deletePool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("media_pools").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const AddVideosSchema = z.object({
  pool_id: z.string().uuid(),
  video_ids: z.array(z.string().uuid()).min(1),
});

export const addPoolVideos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AddVideosSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: pool, error: poolError } = await context.supabase.from("media_pools")
      .select("ig_account_id").eq("id", data.pool_id).single();
    if (poolError || !pool) throw new Error("Pool não encontrado");
    await validatePoolVideos(context.supabase, pool.ig_account_id, data.video_ids);
    // pega maior position existente
    const { data: last } = await context.supabase
      .from("pool_videos")
      .select("position")
      .eq("pool_id", data.pool_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    let pos = (last?.position ?? -1) + 1;
    const rows = data.video_ids.map((id) => ({
      pool_id: data.pool_id,
      media_asset_id: id,
      position: pos++,
    }));
    const { error } = await context.supabase
      .from("pool_videos")
      .upsert(rows as never, { onConflict: "pool_id,media_asset_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true as const, added: rows.length };
  });

export const removePoolVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("pool_videos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const runPoolNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Verifica dono
    const { data: pool, error } = await context.supabase
      .from("media_pools")
      .select("id, ig_account_id, last_batch_at")
      .eq("id", data.id)
      .single();
    if (error || !pool) throw new Error("Pool não encontrado");

    // Trava de segurança: impede disparo se a conta estiver suspensa ou restrita
    const { data: acc } = await context.supabase
      .from("instagram_accounts")
      .select("id, is_restricted, is_active")
      .eq("id", pool.ig_account_id)
      .maybeSingle();
    if (acc?.is_restricted || acc?.is_active === false) {
      throw new Error("Esta conta está restrita/suspensa pela Meta. O disparo foi bloqueado pelo Circuit Breaker.");
    }

    // Cooldown de segurança (evita duplo clique acidental gerando 2 lotes seguidos)
    if (pool.last_batch_at) {
      const diffMs = Date.now() - new Date(pool.last_batch_at).getTime();
      if (diffMs < 10_000) {
        throw new Error("Aguarde alguns segundos antes de disparar outro lote para a mesma conta.");
      }
    }

    const { processPoolTick } = await import("./pools.server");
    // Força: zera next_batch_at para agora e processa
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("media_pools").update({ next_batch_at: new Date().toISOString() }).eq("id", data.id);
    const r = await processPoolTick(data.id);
    return { action: r.action };
  });
