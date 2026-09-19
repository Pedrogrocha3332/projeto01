import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function validatePoolVideos(db: SupabaseClient<Database>, accountId: string, ids: string[]) {
  const { data: account, error: accountError } = await db.from("instagram_accounts").select("id").eq("id", accountId).single();
  if (accountError || !account) throw new Error("Conta não encontrada ou sem acesso");
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("Remova os vídeos repetidos da seleção");
  if (!unique.length) return;
  const { data, error } = await db.from("media_assets").select("id, media_kind, ig_account_id").in("id", unique);
  if (error) throw new Error("Não foi possível verificar os vídeos. Confira se a atualização SQL foi aplicada.");
  if (data?.length !== unique.length || data.some(v => v.media_kind !== "video")) {
    throw new Error("Selecione somente vídeos disponíveis na sua Biblioteca");
  }
}
