import { createFileRoute } from "@tanstack/react-router";

// Cron endpoint — called every minute by pg_cron.
// Fetches posts scheduled_at <= now() AND status='scheduled', publishes each,
// and records success/error per post.

export const Route = createFileRoute("/api/public/cron/publish-scheduled")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey") ?? request.headers.get("x-supabase-key");
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { processScheduledPostTick, markPostFailed } = await import("@/lib/publish.server");

        const { tickPublicationRounds } = await import("@/lib/rounds.server");
        let rounds: Awaited<ReturnType<typeof tickPublicationRounds>>;
        try { rounds = await tickPublicationRounds(); } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "Erro nas rodadas" }, { status: 500 });
        }
        const nowIso = new Date().toISOString();
        const publishingCutoff = new Date(Date.now() - 60_000).toISOString();

        // Continua os envios em processamento e inicia os posts vencidos em lotes.
        const publishingQuery = supabaseAdmin
          .from("scheduled_posts")
          .select("id, ig_account_id")
          .eq("status", "publishing")
          .lt("updated_at", publishingCutoff)
          .order("scheduled_at", { ascending: true })
          .limit(50);

        if (rounds.reserved && rounds.run_id) publishingQuery.eq("round_run_id", rounds.run_id);
        const { data: duePublishing, error: publishingError } = await publishingQuery;
        if (publishingError) {
          return new Response(JSON.stringify({ error: publishingError.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const scheduledQuery = supabaseAdmin
          .from("scheduled_posts")
          .select("id, ig_account_id")
          .eq("status", "scheduled")
          .lte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(50);

        if (rounds.reserved && rounds.run_id) scheduledQuery.eq("round_run_id", rounds.run_id);
        const { data: dueScheduled, error: scheduledError } = await scheduledQuery;
        if (scheduledError) {
          return new Response(JSON.stringify({ error: scheduledError.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const results: Array<{ id: string; ok: boolean; status?: string; error?: string }> = [];
        const processOne = async (p: { id: string }) => {
          try {
            const r = await processScheduledPostTick(p.id);
            results.push({ id: p.id, ok: true, status: r.status });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "erro";
            await markPostFailed(p.id, msg);
            results.push({ id: p.id, ok: false, error: msg });
          }
        };
        const due = [...(duePublishing ?? []), ...(dueScheduled ?? [])];
        if (rounds.reserved) {
          // A porta no banco admite apenas um envio por conta do grupo atual.
          const concurrency = Math.max(1, Math.min(5, Math.floor(rounds.concurrent_accounts ?? 2)));
          for (let offset = 0; offset < due.length; offset += concurrency) {
            await Promise.all(due.slice(offset, offset + concurrency).map(processOne));
          }
        } else {
          for (const p of due) await processOne(p);
        }

        return new Response(JSON.stringify({ processed: results.length, results }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
