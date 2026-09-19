import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequest } from "@tanstack/react-start/server";

const GRAPH = "https://graph.facebook.com/v21.0";
const FB_DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";
const OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

type Creds = { app_id: string; app_secret: string; long_lived_token: string };

type ValidateOk = {
  ok: true;
  user: { id: string; name?: string };
  /** Unix seconds. `null` = never expires. `undefined` = unknown. */
  expires_at: number | null | undefined;
};
type ValidateErr = {
  ok: false;
  field: "app_id" | "app_secret" | "long_lived_token" | "general";
  message: string;
};

async function validateCreds(c: Creds): Promise<ValidateOk | ValidateErr> {
  const appToken = `${c.app_id}|${c.app_secret}`;
  try {
    const dbg = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(c.long_lived_token)}&access_token=${encodeURIComponent(appToken)}`);
    const dbgJson: { data?: { is_valid?: boolean; app_id?: string | number; expires_at?: number; error?: { message?: string } }; error?: { message?: string } } = await dbg.json();
    if (dbgJson.error) {
      const msg = String(dbgJson.error.message ?? "");
      if (/app|client|secret/i.test(msg)) return { ok: false, field: "app_secret", message: `App ID ou App Secret inválido: ${msg}` };
      return { ok: false, field: "app_id", message: `Falha ao validar o App: ${msg}` };
    }
    const data = dbgJson.data;
    if (!data || data.is_valid === false) {
      return { ok: false, field: "long_lived_token", message: `Token inválido ou expirado: ${data?.error?.message ?? "verifique o Long-Lived Access Token"}` };
    }
    if (String(data.app_id) !== String(c.app_id)) {
      return { ok: false, field: "app_id", message: "O App ID não corresponde ao token informado." };
    }
    const me = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(c.long_lived_token)}`);
    const meJson: { id?: string; name?: string; error?: { message?: string } } = await me.json();
    if (meJson.error) {
      return { ok: false, field: "long_lived_token", message: `Token rejeitado pela Meta: ${meJson.error.message}` };
    }
    // expires_at: 0 = never expires
    const expiresAt = typeof data.expires_at === "number"
      ? (data.expires_at === 0 ? null : data.expires_at)
      : undefined;
    return { ok: true, user: { id: meJson.id!, name: meJson.name }, expires_at: expiresAt };
  } catch (e) {
    return { ok: false, field: "general", message: `Falha de rede ao contactar a Meta: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function loadCreds(userId: string): Promise<Creds | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("meta_credentials")
    .select("app_id, app_secret, long_lived_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as Creds;
  const envApp = process.env.META_APP_ID;
  const envSecret = process.env.META_APP_SECRET;
  const envToken = process.env.META_LONG_LIVED_TOKEN;
  if (envApp && envSecret && envToken) return { app_id: envApp, app_secret: envSecret, long_lived_token: envToken };
  return null;
}

// Loose type alias to avoid a hard dep on the client type in this module
type SupabaseClient = {
  from: (t: string) => {
    select: (cols: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown | null; error: unknown }> } };
    update: (patch: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
    upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>;
  };
};

export const getMetaCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("meta_credentials")
      .select("app_id, app_secret, long_lived_token, last_tested_at, last_test_status, last_test_error, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      const envApp = process.env.META_APP_ID;
      const envSecret = process.env.META_APP_SECRET;
      const envToken = process.env.META_LONG_LIVED_TOKEN;
      if (envApp && envSecret && envToken) {
        // Never send app_secret / long_lived_token to the browser; only presence + last4.
        return {
          app_id: envApp,
          has_app_secret: true,
          has_long_lived_token: true,
          token_last4: envToken.slice(-4),
          last_tested_at: null,
          last_test_status: null,
          last_test_error: null,
          updated_at: null,
          seeded: true,
        };
      }
      return null;
    }
    const appSecret = (data as { app_secret?: string | null }).app_secret ?? "";
    const longToken = (data as { long_lived_token?: string | null }).long_lived_token ?? "";
    return {
      app_id: data.app_id,
      has_app_secret: Boolean(appSecret),
      has_long_lived_token: Boolean(longToken),
      token_last4: longToken ? longToken.slice(-4) : null,
      last_tested_at: data.last_tested_at,
      last_test_status: data.last_test_status,
      last_test_error: data.last_test_error,
      updated_at: data.updated_at,
      seeded: false,
    };
  });

export const testMetaCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Creds) => ({
    app_id: String(data.app_id ?? "").trim(),
    app_secret: String(data.app_secret ?? "").trim(),
    long_lived_token: String(data.long_lived_token ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    if (!data.app_id) return { ok: false as const, field: "app_id" as const, message: "Informe o Meta App ID." };
    if (!data.app_secret) return { ok: false as const, field: "app_secret" as const, message: "Informe o Meta App Secret." };
    if (!data.long_lived_token) return { ok: false as const, field: "long_lived_token" as const, message: "Informe o Long-Lived Access Token." };
    return await validateCreds(data);
  });

export const saveMetaCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Creds) => ({
    app_id: String(data.app_id ?? "").trim(),
    app_secret: String(data.app_secret ?? "").trim(),
    long_lived_token: String(data.long_lived_token ?? "").trim(),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await validateCreds(data);
    const nowIso = new Date().toISOString();
    if (!result.ok) {
      await supabaseAdmin.from("meta_credentials").upsert({
        user_id: context.userId,
        app_id: data.app_id,
        app_secret: data.app_secret,
        long_lived_token: data.long_lived_token,
        last_tested_at: nowIso,
        last_test_status: "error",
        last_test_error: result.message,
      }, { onConflict: "user_id" });
      return result;
    }
    const { error } = await supabaseAdmin.from("meta_credentials").upsert({
      user_id: context.userId,
      app_id: data.app_id,
      app_secret: data.app_secret,
      long_lived_token: data.long_lived_token,
      last_tested_at: nowIso,
      last_test_status: "connected",
      last_test_error: null,
    }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true as const, user: result.user, expires_at: result.expires_at };
  });

/** Retorna o status atual do token (usado pela contagem regressiva). */
export const getTokenStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await loadCreds(context.userId);
    if (!creds) return { connected: false as const, message: "Nenhuma credencial configurada." };
    const result = await validateCreds(creds);
    if (!result.ok) {
      return { connected: false as const, message: result.message, field: result.field };
    }
    return {
      connected: true as const,
      user: result.user,
      expires_at: result.expires_at,
    };
  });

/** Troca o long-lived token atual por um novo com validade renovada (~60 dias). */
export const refreshLongLivedToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await loadCreds(context.userId);
    if (!creds) return { ok: false as const, message: "Nenhuma credencial configurada." };
    try {
      const url = `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token`
        + `&client_id=${encodeURIComponent(creds.app_id)}`
        + `&client_secret=${encodeURIComponent(creds.app_secret)}`
        + `&fb_exchange_token=${encodeURIComponent(creds.long_lived_token)}`;
      const res = await fetch(url);
      const json: { access_token?: string; expires_in?: number; error?: { message?: string } } = await res.json();
      if (json.error || !json.access_token) {
        return { ok: false as const, message: `A Meta rejeitou a renovação: ${json.error?.message ?? "resposta inválida"}` };
      }
      const newCreds: Creds = { ...creds, long_lived_token: json.access_token };
      const val = await validateCreds(newCreds);
      const nowIso = new Date().toISOString();
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("meta_credentials").upsert({
        user_id: context.userId,
        app_id: newCreds.app_id,
        app_secret: newCreds.app_secret,
        long_lived_token: newCreds.long_lived_token,
        last_tested_at: nowIso,
        last_test_status: val.ok ? "connected" : "error",
        last_test_error: val.ok ? null : val.message,
      }, { onConflict: "user_id" });
      if (!val.ok) return { ok: false as const, message: val.message };
      return { ok: true as const, expires_at: val.expires_at, expires_in: json.expires_in ?? null };
    } catch (e) {
      return { ok: false as const, message: `Falha de rede: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

/**
 * Descoberta Automática de contas do Instagram vinculadas ao token salvo.
 * 1) GET /me/accounts -> Páginas do Facebook do usuário
 * 2) Para cada Página: fields=instagram_business_account,access_token,name
 * 3) Para cada IG vinculado: fields=username,profile_picture_url,followers_count,media_count,account_type
 * 4) Upsert em public.instagram_accounts (page_access_token, sem expiração explícita)
 */
export const discoverInstagramAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const creds = await loadCreds(context.userId);
    if (!creds) {
      return { ok: false as const, message: "Configure suas credenciais Meta em Configurações → Meta API antes." };
    }
    const { discoverAndSaveIgAccounts } = await import("./meta-discovery.server");
    return await discoverAndSaveIgAccounts(
      context.supabase as unknown as Parameters<typeof discoverAndSaveIgAccounts>[0],
      context.userId,
      creds.long_lived_token,
    );
  });

/**
 * Inicia o fluxo Instagram Business Login (direto no instagram.com, sem Facebook).
 * Requer INSTAGRAM_APP_ID/SECRET (Meta app > Instagram > API setup with Instagram business login).
 * Fallback para META_APP_ID/SECRET se as variáveis do Instagram não estiverem definidas.
 */
export const startInstagramOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const appId = process.env.INSTAGRAM_APP_ID ?? process.env.META_APP_ID;
    if (!appId) {
      return { ok: false as const, message: "INSTAGRAM_APP_ID não configurado no backend." };
    }

    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { error } = await context.supabase.from("meta_oauth_states").insert({
      state,
      user_id: context.userId,
    });
    if (error) {
      return { ok: false as const, message: `Falha ao iniciar OAuth: ${(error as { message: string }).message}` };
    }

    const req = getRequest();
    const origin =
      req.headers.get("origin") ??
      (req.headers.get("referer") ? new URL(req.headers.get("referer")!).origin : null) ??
      `https://${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
    const redirectUri = `${origin}/api/public/instagram/callback`;
    const scopes = [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_comments",
      "instagram_business_manage_messages",
    ].join(",");

    const url =
      `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&state=${encodeURIComponent(state)}`;

    return { ok: true as const, url, redirectUri };
  });

