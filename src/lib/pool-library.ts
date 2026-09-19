import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export function filterPoolVideos<T extends { ig_account_id?: string | null; folder_id?: string | null; file_name: string }>(videos: T[], source: string, search: string): T[] {
  const term = search.trim().toLocaleLowerCase();
  return videos.filter(video =>
    (source === "all" || (source === "unassigned" ? video.folder_id == null : video.folder_id === source)) &&
    (!term || video.file_name.toLocaleLowerCase().includes(term)),
  );
}

export async function loadPoolLibrary(db: SupabaseClient<Database>) {
  const pageSize = 500;
  const page = (offset: number) => db.from("media_assets")
    .select("*")
    .eq("media_kind", "video")
    .order("created_at", { ascending: false }).order("id")
    .range(offset, offset + pageSize - 1);
  const first = await page(0);
  if (first.error) throw first.error;
  const videos = first.data ?? [];
  for (let offset = pageSize; videos.length === offset; offset += pageSize) {
    const next = await page(offset);
    if (next.error) throw next.error;
    videos.push(...(next.data ?? []));
  }
  return videos;
}
