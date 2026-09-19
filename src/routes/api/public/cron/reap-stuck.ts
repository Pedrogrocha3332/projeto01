import { createFileRoute } from "@tanstack/react-router";

// Reaper — marca como "failed" posts travados em "publishing" há muito tempo.
// Chamado a cada minuto por pg_cron.

const STUCK_MINUTES = 15;

export const Route = createFileRoute("/api/public/cron/reap-stuck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey") ?? request.headers.get("x-supabase-key");
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
        const { data: stuck, error } = await supabaseAdmin
          .from("scheduled_posts")
          .select("id, user_id, ig_account_id, post_type")
          .eq("status", "publishing")
          .lt("updated_at", cutoff);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const results: string[] = [];
        for (const p of stuck ?? []) {
          const msg = `Publicação travada em "publishing" por mais de ${STUCK_MINUTES} minutos sem resposta da Meta. Marcada como falha automaticamente — use "Tentar novamente".`;
          await supabaseAdmin
            .from("scheduled_posts")
            .update({ status: "failed", last_error: msg })
            .eq("id", p.id)
            .eq("status", "publishing");

          let username = "conta";
          if (p.ig_account_id) {
            const { data: acc } = await supabaseAdmin
              .from("instagram_accounts")
              .select("username")
              .eq("id", p.ig_account_id)
              .maybeSingle();
            if (acc?.username) username = `@${acc.username}`;
          }
          const typeLabel = p.post_type === "reel" ? "Reel" : p.post_type === "carousel" ? "Carrossel" : "Foto";
          await supabaseAdmin.from("notifications").insert({
            user_id: p.user_id,
            type: "publish_failed",
            title: `Falha ao publicar ${typeLabel} em ${username}`,
            message: msg,
            metadata: { post_id: p.id, reason: "stuck_publishing" },
          });
          results.push(p.id);
        }

        return new Response(JSON.stringify({ reaped: results.length, ids: results }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
