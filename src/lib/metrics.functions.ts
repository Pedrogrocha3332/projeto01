import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SyncSingleSchema = z.object({
  postId: z.string().uuid(),
});

const SyncBatchSchema = z.object({
  accountId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const refreshPostMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SyncSingleSchema.parse(data))
  .handler(async ({ data }) => {
    const { syncSinglePostMetrics } = await import("./metrics.server");
    return await syncSinglePostMetrics(data.postId);
  });

export const refreshRecentMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SyncBatchSchema.parse(data))
  .handler(async ({ data }) => {
    const { syncRecentPostsMetrics } = await import("./metrics.server");
    return await syncRecentPostsMetrics(data);
  });
