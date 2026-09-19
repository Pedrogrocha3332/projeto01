import { createFileRoute } from "@tanstack/react-router";

// Monitor de auto-recuperação.
// Roda a cada ~3 min via pg_cron. Detecta posts travados / falhos,
// tenta resolver sozinho (até 3 vezes com backoff 5/15/30 min),
// e só notifica o usuário quando todas as tentativas se esgotarem.

export const Route = createFileRoute("/api/public/cron/monitor-posts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey") ?? request.headers.get("x-supabase-key");
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          attemptRecovery,
          recordAttempt,
          scheduleNextAutoRetry,
          markPostFailedFinal,
          classifyError,
          handleRestrictedAccount,
          MAX_AUTO_RETRIES,
          logHealing,
          checkAccountCircuitBreaker,
        } = await import("@/lib/publish.server");

        const { tickPublicationRounds } = await import("@/lib/rounds.server");
        const rounds = await tickPublicationRounds();
        if (rounds.reserved) return Response.json({ processed: 0, reason: "Publicação em rodadas reserva o painel" });

        const now = new Date();
        const nowIso = now.toISOString();
        const stuckPublishingCutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
        const staleLockCutoff = new Date(now.getTime() - 5 * 60_000).toISOString();
        const staleScheduledCutoff = new Date(now.getTime() - 5 * 60_000).toISOString();

        // Candidatos:
        //  - "publishing" há mais de 10min sem update (travado)
        //  - "failed" que ainda pode tentar
        //  - "scheduled" cujo horário passou há mais de 5min e nunca foi pego
        //    (o publish cron pegaria; se não pegou, promovemos para retry aqui)
        const { data: candidates, error } = await supabaseAdmin
          .from("scheduled_posts")
          .select("id, status, auto_retry_count, next_retry_at, processing_lock_at, updated_at, ig_account_id, user_id, scheduled_at")
          .in("status", ["publishing", "failed", "scheduled"])
          .is("round_run_id", null)
          .lt("auto_retry_count", MAX_AUTO_RETRIES)
          .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
          .or(`processing_lock_at.is.null,processing_lock_at.lt.${staleLockCutoff}`)
          .order("updated_at", { ascending: true })
          .limit(20);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        const results: Array<Record<string, unknown>> = [];
        const busyAccounts = new Set<string>();

        for (const c of candidates ?? []) {
          // Filtra "publishing" só quando realmente estiver travado (>10min sem update).
          if (c.status === "publishing" && c.updated_at && c.updated_at > stuckPublishingCutoff) continue;
          // Filtra "scheduled" só quando já passou do horário há >5min sem ninguém pegar.
          if (c.status === "scheduled" && (!c.scheduled_at || c.scheduled_at > staleScheduledCutoff)) continue;

          // Uma tentativa por conta por tick (evita bombardear a Meta na mesma conta).
          if (c.ig_account_id && busyAccounts.has(c.ig_account_id)) continue;

          // Lock atômico: só processa se conseguirmos setar processing_lock_at agora.
          const { data: locked, error: lockErr } = await supabaseAdmin
            .from("scheduled_posts")
            .update({ processing_lock_at: nowIso, updated_at: nowIso })
            .eq("id", c.id)
            .or(`processing_lock_at.is.null,processing_lock_at.lt.${staleLockCutoff}`)
            .select("id")
            .maybeSingle();
          if (lockErr || !locked) {
            results.push({ id: c.id, skipped: "lock_taken" });
            continue;
          }
          if (c.ig_account_id) busyAccounts.add(c.ig_account_id);

          const attemptNumber = (c.auto_retry_count ?? 0) + 1;

          // Notifica por WhatsApp na 1ª vez que detectar um post travado em "publishing" >10min.
          if (c.status === "publishing" && attemptNumber === 1 && c.ig_account_id) {
            try {
              const { data: acc } = await supabaseAdmin
                .from("instagram_accounts").select("username").eq("id", c.ig_account_id).maybeSingle();
              const { sendWhatsApp, formatTs } = await import("@/lib/notify.server");
              await sendWhatsApp(
                `⏳ ELITE: post travado em "publishing" há mais de 10 min em @${acc?.username ?? "conta"}. Tentando destravar. Horário: ${formatTs()}`,
              );
            } catch (e) { console.warn("notify stuck falhou", e); }
          }

          try {
            const outcome = await attemptRecovery(c.id);

            if (outcome.kind === "still_processing") {
              // Não conta como tentativa — Meta ainda está processando.
              await recordAttempt(c.id, {
                at: new Date().toISOString(),
                attempt: c.auto_retry_count ?? 0,
                action: "check_status",
                ok: true,
                meta_status: outcome.meta_status,
              });
              results.push({ id: c.id, outcome: "still_processing" });
              continue;
            }

            if (outcome.kind === "delayed") {
              await recordAttempt(c.id, {
                at: new Date().toISOString(),
                attempt: c.auto_retry_count ?? 0,
                action: `delayed_${outcome.reason ?? "safety"}`,
                ok: true,
              });
              results.push({ id: c.id, outcome: "delayed", scheduled_at: outcome.scheduled_at, reason: outcome.reason });
              continue;
            }

            if (
              outcome.kind === "published" ||
              outcome.kind === "recovered_publish" ||
              outcome.kind === "recreated_and_published"
            ) {
              await recordAttempt(c.id, {
                at: new Date().toISOString(),
                attempt: attemptNumber,
                action: outcome.kind,
                ok: true,
              });
              await supabaseAdmin
                .from("scheduled_posts")
                .update({
                  processing_lock_at: null,
                  next_retry_at: null,
                  last_error: null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", c.id);
              await logHealing({
                postId: c.id,
                userId: c.user_id,
                igAccountId: c.ig_account_id,
                action: outcome.kind,
                reason: "Post recuperado automaticamente pelo self-healing",
                originalAt: c.scheduled_at,
                metadata: { attempt: attemptNumber },
              });
              results.push({ id: c.id, outcome: outcome.kind });
              continue;
            }

            // Failed
            const errMsg = outcome.error;
            const classified = classifyError(errMsg);
            await recordAttempt(c.id, {
              at: new Date().toISOString(),
              attempt: attemptNumber,
              action: "recover",
              ok: false,
              error: `[${classified.category}] ${errMsg}`,
            });

            // Erros não recuperáveis → falha final imediata (não desperdiça tentativas).
            if (!classified.retryable) {
              if (classified.category === "user_restricted" && c.ig_account_id) {
                await handleRestrictedAccount(c.ig_account_id, errMsg);
              }
              await markPostFailedFinal(c.id, classified.userMessage);
              await logHealing({
                postId: c.id,
                userId: c.user_id,
                igAccountId: c.ig_account_id,
                action: "failed_final",
                category: classified.category,
                reason: "Erro não recuperável — sem novas tentativas",
                error: errMsg,
              });
              if (c.ig_account_id) await checkAccountCircuitBreaker(c.ig_account_id);
              results.push({ id: c.id, outcome: "failed_final", category: classified.category, error: classified.userMessage });
              continue;
            }

            if (attemptNumber >= MAX_AUTO_RETRIES) {
              await markPostFailedFinal(c.id, classified.userMessage);
              await logHealing({
                postId: c.id,
                userId: c.user_id,
                igAccountId: c.ig_account_id,
                action: "failed_final",
                category: classified.category,
                reason: `Esgotadas ${MAX_AUTO_RETRIES} tentativas automáticas`,
                error: errMsg,
              });
              if (c.ig_account_id) await checkAccountCircuitBreaker(c.ig_account_id);
              results.push({ id: c.id, outcome: "failed_final", category: classified.category, error: classified.userMessage });
            } else {
              await supabaseAdmin
                .from("scheduled_posts")
                .update({
                  status: "failed",
                  last_error: errMsg.slice(0, 500),
                })
                .eq("id", c.id);
              const sched = await scheduleNextAutoRetry(c.id, attemptNumber, classified.backoffMinutes);
              await logHealing({
                postId: c.id,
                userId: c.user_id,
                igAccountId: c.ig_account_id,
                action: "retry_scheduled",
                category: classified.category,
                reason: `Nova tentativa automática (${attemptNumber}/${MAX_AUTO_RETRIES}) em ${sched.minutes}min`,
                originalAt: c.scheduled_at,
                newAt: sched.next_retry_at,
                error: errMsg,
                metadata: { attempt: attemptNumber },
              });
              if (c.ig_account_id) await checkAccountCircuitBreaker(c.ig_account_id);
              results.push({
                id: c.id,
                outcome: "retry_scheduled",
                category: classified.category,
                attempt: attemptNumber,
                next_retry_at: sched.next_retry_at,
                error: errMsg,
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await recordAttempt(c.id, {
              at: new Date().toISOString(),
              attempt: attemptNumber,
              action: "recover_exception",
              ok: false,
              error: msg,
            });
            if (attemptNumber >= MAX_AUTO_RETRIES) {
              await markPostFailedFinal(c.id, msg);
              await logHealing({
                postId: c.id,
                userId: c.user_id,
                igAccountId: c.ig_account_id,
                action: "failed_final",
                reason: "Exceção após esgotar tentativas automáticas",
                error: msg,
              });
              if (c.ig_account_id) await checkAccountCircuitBreaker(c.ig_account_id);
              results.push({ id: c.id, outcome: "failed_final", error: msg });
            } else {
              await supabaseAdmin
                .from("scheduled_posts")
                .update({ status: "failed", last_error: msg.slice(0, 500) })
                .eq("id", c.id);
              const sched = await scheduleNextAutoRetry(c.id, attemptNumber);
              await logHealing({
                postId: c.id,
                userId: c.user_id,
                igAccountId: c.ig_account_id,
                action: "retry_scheduled",
                reason: `Exceção — retry automático (${attemptNumber}/${MAX_AUTO_RETRIES}) em ${sched.minutes}min`,
                originalAt: c.scheduled_at,
                newAt: sched.next_retry_at,
                error: msg,
                metadata: { attempt: attemptNumber },
              });
              if (c.ig_account_id) await checkAccountCircuitBreaker(c.ig_account_id);
              results.push({ id: c.id, outcome: "retry_scheduled", attempt: attemptNumber, next_retry_at: sched.next_retry_at, error: msg });
            }
          }
        }

        return new Response(JSON.stringify({ processed: results.length, results }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
