import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { validatePoolVideos } from "./media-account.server";

const AccountSchema = z.object({
  ig_account_id: z.string().uuid(),
  video_ids: z.array(z.string().uuid()).min(1).max(500),
  first_comment: z.string().max(2200).optional(),
  caption: z.string().max(2200).default(""),
  caption_2: z.string().max(2200).default(""),
  caption_3: z.string().max(2200).default(""),
  spacing_seconds: z.number().int().min(0).max(1800).default(60),
  cover_media_id: z.string().uuid().nullable().default(null),
});
const ConfigSchema = z.object({
  id: z.string().uuid().nullable().default(null), name: z.string().trim().min(1).max(120),
  batch_size: z.number().int().min(1).max(100).default(10),
  round_interval_minutes: z.number().int().min(0).max(10080).default(0),
  concurrent_accounts: z.number().int().min(1).max(5).default(2),
  total_per_account: z.number().int().min(1).max(1000).default(20),
  accounts: z.array(AccountSchema).min(1).max(100),
});
export type RoundConfig = z.output<typeof ConfigSchema>;

export const saveRound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((d: unknown) => ConfigSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (new Set(data.accounts.map(a => a.ig_account_id)).size !== data.accounts.length) throw new Error("Selecione cada conta apenas uma vez");
    for (const a of data.accounts) {
      await validatePoolVideos(context.supabase, a.ig_account_id, a.video_ids);
      if (a.cover_media_id) {
        const { data: cover, error } = await context.supabase.from("media_assets").select("media_kind").eq("id", a.cover_media_id).single();
        if (error || !cover || cover.media_kind === "video") throw new Error("Capa não encontrada ou sem acesso");
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: migrationError } = await (supabaseAdmin as any).from("publication_rounds").select("concurrent_accounts").limit(0);
    if (migrationError) throw new Error("Aplique o SQL de contas simultâneas neste painel antes de salvar a execução.");
    if (data.round_interval_minutes>0) {
      const { error: intervalError } = await (supabaseAdmin as any).from("publication_rounds").select("round_interval_minutes,active_participant_ids").limit(0);
      if (intervalError) throw new Error("Aplique o SQL de espera por conta e reposição de falhas neste painel antes de configurar a espera.");
    }
    if (data.accounts.some(a => a.first_comment?.trim())) {
      const { error: commentError } = await (supabaseAdmin as any).from("publication_round_accounts").select("first_comment").limit(0);
      if (commentError) throw new Error("Aplique o SQL de comentário automático neste painel antes de preencher o comentário.");
    }
    const { data: id, error } = await (supabaseAdmin as any).rpc("save_publication_round", { p_user: context.userId, p_id: data.id, p_config: data });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const controlRound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), action: z.enum(["start", "pause", "resume", "cancel"]) }).parse(d))
  .handler(async ({ data, context }) => {
    // Revalida acesso aos arquivos/contas ao iniciar, inclusive rascunhos antigos.
    if (data.action === "start" || data.action === "resume") {
      const db = context.supabase as any;
      const { data: run, error } = await db.from("publication_rounds").select("id").eq("id", data.id).eq("user_id", context.userId).single();
      if (error || !run) throw new Error("Execução não encontrada");
      const { data: accounts, error: accountsError } = await db.from("publication_round_accounts").select("*").eq("run_id", data.id);
      if (accountsError) throw new Error(accountsError.message);
      for (const a of (accounts ?? []).filter((a: { stopped_at?: string | null }) => !a.stopped_at)) await validatePoolVideos(context.supabase, a.ig_account_id, a.video_ids);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).rpc("control_publication_round", { p_id: data.id, p_user: context.userId, p_action: data.action });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
