import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const IG_GRAPH = "https://graph.instagram.com";

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(status: number, title: string, message: string, ok = false) {
  const color = ok ? "#22c55e" : "#ef4444";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${safeTitle}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{max-width:480px;background:#141414;border:1px solid #262626;border-radius:16px;padding:32px;text-align:center}
h1{color:${color};margin:0 0 12px;font-size:22px}
p{color:#a3a3a3;line-height:1.5;margin:0 0 24px;font-size:14px;white-space:pre-wrap}
a{display:inline-block;background:linear-gradient(135deg,#d4af37,#f4d03f);color:#000;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px}
</style></head>
<body><div class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p>
<a href="/accounts">Voltar para Contas</a></div>
<script>setTimeout(()=>{location.href="/accounts"},${ok ? 2500 : 8000})</script>
</body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export const Route = createFileRoute("/api/public/instagram/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description") ?? url.searchParams.get("error_reason");

        if (errorParam) return htmlResponse(400, "Autorização cancelada", errorDesc ?? errorParam);
        if (!code || !state) return htmlResponse(400, "Requisição inválida", "Faltam parâmetros code/state no retorno do Instagram.");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: stateRow, error: stateErr } = await supabaseAdmin
          .from("meta_oauth_states")
          .select("user_id, expires_at")
          .eq("state", state)
          .maybeSingle();
        if (stateErr || !stateRow) return htmlResponse(400, "State inválido", "Este link expirou ou já foi usado. Tente novamente.");
        if (new Date(stateRow.expires_at).getTime() < Date.now()) {
          await supabaseAdmin.from("meta_oauth_states").delete().eq("state", state);
          return htmlResponse(400, "Link expirado", "Tempo esgotado. Tente novamente.");
        }
        const userId = stateRow.user_id;
        await supabaseAdmin.from("meta_oauth_states").delete().eq("state", state);

        const appId = process.env.INSTAGRAM_APP_ID ?? process.env.META_APP_ID;
        const appSecret = process.env.INSTAGRAM_APP_SECRET ?? process.env.META_APP_SECRET;
        if (!appId || !appSecret) return htmlResponse(500, "Credenciais faltando", "Configure INSTAGRAM_APP_ID/SECRET.");

        // Code must be sent WITHOUT the trailing "#_" that Instagram appends
        const cleanCode = code.replace(/#_$/, "");
        const redirectUri = `https://${url.host}/api/public/instagram/callback`;

        try {
          // 1) code -> short-lived token (form-encoded POST)
          const form = new URLSearchParams({
            client_id: appId,
            client_secret: appSecret,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
            code: cleanCode,
          });
          const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form.toString(),
          });
          const shortText = await shortRes.text();
          let shortJson: { access_token?: string; user_id?: number | string; permissions?: string[]; error_type?: string; error_message?: string; error?: { message?: string } };
          try { shortJson = JSON.parse(shortText); } catch { return htmlResponse(400, "Resposta inválida do Instagram", shortText.slice(0, 400)); }
          if (!shortJson.access_token) {
            const msg = shortJson.error_message ?? shortJson.error?.message ?? shortText;
            return htmlResponse(400, "Falha ao trocar código", msg);
          }

          // 2) short-lived -> long-lived (~60 dias)
          const llUrl = `${IG_GRAPH}/access_token?grant_type=ig_exchange_token`
            + `&client_secret=${encodeURIComponent(appSecret)}`
            + `&access_token=${encodeURIComponent(shortJson.access_token)}`;
          const llRes = await fetch(llUrl);
          const llJson: { access_token?: string; expires_in?: number; error?: { message?: string } } = await llRes.json();
          const longToken = llJson.access_token ?? shortJson.access_token;
          const expiresIn = llJson.expires_in ?? null;
          const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

          // 3) fetch profile
          const meUrl = `${IG_GRAPH}/v21.0/me?fields=user_id,username,account_type,profile_picture_url,followers_count,media_count&access_token=${encodeURIComponent(longToken)}`;
          const meRes = await fetch(meUrl);
          const me: { user_id?: string; id?: string; username?: string; account_type?: string; profile_picture_url?: string; followers_count?: number; media_count?: number; error?: { message?: string } } = await meRes.json();
          if (me.error || (!me.user_id && !me.id)) {
            return htmlResponse(400, "Não consegui ler o perfil", me.error?.message ?? "Verifique se a conta é Profissional (Business/Creator).");
          }
          const igUserId = String(me.user_id ?? me.id);

          const supabaseSrv = createClient<Database>(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );

          const { error: upErr } = await supabaseSrv.from("instagram_accounts").upsert({
            user_id: userId,
            ig_user_id: igUserId,
            username: me.username ?? "",
            account_type: me.account_type ?? null,
            profile_picture_url: me.profile_picture_url ?? null,
            followers_count: me.followers_count ?? 0,
            media_count: me.media_count ?? 0,
            access_token: longToken,
            token_expires_at: tokenExpiresAt,
            page_id: null,
            page_name: null,
            is_active: true,
          }, { onConflict: "user_id,ig_user_id" });

          if (upErr) return htmlResponse(500, "Erro ao salvar", upErr.message);

          return htmlResponse(200, "✓ Instagram conectado!", `@${me.username} vinculado com sucesso. Redirecionando...`, true);
        } catch (e) {
          return htmlResponse(500, "Erro inesperado", e instanceof Error ? e.message : String(e));
        }
      },
    },
  },
});
