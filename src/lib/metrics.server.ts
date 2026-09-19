// Coletor de métricas em tempo real (Reels Views, Reach, Likes) via Meta Graph API.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ProxyAgent } from "undici";
import type { ConnectionOptions } from "tls";

const GRAPH = "https://graph.instagram.com/v21.0";
const METRICS_TIMEOUT_MS = 25_000;

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

function getProxyDispatcher(): ProxyAgent | undefined {
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
    console.error("[metrics.server] Erro ao instanciar ProxyAgent:", err);
    return undefined;
  }
}

async function graphGet<T = any>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  url.searchParams.set("access_token", token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METRICS_TIMEOUT_MS);
  const dispatcher = getProxyDispatcher();

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: BROWSER_MIMIC_HEADERS,
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    } as any);

    const json = (await res.json()) as any;
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || `HTTP ${res.status}`);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export type PostMetricsResult = {
  postId: string;
  views: number;
  likes: number;
  reach: number;
  updatedAt: string;
  error?: string;
};

/**
 * Puxa métricas atualizadas de um post individual publicado na Meta.
 */
export async function syncSinglePostMetrics(postId: string): Promise<PostMetricsResult> {
  const { data: post, error: postErr } = await supabaseAdmin
    .from("scheduled_posts")
    .select("id, user_id, ig_account_id, ig_media_id, status, post_type")
    .eq("id", postId)
    .single();

  if (postErr || !post) throw new Error(`Post não encontrado: ${postId}`);
  if (!post.ig_media_id) throw new Error("Post ainda não possui ig_media_id publicado");

  const { data: account, error: accErr } = await supabaseAdmin
    .from("instagram_accounts")
    .select("access_token, ig_user_id, username")
    .eq("id", post.ig_account_id)
    .single();

  if (accErr || !account?.access_token) throw new Error("Conta não encontrada ou sem access_token");

  let views = 0;
  let likes = 0;
  let reach = 0;

  // 1. Busca contadores básicos de mídia (likes, comments)
  try {
    const mediaInfo = await graphGet<{ like_count?: number; comments_count?: number }>(
      `/${post.ig_media_id}`,
      account.access_token,
      { fields: "like_count,comments_count" }
    );
    likes = Number(mediaInfo.like_count ?? 0);
  } catch (e) {
    console.warn(`[metrics] Erro ao buscar like_count para ${post.ig_media_id}:`, e);
  }

  // 2. Busca Insights (plays / views e reach para Reels)
  try {
    const metricParam = post.post_type === "reel" ? "plays,reach,total_interactions" : "impressions,reach";
    const insights = await graphGet<{
      data?: Array<{ name: string; values?: Array<{ value: number }> }>;
    }>(`/${post.ig_media_id}/insights`, account.access_token, {
      metric: metricParam,
    });

    if (insights?.data) {
      for (const item of insights.data) {
        const val = Number(item.values?.[0]?.value ?? 0);
        if (item.name === "plays" || item.name === "impressions") {
          views = Math.max(views, val);
        } else if (item.name === "reach") {
          reach = Math.max(reach, val);
        }
      }
    }
  } catch (e) {
    // Fallback: se insights exigir permissão avançada ou falhar temporariamente
    console.warn(`[metrics] Insights indisponíveis para ${post.ig_media_id}:`, e);
  }

  const nowIso = new Date().toISOString();

  // 3. Atualiza na tabela scheduled_posts
  await supabaseAdmin
    .from("scheduled_posts")
    .update({
      view_count: views,
      like_count: likes,
      reach_count: reach,
      metrics_updated_at: nowIso,
    })
    .eq("id", post.id);

  // 4. Registra snapshot analítico
  try {
    await supabaseAdmin.from("analytics_snapshots").insert({
      user_id: post.user_id,
      ig_account_id: post.ig_account_id,
      scope: "media",
      ig_media_id: post.ig_media_id,
      metrics: { views, likes, reach, captured_at: nowIso },
      captured_at: nowIso,
    });
  } catch {
    // Não interrompe por falha secundária de snapshot
  }

  return {
    postId: post.id,
    views,
    likes,
    reach,
    updatedAt: nowIso,
  };
}

/**
 * Sincroniza métricas dos posts publicados mais recentes (em lote).
 */
export async function syncRecentPostsMetrics(options: { accountId?: string; limit?: number } = {}) {
  const limit = Math.min(options.limit ?? 25, 50);

  let query = supabaseAdmin
    .from("scheduled_posts")
    .select("id, ig_account_id, ig_media_id")
    .eq("status", "published")
    .not("ig_media_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (options.accountId) {
    query = query.eq("ig_account_id", options.accountId);
  }

  const { data: posts, error } = await query;
  if (error) throw new Error(error.message);
  if (!posts || posts.length === 0) return { synced: 0, results: [] };

  const results: PostMetricsResult[] = [];

  for (const p of posts) {
    try {
      const res = await syncSinglePostMetrics(p.id);
      results.push(res);
    } catch (e) {
      results.push({
        postId: p.id,
        views: 0,
        likes: 0,
        reach: 0,
        updatedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : "Erro",
      });
    }
  }

  return {
    synced: results.length,
    results,
  };
}
