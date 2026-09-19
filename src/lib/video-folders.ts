import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
export type VideoFolder = { id: string; name: string };
export function useVideoFolders() {
  return useQuery({ queryKey: ["video-folders"], queryFn: async (): Promise<VideoFolder[]> => {
    const {data,error}=await (supabase as any).from("media_folders").select("id,name").order("created_at").order("name");
    if(error) throw new Error("Aplique o SQL de pastas de vídeos neste painel.");
    return (data??[]).sort((a:VideoFolder,b:VideoFolder)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  }});
}

