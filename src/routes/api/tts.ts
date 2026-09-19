import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Text-to-speech authenticated route. Uses Lovable AI Gateway
// (openai/gpt-4o-mini-tts) with a J.A.R.V.I.S.-style persona and returns
// a single MP3 file (simpler and more reliable than SSE parsing).
export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authz = request.headers.get("authorization") ?? "";
        const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
        if (!token) return new Response("Unauthorized", { status: 401 });

        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );
        const { data: u, error: authErr } = await sb.auth.getUser(token);
        if (authErr || !u.user) return new Response("Unauthorized", { status: 401 });

        let body: { text?: string } = {};
        try { body = (await request.json()) as { text?: string }; } catch { /* ignore */ }
        const text = (body.text ?? "").toString().trim();
        if (!text) return new Response("Missing text", { status: 400 });
        if (text.length > 6000) return new Response("Text too long", { status: 400 });

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("LOVABLE_API_KEY missing", { status: 500 });

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini-tts",
            input: `Sr. Matheus, ${text}`,
            voice: "onyx",
            response_format: "mp3",
            instructions:
              "Você é J.A.R.V.I.S., o assistente do Homem de Ferro. Fale em português do Brasil com sotaque e postura de mordomo britânico: voz masculina grave, calma, articulada, ligeiramente formal, com leve ironia e sofisticação. Trate o usuário sempre como 'Sr. Matheus'. Ritmo pausado e preciso, sem emoção exagerada, sem risadas, sem gírias. Nunca quebre o personagem.",
          }),
        });

        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          return new Response(`TTS upstream ${upstream.status}: ${detail}`, { status: upstream.status });
        }

        const audio = await upstream.arrayBuffer();
        return new Response(audio, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
