import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const assignVideosToAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ accountId: z.string().uuid(), ids: z.array(z.string().uuid()).min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: account, error: accountError } = await context.supabase.from("instagram_accounts").select("id").eq("id", data.accountId).single();
    if (accountError || !account) throw new Error("Conta não encontrada ou sem acesso");
    const ids = [...new Set(data.ids)];
    const { data: videos, error } = await context.supabase.from("media_assets").select("id, media_kind").in("id", ids);
    if (error || videos?.length !== ids.length || videos.some(v => v.media_kind !== "video")) throw new Error("Selecione apenas vídeos disponíveis na sua biblioteca");
    const { error: updateError } = await context.supabase.from("media_assets").update({ ig_account_id: data.accountId }).in("id", ids);
    if (updateError) throw new Error(updateError.message);
    return { count: ids.length };
  });

export const savePoolVideoOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ poolId: z.string().uuid(), ids: z.array(z.string().uuid()), manual: z.literal(true) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("save_pool_video_order", { p_pool_id: data.poolId, p_video_ids: data.ids, p_manual: data.manual });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
