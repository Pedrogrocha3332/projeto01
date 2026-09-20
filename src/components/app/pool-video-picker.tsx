import { CheckCircle2 } from "lucide-react";
import { VideoThumb } from "./video-thumb";

type Video = { id: string; file_name: string; storage_path: string; public_url: string; thumbnail_url?: string | null; thumbnail_path?: string | null; tags?: string[] | null };
export function PoolVideoPicker({ videos, selected, onToggle }: { videos: Video[]; selected: string[]; onToggle: (id: string) => void }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {videos.map(v => {
      const checked = selected.includes(v.id);
      const isCamuflando = v.tags?.includes("pendente_camuflagem") || v.tags?.includes("processando_camuflagem");
      return <button key={v.id} type="button" aria-pressed={checked} title={v.file_name} onClick={() => onToggle(v.id)}
        className={`min-w-0 overflow-hidden rounded-lg border-2 text-left ${checked ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
        <div className="relative aspect-[3/4]">
          <VideoThumb storagePath={v.storage_path} thumbnailUrl={v.thumbnail_url} thumbnailPath={v.thumbnail_path} videoUrl={v.public_url} fileName={v.file_name} className="h-full w-full" />
          <span className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[8px] font-semibold ${
            isCamuflando ? "bg-amber-500 text-black animate-pulse shadow-sm" : "bg-emerald-600 text-white shadow-sm"
          }`}>
            {isCamuflando ? "🟡 Camuflando..." : "🟢 Pronto"}
          </span>
          {checked && <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><CheckCircle2 className="h-5 w-5" /></span>}
        </div>
        <div className="min-h-12 bg-card px-2 py-2 text-xs leading-4 text-foreground line-clamp-2 break-all">{v.file_name}</div>
      </button>;
    })}
  </div>;
}

