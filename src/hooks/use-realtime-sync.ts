import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Subscription única e leve: qualquer mudança nas tabelas compartilhadas
// invalida as queries mais afetadas, para os dois admins verem tudo em tempo real.
const TABLES = [
  "instagram_accounts",
  "media_assets",
  "media_pools",
  "pool_videos",
  "scheduled_posts",
  "notifications",
] as const;

export function useRealtimeSync() {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase.channel("admin-sync");
    for (const table of TABLES) {
      channel.on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table } as never,
        () => {
          // Invalida queries relacionadas — cache-based, cheap.
          if (table === "media_assets") qc.invalidateQueries({ queryKey: ["media-videos-selectable"] });
          if (table === "instagram_accounts") {
            qc.invalidateQueries({ queryKey: ["pools-accounts"] });
            qc.invalidateQueries({ queryKey: ["ig-accounts-queue"] });
            qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
          }
          if (table === "media_pools" || table === "pool_videos") {
            qc.invalidateQueries({ queryKey: ["media-pools"] });
            qc.invalidateQueries({ queryKey: ["pool-video-counts"] });
          }
          if (table === "scheduled_posts") {
            qc.invalidateQueries({ queryKey: ["queue"] });
            qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
          }
          if (table === "notifications") {
            qc.invalidateQueries({ queryKey: ["notifications"] });
          }
        },
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
