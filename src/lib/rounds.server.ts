import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as any;
export async function tickPublicationRounds(): Promise<{ reserved: boolean; concurrent_accounts?: number; run_id?: string; status?: string; post_id?: string }> {
  const { data, error } = await db.rpc("tick_publication_rounds");
  if (error) throw new Error(error.message);
  return data;
}

// O token impede que uma chamada atrasada libere o lock de outra execução.
export async function claimPublicationSend(postId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const { data, error } = await db.rpc("claim_publication_send", { p_post: postId, p_token: token });
  if (error) throw new Error(error.message);
  return data ? token : null;
}
export async function releasePublicationSend(postId: string, token: string) {
  const { error } = await db.rpc("release_publication_send", { p_post: postId, p_token: token });
  // Nunca transforme uma publicação confirmada em falha por erro ao liberar lock.
  if (error) console.error("[rounds] release failed", error.message);
}

export const publicationWait = () => ({
  scheduled_at: new Date(Date.now() + 60_000).toISOString(),
  reason: "Publicação aguardando sua vez ou outra execução em processamento",
});
