import { createFileRoute } from "@tanstack/react-router";

// Cron: processa todos os pools de rotação ativos vencidos e enfileira lotes.
export const Route = createFileRoute("/api/public/cron/process-pools")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey") ?? request.headers.get("x-supabase-key");
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { processAllDuePools } = await import("@/lib/pools.server");
        try {
          const { tickPublicationRounds } = await import("@/lib/rounds.server");
          const rounds = await tickPublicationRounds();
          const result = rounds.reserved ? { processed: 0, rounds } : await processAllDuePools();
          return new Response(JSON.stringify(result), {
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "erro";
          return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
