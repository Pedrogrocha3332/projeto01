import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Reinicia todo o processo de publicação para um post travado/falho.
// Chamado pelo botão "Tentar novamente manualmente" no sino de notificações.
export const retryPostManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { postId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Confirma que o post pertence ao usuário (RLS + double-check).
    const { data: post, error } = await supabase
      .from("scheduled_posts")
      .select("id, user_id")
      .eq("id", data.postId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!post || post.user_id !== userId) throw new Error("Post não encontrado");

    const { resetPostForManualRetry } = await import("@/lib/publish.server");
    await resetPostForManualRetry(data.postId);

    // Marca notificações relacionadas como lidas.
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("type", "publish_failed_final")
      .contains("metadata", { post_id: data.postId });

    return { ok: true };
  });
