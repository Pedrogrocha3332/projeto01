// Instagram Graph API publishing engine (server-only, uses service role).
// Steps per Meta docs:
// 1. Create container: POST /{ig-user-id}/media
// 2. Poll status until FINISHED (Reels/video require this)
// 3. Publish container: POST /{ig-user-id}/media_publish
// For carousels: create child containers first, then a parent with children=..., then publish.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH = "https://graph.instagram.com/v21.0";
// Instagram Business Login uses graph.instagram.com; page-token flow uses graph.facebook.com.
// The account.access_token here is an IG user access token from /oauth/access_token.

type PostRow = {
  id: string;
  round_run_id?: string | null;
  user_id: string;
  ig_account_id: string;
  post_type: "image" | "carousel" | "reel";
  status: string;
  caption: string;
  first_comment: string | null;
  cover_url: string | null;
  cover_media_id: string | null;
  thumbnail_offset: number | null;
  scheduled_at: string;
  interval_minutes: number | null;
  recurrence: string | null;
  ig_container_id: string | null;
};

type MediaRow = {
  position: number;
  media_assets: {
    storage_path: string;
    public_url: string;
    media_kind: "image" | "video";
  } | null;
};

type LoadedPost = {
  post: PostRow;
  account: { ig_user_id: string; access_token: string; username?: string | null };
  items: MediaRow[];
};

class ContainerStillProcessing extends Error {
  constructor(message = "Mídia ainda está sendo processada pelo Instagram") {
    super(message);
    this.name = "ContainerStillProcessing";
  }
}

// Backoff aplicado somente após uma resposta de rate-limit da Meta.
const RATE_LIMIT_RETRY_GAP_MS = 60 * 60_000;
// Espaçamento GLOBAL entre contas diferentes: evita rajadas de chamadas na API.
const GLOBAL_START_GAP_MS = 5_000; // 5 segundos
// Janela em que consideramos duas contas "colidindo" no mesmo horário — se
// caírem dentro desse raio, empurramos a mais nova em 10–30 seg.
const CROSS_ACCOUNT_COLLISION_MS = 5_000; // 5 segundos
const CROSS_ACCOUNT_JITTER_MIN_MS = 10_000; // 10 segundos
const CROSS_ACCOUNT_JITTER_MAX_MS = 30_000; // 30 segundos
const RATE_LIMIT_COOLDOWN_MS = 90 * 60_000;
// Tolerância: se o slot seguro estiver a menos disso do "agora", publica já.
const IMMEDIATE_TOLERANCE_MS = 60_000;

function accountJitterMs(igAccountId: string): number {
  let h = 0;
  for (let i = 0; i < igAccountId.length; i++) h = (h * 31 + igAccountId.charCodeAt(i)) | 0;
  const range = CROSS_ACCOUNT_JITTER_MAX_MS - CROSS_ACCOUNT_JITTER_MIN_MS;
  return CROSS_ACCOUNT_JITTER_MIN_MS + (Math.abs(h) % (range + 1));
}

export type SafePublishSlot = {
  scheduledAt: string;
  delayed: boolean;
  reason?: string;
};

function isTooManyActions(message: string | null | undefined) {
  return /user is performing too many actions|performing too many|too many actions|application request limit|please reduce|rate.?limit|too many requests|429/i.test(message ?? "");
}

// Calcula o próximo horário seguro considerando SOMENTE posts anteriores
// (já publicados ou agendados para antes deste). Nunca empurra este post
// para frente por causa de posts futuros — quem tem que se ajustar é o mais novo.
export async function computeSafePublishSlot(
  igAccountId: string,
  desiredAt: Date | string,
  ignorePostId?: string,
): Promise<SafePublishSlot> {
  let target = Math.max(new Date(desiredAt).getTime(), Date.now());
  let reason: string | undefined;

  // 1) Cooldown por conta se houve rate-limit recente.
  const { data: recentRateLimited } = await supabaseAdmin
    .from("scheduled_posts")
    .select("updated_at, last_error")
    .eq("ig_account_id", igAccountId)
    .ilike("last_error", "%too many actions%")
    .gte("updated_at", new Date(Date.now() - RATE_LIMIT_COOLDOWN_MS).toISOString())
    .order("updated_at", { ascending: false })
    .limit(1);
  const latestRateLimit = recentRateLimited?.find((p) => isTooManyActions(p.last_error));
  if (latestRateLimit?.updated_at) {
    const cooldownEnd = new Date(latestRateLimit.updated_at).getTime() + RATE_LIMIT_COOLDOWN_MS;
    if (cooldownEnd > target) {
      target = cooldownEnd;
      reason = "cooldown_account_rate_limit";
    }
  }

  // 2) Gap global mínimo entre contas diferentes.
  const globalLookIso = new Date(target - GLOBAL_START_GAP_MS).toISOString();
  let globalQ = supabaseAdmin
    .from("scheduled_posts")
    .select("id, scheduled_at")
    .neq("ig_account_id", igAccountId)
    .in("status", ["scheduled", "publishing"])
    .gte("scheduled_at", globalLookIso)
    .lt("scheduled_at", new Date(target).toISOString())
    .order("scheduled_at", { ascending: false })
    .limit(1);
  if (ignorePostId) globalQ = globalQ.neq("id", ignorePostId);
  const { data: prevGlobal } = await globalQ;
  if (prevGlobal?.[0]?.scheduled_at) {
    const earliest = new Date(prevGlobal[0].scheduled_at).getTime() + GLOBAL_START_GAP_MS;
    if (earliest > target) {
      target = earliest;
      reason = reason ?? "spacing_global";
    }
  }

  // 3) Se cair no mesmo horário (±5s) de outra CONTA diferente, aplica
  //    jitter determinístico de 10–30s só neste post — a fila da conta
  //    dele continua intacta, só este slot é deslocado.
  const colWinStart = new Date(target - CROSS_ACCOUNT_COLLISION_MS).toISOString();
  const colWinEnd = new Date(target + CROSS_ACCOUNT_COLLISION_MS).toISOString();
  let collideQ = supabaseAdmin
    .from("scheduled_posts")
    .select("id, ig_account_id, scheduled_at")
    .in("status", ["scheduled", "publishing"])
    .neq("ig_account_id", igAccountId)
    .gte("scheduled_at", colWinStart)
    .lte("scheduled_at", colWinEnd)
    .limit(1);
  if (ignorePostId) collideQ = collideQ.neq("id", ignorePostId);
  const { data: collide } = await collideQ;
  if (collide && collide.length > 0) {
    target = target + accountJitterMs(igAccountId);
    reason = reason ?? "cross_account_collision_jitter";
  }

  const scheduledAt = new Date(target).toISOString();
  return { scheduledAt, delayed: target > new Date(desiredAt).getTime() + 1000, reason };
}

// Só reagenda se o slot seguro estiver realmente longe do agora.
// Se estiver dentro da tolerância (≤60s), publica imediatamente.
async function maybeDelayUnsafeStart(post: PostRow, publishNow = false): Promise<SafePublishSlot | null> {
  if (post.status === "publishing" && post.ig_container_id) return null;
  const safe = await computeSafePublishSlot(post.ig_account_id, publishNow ? new Date() : post.scheduled_at, post.id);
  const now = Date.now();
  const safeMs = new Date(safe.scheduledAt).getTime();
  // Se a janela segura já abriu (ou abre em ≤1min), publica agora — sem novo reagendamento.
  if (safeMs <= now + IMMEDIATE_TOLERANCE_MS) return null;
  const originalAt = post.scheduled_at;
  await supabaseAdmin
    .from("scheduled_posts")
    .update({ status: "scheduled", scheduled_at: safe.scheduledAt, processing_lock_at: null, updated_at: new Date().toISOString() })
    .eq("id", post.id);
  await logHealing({
    postId: post.id,
    userId: post.user_id,
    igAccountId: post.ig_account_id,
    action: "rescheduled_safety_window",
    reason: safe.reason ?? "safety_window",
    originalAt,
    newAt: safe.scheduledAt,
  });
  return { scheduledAt: safe.scheduledAt, delayed: true, reason: safe.reason ?? "future_or_cooldown" };
}

async function signedUrl(storagePath: string): Promise<string> {
  // Sign for 2 hours — enough for Meta to fetch and process.
  const { data, error } = await supabaseAdmin.storage
    .from("media")
    .createSignedUrl(storagePath, 60 * 60 * 2);
  if (error || !data?.signedUrl) throw new Error(`Falha ao gerar URL de mídia: ${error?.message}`);

  const rawUrl = data.signedUrl;
  const customCdn = process.env.MEDIA_CDN_URL?.trim();
  if (!customCdn) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    const cdnUrl = new URL(customCdn);
    parsed.protocol = cdnUrl.protocol;
    parsed.host = cdnUrl.host;
    return parsed.toString();
  } catch (err) {
    console.warn("[publish.server] Erro ao aplicar MEDIA_CDN_URL:", err);
    return rawUrl;
  }
}

import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { ConnectionOptions } from "tls";

let cachedProxyAgent: ProxyAgent | null = null;
let lastProxyUrl: string | null = null;

const BROWSER_MIMIC_HEADERS: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (Linux; Android 14; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
  "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "accept": "application/json, text/plain, */*",
  "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "accept-encoding": "gzip, deflate, br",
};

function getGraphDispatcher(): ProxyAgent | undefined {
  const proxyUrl = process.env.PROXY_URL?.trim();
  if (!proxyUrl) return undefined;
  if (cachedProxyAgent && lastProxyUrl === proxyUrl) return cachedProxyAgent;
  try {
    const tlsOptions: ConnectionOptions = {
      ALPNProtocols: ["h2", "http/1.1"],
      servername: "graph.instagram.com",
    };
    cachedProxyAgent = new ProxyAgent({
      uri: proxyUrl,
      requestTls: tlsOptions,
    });
    lastProxyUrl = proxyUrl;
    return cachedProxyAgent;
  } catch (err) {
    console.error("[publish.server] Erro ao instanciar ProxyAgent:", err);
    return undefined;
  }
}

const GRAPH_TIMEOUT_MS = 60_000;

async function graph<T = any>(
  path: string,
  token: string,
  method: "GET" | "POST" = "GET",
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (method === "GET") url.searchParams.set(k, String(v));
    else form.set(k, String(v));
  }
  url.searchParams.set("access_token", token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  let res: Response;
  const dispatcher = getGraphDispatcher();
  try {
    const headers: Record<string, string> = {
      ...BROWSER_MIMIC_HEADERS,
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    };
    const fetchImpl = dispatcher ? (undiciFetch as any) : fetch;
    res = await fetchImpl(url.toString(), {
      method,
      body: method === "POST" ? form : undefined,
      headers,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    } as any);
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`Timeout ao chamar API do Instagram (${GRAPH_TIMEOUT_MS / 1000}s) em ${path}`);
    }
    throw new Error(`Falha de rede ao chamar API do Instagram: ${e?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json()) as any;
  if (!res.ok || json?.error) {
    const msg = json?.error?.message || json?.error?.error_user_msg || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

async function getContainerStatus(containerId: string, token: string) {
  const r = await graph<{ status_code?: string; status?: string }>(`/${containerId}`, token, "GET", {
    fields: "status_code,status",
  });
  const code = r.status_code || "IN_PROGRESS";
  // PUBLISHED = a Meta já publicou este container. Não podemos chamar media_publish
  // de novo (criaria duplicata). Tratamos como "concluído externamente".
  if (code === "PUBLISHED") return { ready: true, alreadyPublished: true, code, status: r.status };
  if (code === "FINISHED") return { ready: true, alreadyPublished: false, code, status: r.status };
  if (code === "ERROR" || code === "EXPIRED") {
    throw new Error(`Processamento da mídia falhou (status=${code}${r.status ? ": " + r.status : ""})`);
  }
  return { ready: false, alreadyPublished: false, code, status: r.status };
}

// Busca best-effort do media_id publicado a partir do container.
// Se falhar, marcamos o post como publicado sem media_id (evita duplicar).
async function resolvePublishedMediaId(containerId: string, igUserId: string, token: string): Promise<string | null> {
  try {
    const r = await graph<{ id?: string }>(`/${containerId}`, token, "GET", { fields: "id" });
    if (r?.id && r.id !== containerId) return r.id;
  } catch {}
  try {
    const list = await graph<{ data?: Array<{ id: string }> }>(`/${igUserId}/media`, token, "GET", {
      fields: "id",
      limit: "5",
    });
    return list.data?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function waitContainerReady(containerId: string, token: string, timeoutMs = 5 * 60 * 1000) {
  const start = Date.now();
  let delay = 2000;
  while (Date.now() - start < timeoutMs) {
    const state = await getContainerStatus(containerId, token);
    if (state.ready) return { alreadyPublished: state.alreadyPublished };
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 1.5, 10000);
  }
  throw new Error("Timeout aguardando o Instagram processar a mídia");
}

async function loadPost(postId: string): Promise<LoadedPost> {
  const { data: post, error: postErr } = await supabaseAdmin
    .from("scheduled_posts")
    .select("id, user_id, ig_account_id, post_type, status, caption, first_comment, cover_url, cover_media_id, thumbnail_offset, scheduled_at, interval_minutes, recurrence, ig_container_id, round_run_id")
    .eq("id", postId)
    .single<PostRow>();
  if (postErr || !post) throw new Error(`Publicação não encontrada: ${postErr?.message ?? postId}`);

  const { data: account, error: accErr } = await supabaseAdmin
    .from("instagram_accounts")
    .select("ig_user_id, access_token, username")
    .eq("id", post.ig_account_id)
    .single();
  if (accErr || !account) throw new Error("Conta do Instagram não encontrada");

  const { data: mediaRows, error: mErr } = await supabaseAdmin
    .from("post_media")
    .select("position, media_assets(storage_path, public_url, media_kind)")
    .eq("post_id", post.id)
    .order("position", { ascending: true });
  if (mErr) throw mErr;
  const items = ((mediaRows ?? []) as unknown as MediaRow[]).filter((r) => r.media_assets);
  if (items.length === 0) throw new Error("Publicação sem mídia");

  return {
    post,
    account: account as { ig_user_id: string; access_token: string; username?: string | null },
    items,
  };
}

async function createContainer(post: PostRow, items: MediaRow[], igUserId: string, token: string): Promise<string> {
  if (post.post_type === "image") {
    const url = await signedUrl(items[0].media_assets!.storage_path);
    const r = await graph<{ id: string }>(`/${igUserId}/media`, token, "POST", {
      image_url: url,
      caption: post.caption,
    });
    return r.id;
  }

  if (post.post_type === "reel") {
    const url = await signedUrl(items[0].media_assets!.storage_path);
    let coverUrl: string | undefined = post.cover_url && post.cover_url.trim() !== "" ? post.cover_url : undefined;
    if (!coverUrl && post.cover_media_id) {
      const { data: cov } = await supabaseAdmin
        .from("media_assets")
        .select("storage_path")
        .eq("id", post.cover_media_id)
        .single();
      if (cov?.storage_path) coverUrl = await signedUrl(cov.storage_path);
    }
    const r = await graph<{ id: string }>(`/${igUserId}/media`, token, "POST", {
      media_type: "REELS",
      video_url: url,
      caption: post.caption,
      cover_url: coverUrl,
      thumb_offset: coverUrl ? undefined : post.thumbnail_offset ?? undefined,
      share_to_feed: "true",
    });
    return r.id;
  }

  const children: string[] = [];
  for (const item of items.slice(0, 10)) {
    const url = await signedUrl(item.media_assets!.storage_path);
    const isVideo = item.media_assets!.media_kind === "video";
    const r = await graph<{ id: string }>(`/${igUserId}/media`, token, "POST", {
      is_carousel_item: "true",
      ...(isVideo ? { media_type: "VIDEO", video_url: url } : { image_url: url }),
    });
    await waitContainerReady(r.id, token);
    children.push(r.id);
  }
  const r = await graph<{ id: string }>(`/${igUserId}/media`, token, "POST", {
    media_type: "CAROUSEL",
    caption: post.caption,
    children: children.join(","),
  });
  return r.id;
}

async function ensureContainer(post: PostRow, items: MediaRow[], igUserId: string, token: string, forceNew = false) {
  if (!forceNew && (post.status === "publishing" || post.round_run_id) && post.ig_container_id) return post.ig_container_id;

  const { error: beginError } = await supabaseAdmin
    .from("scheduled_posts")
    .update({ status: "publishing", last_error: null, ig_container_id: null, updated_at: new Date().toISOString() })
    .eq("id", post.id);

  if (beginError) throw new Error(beginError.message);
  const containerId = await createContainer(post, items, igUserId, token);

  const { error: containerError } = await supabaseAdmin
    .from("scheduled_posts")
    .update({ status: "publishing", ig_container_id: containerId, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", post.id);

  if (containerError) throw new Error(containerError.message);
  return containerId;
}

function isMediaNotReadyMessage(message: string) {
  return /not available|not ready|still processing|Media ID/i.test(message);
}

async function publishContainer(igUserId: string, containerId: string, token: string, attempts = 6, processingAsResult = false) {
  let pub: { id: string } | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      pub = await graph<{ id: string }>(`/${igUserId}/media_publish`, token, "POST", {
        creation_id: containerId,
      });
      break;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? "");
      if (!isMediaNotReadyMessage(msg)) throw e;
      if (processingAsResult) throw new ContainerStillProcessing(msg);
      await new Promise((res) => setTimeout(res, 3000 + attempt * 2000));
    }
  }
  if (!pub) throw lastErr instanceof Error ? lastErr : new Error("Falha ao publicar container");
  return pub;
}

async function completePublishedPost(post: PostRow, token: string, containerId: string, mediaId: string) {
  let permalink: string | undefined;
  try {
    const meta = await graph<{ permalink?: string }>(`/${mediaId}`, token, "GET", { fields: "permalink" });
    permalink = meta.permalink;
  } catch {}

  if (post.first_comment && post.first_comment.trim() !== "") {
    try {
      await graph(`/${mediaId}/comments`, token, "POST", { message: post.first_comment });
    } catch (e) {
      console.error("first_comment failed", e);
    }
  }

  const { error: completionError } = await supabaseAdmin
    .from("scheduled_posts")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      ig_container_id: containerId,
      ig_media_id: mediaId,
      ig_permalink: permalink ?? null,
      last_error: null,
    })
    .eq("id", post.id);

  if (completionError) throw new Error(completionError.message);

  await cloneNextOccurrence(post).catch((e) => console.error("recurrence clone failed", e));

  return { ig_media_id: mediaId, permalink };
}

async function publishScheduledPostUnlocked(postId: string): Promise<{ ig_media_id: string; permalink?: string }> {
  const { post, account, items } = await loadPost(postId);
  const token = account.access_token as string;
  const igUserId = account.ig_user_id as string;
  const containerId = await ensureContainer(post, items, igUserId, token, post.round_run_id ? !post.ig_container_id : post.status !== "publishing");
  const ready = await waitContainerReady(containerId, token);
  if (ready.alreadyPublished) {
    const mediaId = (await resolvePublishedMediaId(containerId, igUserId, token)) ?? containerId;
    return completePublishedPost(post, token, containerId, mediaId);
  }
  const pub = await publishContainer(igUserId, containerId, token);
  return completePublishedPost(post, token, containerId, pub.id);
}

async function processScheduledPostTickUnlocked(postId: string, options: { publishNow?: boolean } = {}): Promise<
  | { status: "delayed"; scheduled_at: string; reason?: string }
  | { status: "processing"; container_id: string; meta_status?: string }
  | { status: "published"; ig_media_id: string; permalink?: string }
> {
  const { post, account, items } = await loadPost(postId);
  const delayed = await maybeDelayUnsafeStart(post, options.publishNow);
  if (delayed) return { status: "delayed", scheduled_at: delayed.scheduledAt, reason: delayed.reason };
  const token = account.access_token as string;
  const igUserId = account.ig_user_id as string;
  const containerId = await ensureContainer(post, items, igUserId, token, post.status !== "publishing");

  const state = await getContainerStatus(containerId, token);
  if (!state.ready) {
    await supabaseAdmin
      .from("scheduled_posts")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", post.id);
    return { status: "processing", container_id: containerId, meta_status: state.code };
  }

  try {
    if (state.alreadyPublished) {
      const mediaId = (await resolvePublishedMediaId(containerId, igUserId, token)) ?? containerId;
      const done = await completePublishedPost(post, token, containerId, mediaId);
      return { status: "published", ...done };
    }
    const pub = await publishContainer(igUserId, containerId, token, 2, true);
    const done = await completePublishedPost(post, token, containerId, pub.id);
    return { status: "published", ...done };
  } catch (e) {
    if (e instanceof ContainerStillProcessing) {
      await supabaseAdmin
        .from("scheduled_posts")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", post.id);
      return { status: "processing", container_id: containerId, meta_status: e.message };
    }
    throw e;
  }
}

function computeNextIntervalMs(post: PostRow): number | null {
  if (post.interval_minutes && post.interval_minutes > 0) return post.interval_minutes * 60_000;
  switch (post.recurrence) {
    case "daily": return 24 * 60 * 60_000;
    case "weekly": return 7 * 24 * 60 * 60_000;
    case "monthly": return 30 * 24 * 60 * 60_000;
    default: return null;
  }
}

async function cloneNextOccurrence(post: PostRow): Promise<void> {
  const intervalMs = computeNextIntervalMs(post);
  if (!intervalMs) return;
  const base = new Date(post.scheduled_at).getTime();
  const now = Date.now();
  let next = base + intervalMs;
  while (next <= now) next += intervalMs;
  const nextIso = new Date(next).toISOString();

  // Avoid duplicating if a next occurrence in the same series already exists
  const { data: existing } = await supabaseAdmin
    .from("scheduled_posts")
    .select("id")
    .eq("ig_account_id", post.ig_account_id)
    .eq("user_id", post.user_id)
    .eq("scheduled_at", nextIso)
    .eq("status", "scheduled")
    .maybeSingle();
  if (existing) return;

  const { data: newPost, error: insErr } = await supabaseAdmin
    .from("scheduled_posts")
    .insert({
      user_id: post.user_id,
      ig_account_id: post.ig_account_id,
      post_type: post.post_type,
      caption: post.caption,
      first_comment: post.first_comment,
      cover_url: post.cover_url,
      cover_media_id: post.cover_media_id,
      thumbnail_offset: post.thumbnail_offset,
      scheduled_at: nextIso,
      interval_minutes: post.interval_minutes,
      recurrence: (post.recurrence ?? undefined) as any,
      status: "scheduled",
    } as any)
    .select("id")
    .single();
  if (insErr || !newPost) return;
  const { data: pm } = await supabaseAdmin
    .from("post_media")
    .select("media_asset_id, position")
    .eq("post_id", post.id);
  if (pm && pm.length) {
    await supabaseAdmin.from("post_media").insert(
      pm.map((m) => ({ post_id: newPost.id, media_asset_id: m.media_asset_id, position: m.position })),
    );
  }
}


export async function markPostFailed(postId: string, message: string) {
  // Marca falha, mas NÃO notifica — o monitor decide quando avisar
  // (só notifica depois que todas as tentativas automáticas se esgotarem).
  const { data: cur } = await supabaseAdmin
    .from("scheduled_posts")
    .select("retry_count, ig_account_id")
    .eq("id", postId)
    .maybeSingle();
  await supabaseAdmin
    .from("scheduled_posts")
    .update({
      status: "failed",
      last_error: message.slice(0, 500),
      retry_count: (cur?.retry_count ?? 0) + 1,
      processing_lock_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  // Se for rate-limit, adia TODOS os outros posts scheduled da mesma conta
  // que estejam prestes a rodar, para não bombardear a mesma conta.
  const classified = classifyError(message);
  if (classified.category === "rate_limit" && cur?.ig_account_id) {
    const cooldownMin = Math.max(classified.backoffMinutes ?? 60, RATE_LIMIT_COOLDOWN_MS / 60_000);
    const untilMs = Date.now() + cooldownMin * 60_000;
    const nowIso = new Date().toISOString();
    const { data: accountQueue } = await supabaseAdmin
      .from("scheduled_posts")
      .select("id")
      .eq("ig_account_id", cur.ig_account_id)
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date(untilMs).toISOString())
      .order("scheduled_at", { ascending: true });

    for (let i = 0; i < (accountQueue ?? []).length; i++) {
      await supabaseAdmin
        .from("scheduled_posts")
        .update({
          scheduled_at: new Date(untilMs + i * RATE_LIMIT_RETRY_GAP_MS).toISOString(),
          updated_at: nowIso,
        })
        .eq("id", accountQueue![i].id);
    }
    console.warn(
      `[publish] rate_limit em ${cur.ig_account_id} — reorganizando fila da conta com ${cooldownMin}min de espera e ${RATE_LIMIT_RETRY_GAP_MS / 60_000}min entre posts`,
    );
    await logHealing({
      postId,
      igAccountId: cur.ig_account_id,
      action: "rate_limit_reorg",
      category: "rate_limit",
      reason: `cooldown ${cooldownMin}min e reorganização da fila da conta (${(accountQueue ?? []).length} posts)`,
      newAt: new Date(untilMs).toISOString(),
      error: message,
      metadata: { affected_posts: (accountQueue ?? []).length, cooldown_minutes: cooldownMin },
    });
  }

  // CIRCUIT BREAKER IMEDIATO:
  // Se a conta for suspensa, restrita, cair em checkpoint ou tiver token/permissão revogada,
  // pausamos a conta na HORA, paramos as rodadas e cancelamos retries para não queimar o Meta App ID.
  const isPermanentFailure =
    classified.category === "user_restricted" ||
    classified.category === "token_expired" ||
    classified.category === "permissions" ||
    !classified.retryable;

  if (isPermanentFailure && cur?.ig_account_id) {
    await handleRestrictedAccount(cur.ig_account_id, message);
    await supabaseAdmin
      .from("scheduled_posts")
      .update({
        status: "failed_final",
        last_error: `[CIRCUIT BREAKER] ${message.slice(0, 450)}`,
        processing_lock_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);
  }
}

export async function handleRestrictedAccount(igAccountId: string, rawMessage: string) {
  const nowIso = new Date().toISOString();
  const { data: acc } = await supabaseAdmin
    .from("instagram_accounts")
    .select("id, username, is_restricted, user_id")
    .eq("id", igAccountId)
    .maybeSingle();
  if (!acc) return;

  // 1. Marca a conta como inativa e restrita imediatamente
  await supabaseAdmin
    .from("instagram_accounts")
    .update({
      is_restricted: true,
      is_active: false,
      restricted_at: nowIso,
      restricted_reason: rawMessage.slice(0, 300),
      updated_at: nowIso,
    })
    .eq("id", igAccountId);

  // 2. Trava a conta imediatamente nas rodadas ativas (libera a vaga da fila para contas saudáveis)
  await supabaseAdmin
    .from("publication_round_accounts")
    .update({
      stopped_at: nowIso,
      stop_reason: `[CIRCUIT BREAKER] ${rawMessage.slice(0, 250)}`,
    })
    .eq("ig_account_id", igAccountId)
    .is("stopped_at", null);

  // 3. Pausa pools normais
  await supabaseAdmin
    .from("media_pools")
    .update({ status: "paused", updated_at: nowIso })
    .eq("ig_account_id", igAccountId)
    .eq("status", "active");

  // 4. Cancela agendamentos futuros para não enviar mais nenhuma requisição à Meta
  await supabaseAdmin
    .from("scheduled_posts")
    .update({
      status: "draft",
      last_error: `[CIRCUIT BREAKER] Conta pausada: ${rawMessage.slice(0, 200)}`,
      updated_at: nowIso,
    })
    .eq("ig_account_id", igAccountId)
    .in("status", ["scheduled", "failed"]);

  await logHealing({
    igAccountId,
    userId: (acc as any).user_id ?? null,
    action: "circuit_breaker_activated",
    category: "user_restricted",
    reason: "Conta com erro permanente/suspensa — Circuit Breaker ativado para blindar o Meta App ID",
    error: rawMessage,
  });

  // Só notifica na primeira vez que fica restrita (evita spam se vários posts falharem no mesmo minuto).
  if (!acc.is_restricted) {
    try {
      const { sendWhatsApp, formatTs } = await import("@/lib/notify.server");
      await sendWhatsApp(
        `🚨 ELITE CIRCUIT BREAKER: conta @${acc.username} foi PAUSADA automaticamente para blindar seu Meta App ID (Erro: ${rawMessage.slice(0, 150)}). Horário: ${formatTs()}`,
      );
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Auto-recovery: chamado pelo cron monitor.
// Tenta destravar um post em "publishing" (há muito tempo) ou "failed".
// ---------------------------------------------------------------------------

const RETRY_BACKOFF_MINUTES = [5, 15, 30]; // por índice de tentativa (1ª,2ª,3ª)
export const MAX_AUTO_RETRIES = 3;
const IN_PROGRESS_GRACE_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Classificador inteligente de erros da Meta / rede.
// Permite decidir: (a) se vale a pena tentar de novo, (b) qual backoff usar,
// (c) que mensagem mostrar ao usuário quando falhar de vez.
// ---------------------------------------------------------------------------
export type ErrorCategory =
  | "token_expired"
  | "permissions"
  | "user_restricted"    // "User access is restricted" — pausar tudo e avisar
  | "media_invalid"
  | "rate_limit"
  | "container_error"
  | "network"
  | "unknown";

export type ClassifiedError = {
  category: ErrorCategory;
  retryable: boolean;
  backoffMinutes?: number;
  userMessage: string;
};

export function classifyError(rawMessage: string): ClassifiedError {
  const m = (rawMessage ?? "").toLowerCase();

  // Erros permanentes que devem acionar o Circuit Breaker imediato
  if (/user access is restricted|account.*(restricted|disabled|suspended)|checkpoint|challenge_required|action_blocked|user_has_been_banned|error_subcode.*(490|458|459|460|463|467)|error.*code.*(190|368)|oauth.*exception/i.test(m)) {
    return {
      category: "user_restricted",
      retryable: false,
      userMessage: "O Instagram restringiu, suspendeu ou pediu verificação nesta conta. Pausada imediatamente para blindar o Meta App ID.",
    };
  }
  if (/token|oauth|session has expired|access_token|invalid.*(token|credential)|session.*invalidated/i.test(m)) {
    return {
      category: "token_expired",
      retryable: false,
      userMessage: "O login com o Instagram expirou ou foi revogado. Conta pausada imediatamente para blindar o Meta App ID.",
    };
  }
  if (/permission|scope|not authorized|insufficient|missing.*permission/i.test(m)) {
    return {
      category: "permissions",
      retryable: false,
      userMessage: "Faltam permissões nessa conta. Conta pausada para evitar rejeição na Meta.",
    };
  }
  if (/aspect ratio|duration|too (long|short|large|small)|unsupported (format|media)|invalid (video|image|file|url)|codec|resolution|dimensions/i.test(m)) {
    return {
      category: "media_invalid",
      retryable: false,
      userMessage: "A mídia não atende aos requisitos do Instagram (formato, duração ou proporção). Suba outro arquivo.",
    };
  }
  if (/user is performing too many actions|performing too many|application request limit|please reduce/i.test(m)) {
    return {
      category: "rate_limit",
      retryable: true,
      backoffMinutes: 60,
      userMessage: "O Instagram sinalizou 'ações demais' nesta conta. Colocando em espera por 60 min antes de tentar de novo.",
    };
  }
  if (/rate.?limit|too many requests|429|calls to this api have exceeded/i.test(m)) {
    return {
      category: "rate_limit",
      retryable: true,
      backoffMinutes: 45,
      userMessage: "O Instagram limitou temporariamente esta conta. Vamos tentar de novo em alguns minutos.",
    };
  }
  if (/status=(error|expired)|container.*(error|expired)|creation_id/i.test(m)) {
    return {
      category: "container_error",
      retryable: true,
      userMessage: "A Meta rejeitou o container. Vamos recriar do zero e tentar publicar de novo.",
    };
  }
  if (/timeout|network|econn|fetch failed|socket|abort/i.test(m)) {
    return {
      category: "network",
      retryable: true,
      backoffMinutes: 3,
      userMessage: "Falha de rede ao falar com o Instagram. Nova tentativa em instantes.",
    };
  }
  return {
    category: "unknown",
    retryable: true,
    userMessage: rawMessage.slice(0, 200),
  };
}

export type RecoveryOutcome =
  | { kind: "published"; ig_media_id: string }
  | { kind: "delayed"; scheduled_at: string; reason?: string }
  | { kind: "still_processing"; container_id: string; meta_status?: string }
  | { kind: "recovered_publish"; ig_media_id: string }
  | { kind: "recreated_and_published"; ig_media_id: string }
  | { kind: "failed"; error: string };

async function attemptRecoveryUnlocked(postId: string): Promise<RecoveryOutcome> {
  let loaded: LoadedPost;
  try {
    loaded = await loadPost(postId);
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  const { post, account, items } = loaded;
  const delayed = await maybeDelayUnsafeStart(post);
  if (delayed) return { kind: "delayed", scheduled_at: delayed.scheduledAt, reason: delayed.reason };
  const token = account.access_token;
  const igUserId = account.ig_user_id;

  // 1) Container já existe → checar status na Meta antes de recriar.
  if (post.ig_container_id) {
    try {
      const state = await getContainerStatus(post.ig_container_id, token);
      if (state.ready) {
        try {
          if (state.alreadyPublished) {
            const mediaId = (await resolvePublishedMediaId(post.ig_container_id, igUserId, token)) ?? post.ig_container_id;
            const done = await completePublishedPost(post, token, post.ig_container_id, mediaId);
            return { kind: "recovered_publish", ig_media_id: done.ig_media_id };
          }
          const pub = await publishContainer(igUserId, post.ig_container_id, token, 3, false);
          const done = await completePublishedPost(post, token, post.ig_container_id, pub.id);
          return { kind: "recovered_publish", ig_media_id: done.ig_media_id };
        } catch (e) {
          return { kind: "failed", error: e instanceof Error ? e.message : String(e) };
        }
      }
      // IN_PROGRESS — se dentro da janela de tolerância, não intervir ainda.
      const ageMs = Date.now() - new Date(post.scheduled_at).getTime();
      if (ageMs < IN_PROGRESS_GRACE_MS) {
        await supabaseAdmin
          .from("scheduled_posts")
          .update({ updated_at: new Date().toISOString(), processing_lock_at: null })
          .eq("id", post.id);
        return { kind: "still_processing", container_id: post.ig_container_id, meta_status: state.code };
      }
      // Passou da tolerância → recriar (fall-through).
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/status=(ERROR|EXPIRED)/i.test(msg) && !/does not exist|Unsupported|Invalid/i.test(msg)) {
        return { kind: "failed", error: msg };
      }
    }
  }

  // 2) Recriar container do zero (sem esperar em loop para evitar timeout na Vercel).
  try {
    const containerId = await ensureContainer(post, items, igUserId, token, true);
    await supabaseAdmin
      .from("scheduled_posts")
      .update({ processing_lock_at: null, updated_at: new Date().toISOString() })
      .eq("id", post.id);
    return { kind: "still_processing", container_id: containerId, meta_status: "RECREATED" };
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

export type AttemptLogEntry = {
  at: string;
  attempt: number;
  action: string;
  ok: boolean;
  meta_status?: string;
  error?: string;
};

export async function recordAttempt(postId: string, entry: AttemptLogEntry) {
  const { data } = await supabaseAdmin
    .from("scheduled_posts")
    .select("attempts_log")
    .eq("id", postId)
    .maybeSingle();
  const log = Array.isArray((data as any)?.attempts_log) ? (data as any).attempts_log : [];
  log.push(entry);
  await supabaseAdmin
    .from("scheduled_posts")
    .update({ attempts_log: log.slice(-20) })
    .eq("id", postId);
}

export async function scheduleNextAutoRetry(postId: string, newCount: number, overrideMinutes?: number) {
  const idx = Math.min(newCount, RETRY_BACKOFF_MINUTES.length) - 1;
  const defaultMin = RETRY_BACKOFF_MINUTES[Math.max(0, idx)];
  const minutes = overrideMinutes && overrideMinutes > 0 ? overrideMinutes : defaultMin;
  const fallback = new Date(Date.now() + minutes * 60_000).toISOString();
  const { data: cur } = await supabaseAdmin
    .from("scheduled_posts")
    .select("ig_account_id")
    .eq("id", postId)
    .maybeSingle();
  const next = cur?.ig_account_id
    ? (await computeSafePublishSlot(cur.ig_account_id, fallback, postId)).scheduledAt
    : fallback;
  await supabaseAdmin
    .from("scheduled_posts")
    .update({
      auto_retry_count: newCount,
      next_retry_at: next,
      processing_lock_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);
  return { next_retry_at: next, minutes };
}

export async function markPostFailedFinal(postId: string, lastError: string) {
  const { data: cur } = await supabaseAdmin
    .from("scheduled_posts")
    .select("user_id, ig_account_id, post_type, caption, auto_retry_count")
    .eq("id", postId)
    .maybeSingle();

  await supabaseAdmin
    .from("scheduled_posts")
    .update({
      status: "failed_final",
      last_error: lastError.slice(0, 500),
      processing_lock_at: null,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (cur?.user_id) {
    let accountLabel = "conta desconhecida";
    if (cur.ig_account_id) {
      const { data: acc } = await supabaseAdmin
        .from("instagram_accounts")
        .select("username")
        .eq("id", cur.ig_account_id)
        .maybeSingle();
      if (acc?.username) accountLabel = `@${acc.username}`;
    }
    const typeLabel = cur.post_type === "reel" ? "Reel" : cur.post_type === "carousel" ? "Carrossel" : "Foto";
    const title = `Falha definitiva ao publicar ${typeLabel} em ${accountLabel}`;
    const shortCap = (cur.caption ?? "").slice(0, 60);
    const message = `Post "${shortCap || "(sem legenda)"}" — ${cur.auto_retry_count ?? 3} tentativas automáticas. Último erro: ${lastError.slice(0, 200)}`;
    await supabaseAdmin.from("notifications").insert({
      user_id: cur.user_id,
      type: "publish_failed_final",
      title,
      message,
      metadata: {
        post_id: postId,
        ig_account_id: cur.ig_account_id,
        post_type: cur.post_type,
        attempts: cur.auto_retry_count ?? 3,
        can_retry: true,
      },
    });

    const { sendWhatsApp, formatTs } = await import("@/lib/notify.server");
    await sendWhatsApp(
      `❌ ELITE: ${typeLabel} em ${accountLabel} falhou definitivamente após ${cur.auto_retry_count ?? 3} tentativas. Erro: ${lastError.slice(0, 160)}. Horário: ${formatTs()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// SELF-HEALING LOG + circuit breaker por conta (3 falhas seguidas → revisão manual)
// ---------------------------------------------------------------------------

export type HealingLogInput = {
  postId?: string | null;
  userId?: string | null;
  igAccountId?: string | null;
  action: string;
  category?: string | null;
  reason?: string | null;
  originalAt?: string | null;
  newAt?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logHealing(entry: HealingLogInput) {
  try {
    await supabaseAdmin.from("auto_healing_log").insert({
      user_id: entry.userId ?? null,
      ig_account_id: entry.igAccountId ?? null,
      post_id: entry.postId ?? null,
      action: entry.action,
      category: entry.category ?? null,
      reason: entry.reason ?? null,
      original_scheduled_at: entry.originalAt ?? null,
      new_scheduled_at: entry.newAt ?? null,
      error: entry.error ? entry.error.slice(0, 500) : null,
      metadata: entry.metadata ?? {},
    } as any);
  } catch (e) {
    console.warn("[healing] failed to log", e);
  }
}

const CONSECUTIVE_FAILURE_THRESHOLD = 3;

// Se a mesma conta acumulou N tentativas seguidas classificadas como falha
// (sem sucesso no meio), pausa a conta para revisão manual e avisa por WhatsApp
// com o histórico completo.
export async function checkAccountCircuitBreaker(igAccountId: string) {
  const { data: acc } = await supabaseAdmin
    .from("instagram_accounts")
    .select("id, username, user_id, needs_manual_review")
    .eq("id", igAccountId)
    .maybeSingle();
  if (!acc || acc.needs_manual_review) return;

  const { data: recent } = await supabaseAdmin
    .from("auto_healing_log")
    .select("action, category, reason, error, created_at, post_id, original_scheduled_at, new_scheduled_at")
    .eq("ig_account_id", igAccountId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (!recent || recent.length < CONSECUTIVE_FAILURE_THRESHOLD) return;

  const isFailure = (a: string) =>
    a === "retry_scheduled" || a === "failed_final" || a === "rate_limit_reorg";
  const isSuccess = (a: string) =>
    a === "recovered_publish" || a === "recreated_and_published" || a === "published";

  let consecutive = 0;
  for (const r of recent) {
    if (isSuccess(r.action)) break;
    if (isFailure(r.action)) {
      consecutive += 1;
      if (consecutive >= CONSECUTIVE_FAILURE_THRESHOLD) break;
    }
  }
  if (consecutive < CONSECUTIVE_FAILURE_THRESHOLD) return;

  const nowIso = new Date().toISOString();
  const reason = `${CONSECUTIVE_FAILURE_THRESHOLD} falhas consecutivas mesmo após tentativas automáticas`;

  await supabaseAdmin
    .from("instagram_accounts")
    .update({
      needs_manual_review: true,
      manual_review_reason: reason,
      manual_review_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", igAccountId);

  await supabaseAdmin
    .from("media_pools")
    .update({ status: "paused", updated_at: nowIso })
    .eq("ig_account_id", igAccountId)
    .eq("status", "active");

  await supabaseAdmin
    .from("scheduled_posts")
    .update({ status: "draft", last_error: `Pausado: ${reason}`, updated_at: nowIso })
    .eq("ig_account_id", igAccountId)
    .in("status", ["scheduled", "failed"]);

  await logHealing({
    igAccountId,
    userId: acc.user_id,
    action: "manual_review_required",
    reason,
    metadata: { history: recent.slice(0, CONSECUTIVE_FAILURE_THRESHOLD) },
  });

  if (acc.user_id) {
    await supabaseAdmin.from("notifications").insert({
      user_id: acc.user_id,
      type: "account_manual_review",
      title: `Conta @${acc.username} pausada para revisão manual`,
      message: `${reason}. Ver histórico em Fila → Correções automáticas.`,
      metadata: { ig_account_id: igAccountId, history: recent.slice(0, CONSECUTIVE_FAILURE_THRESHOLD) },
    });
  }

  try {
    const { sendWhatsApp, formatTs } = await import("@/lib/notify.server");
    const lines = recent
      .slice(0, CONSECUTIVE_FAILURE_THRESHOLD)
      .map((r, i) => `${i + 1}. [${r.action}] ${r.reason ?? r.category ?? ""} ${r.error ? `— ${r.error.slice(0, 120)}` : ""}`)
      .join("\n");
    await sendWhatsApp(
      `🛑 ELITE: conta @${acc.username} PAUSADA para revisão manual — ${reason}. Horário: ${formatTs()}\n\nHistórico:\n${lines}`,
    );
  } catch (e) {
    console.warn("[healing] whatsapp notify failed", e);
  }
}


// Reseta um post para reiniciar todo o fluxo (botão "Tentar novamente manualmente").
export async function resetPostForManualRetry(postId: string) {
  const { data: existing, error } = await supabaseAdmin.from("scheduled_posts").select("round_run_id").eq("id", postId).single();
  if (error) throw new Error(error.message);
  if (existing?.round_run_id) throw new Error("Use Continuar na seção Publicação em rodadas para preservar a ordem e o envio existente");
  await supabaseAdmin
    .from("scheduled_posts")
    .update({
      status: "scheduled",
      scheduled_at: new Date().toISOString(),
      ig_container_id: null,
      ig_media_id: null,
      last_error: null,
      auto_retry_count: 0,
      next_retry_at: null,
      processing_lock_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);
}

// Uma porta comum impede publicação manual, cron e recuperação concorrentes.
export async function processScheduledPostTick(postId: string, options: { publishNow?: boolean } = {}) {
  const gate = await import("./rounds.server");
  const token = await gate.claimPublicationSend(postId);
  if (!token) return { status: "delayed" as const, ...gate.publicationWait() };
  try { return await processScheduledPostTickUnlocked(postId, options); }
  finally { await gate.releasePublicationSend(postId, token).catch(e => console.error("release", e)); }
}
export async function publishScheduledPost(postId: string) {
  const gate = await import("./rounds.server");
  const token = await gate.claimPublicationSend(postId);
  if (!token) throw new Error("Publicação aguardando sua vez");
  try { return await publishScheduledPostUnlocked(postId); }
  finally { await gate.releasePublicationSend(postId, token).catch(e => console.error("release", e)); }
}
export async function attemptRecovery(postId: string): Promise<RecoveryOutcome> {
  const gate = await import("./rounds.server");
  const token = await gate.claimPublicationSend(postId);
  if (!token) return { kind: "delayed", ...gate.publicationWait() };
  try { return await attemptRecoveryUnlocked(postId); }
  finally { await gate.releasePublicationSend(postId, token).catch(e => console.error("release", e)); }
}
