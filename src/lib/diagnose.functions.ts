import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";

type ChatTurn = { role: "user" | "assistant"; content: string };

// ELITE Agent — o mesmo robô que faz o auto-healing conversa com o usuário
// através do chat flutuante. Recebe o estado atual da fila + histórico da
// conversa e responde de forma contextual.
export const diagnosePosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { question?: string; history?: ChatTurn[] }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: posts, error } = await supabase
      .from("scheduled_posts")
      .select("id, status, post_type, caption, scheduled_at, published_at, last_error, auto_retry_count, next_retry_at, attempts_log, ig_container_id, instagram_accounts(username)")
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: false })
      .limit(15);
    if (error) throw new Error(error.message);

    const { data: accts } = await supabase
      .from("instagram_accounts")
      .select("username, needs_manual_review, manual_review_reason");

    const flagged = (accts ?? []).filter((a: any) => a.needs_manual_review === true);

    const { data: heals } = await supabase
      .from("auto_healing_log")
      .select("action, reason, error, created_at, instagram_accounts(username)")
      .order("created_at", { ascending: false })
      .limit(10);

    const summary = (posts ?? []).map((p) => ({
      id: p.id.slice(0, 8),
      status: p.status,
      tipo: p.post_type,
      conta: (p as any).instagram_accounts?.username ?? "?",
      agendado: p.scheduled_at,
      publicado: p.published_at,
      legenda: (p.caption ?? "").slice(0, 60),
      erro: p.last_error,
      tentativas_auto: p.auto_retry_count,
      proximo_retry: p.next_retry_at,
      log: Array.isArray(p.attempts_log) ? p.attempts_log.slice(-5) : [],
    }));

    const { classifyError } = await import("@/lib/publish.server");
    const withCategory = summary.map((s) => ({
      ...s,
      categoria_erro: s.erro ? classifyError(s.erro).category : null,
    }));

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente");

    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);

    const system = `Você é o ELITE Agent — o robô que cuida da fila de publicações do Instagram deste usuário.
Fala português do Brasil, direto, curto, humano, sem enrolação. Use bullets quando ajudar.
Você é o mesmo agente que faz o auto-healing: reagenda posts, tenta de novo, respeita o ritmo de 1 reel a cada 20 min por conta e pausa contas que tomam rate limit.

Sua função:
1. Explicar o que está rolando (o que você já corrigiu sozinho e o que ainda está pendente).
2. Se o sistema já está resolvendo, diga "eu já estou cuidando disso" e explique quando vai postar.
3. Se precisar de ação do usuário, seja EXATO: "Reconecte @X em Contas", "Substitua o vídeo do post Y", "Ative a conta @Z".
4. Se aparecer uma conta como restrita no LOG mas ela NÃO estiver mais em revisão manual (needs_manual_review=false), diga claro: "essa conta já foi reativada, aquele log é histórico — a fila dela já voltou ao normal".
5. Se o usuário pedir para consertar/organizar/reagendar, explique o que vai fazer. Ações destrutivas ainda precisam ser feitas pelo usuário nos botões; você orienta.
6. Nunca invente. Se não tem info suficiente, diga "não consegui identificar, me manda o @conta ou id do post".
7. Saudação curta: cumprimente e ofereça "Quer que eu analise a fila agora?".`;

    const dataBlock = `## ESTADO ATUAL

Últimos posts:
${JSON.stringify(withCategory, null, 2)}

Contas em revisão manual (needs_manual_review=true) — ${flagged.length} conta(s):
${JSON.stringify(flagged, null, 2)}

Últimas correções automáticas aplicadas:
${JSON.stringify(heals ?? [], null, 2)}`;

    const history = Array.isArray(data.history) ? data.history.slice(-10) : [];
    const question = data.question?.trim() || "Analise a fila e me diga se tem algo travado.";

    const messages = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: `${question}\n\n${dataBlock}` },
    ];

    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system,
      messages: messages as any,
    });

    return {
      answer: text,
      posts_analyzed: withCategory.length,
      accounts_flagged: flagged.length,
    };
  });
