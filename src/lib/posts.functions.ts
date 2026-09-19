import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InputSchema = z.object({ postId: z.string().uuid() });

export const publishNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Verify caller owns this post
    const { data: post, error } = await context.supabase
      .from("scheduled_posts")
      .select("id, status")
      .eq("id", data.postId)
      .single();
    if (error || !post) throw new Error("Publicação não encontrada");

    if (!["scheduled", "failed", "draft"].includes(post.status)) {
      throw new Error("Esta publicação já foi enviada ou está em processamento");
    }

    const { processScheduledPostTick, markPostFailed } = await import("./publish.server");
    try {
      const r = await processScheduledPostTick(data.postId, { publishNow: true });
      if (r.status === "published") {
        return { ok: true as const, status: r.status, media_id: r.ig_media_id, permalink: r.permalink };
      }
      if (r.status === "delayed") {
        return { ok: true as const, status: r.status, scheduled_at: r.scheduled_at, reason: r.reason };
      }
      return { ok: true as const, status: r.status, container_id: r.container_id };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      await markPostFailed(data.postId, msg);
      throw new Error(msg);
    }
  });
