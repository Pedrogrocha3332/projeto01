import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";
import { resolveVideoThumbnail } from "@/lib/video-thumbnail";

type Props = {
  storagePath: string;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  videoUrl?: string | null;
  fileName?: string;
  className?: string;
  priority?: boolean;
};

export function VideoThumb({ storagePath, thumbnailUrl, thumbnailPath, videoUrl, fileName, className, priority = false }: Props) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [inView, setInView] = useState(priority);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inView || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setInView(true); observer.disconnect(); }
    }, { rootMargin: "150px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [inView]);
  useEffect(() => {
    setThumb(null); setFailed(false);
    if (!inView) return;
    let cancelled = false;
    resolveVideoThumbnail({ storagePath, thumbnailUrl, thumbnailPath, videoUrl }).then(
      src => { if (!cancelled) setThumb(src); },
      () => { if (!cancelled) setFailed(true); },
    );
    return () => { cancelled = true; };
  }, [inView, storagePath, thumbnailUrl, thumbnailPath, videoUrl]);
  return <div ref={ref} className={`relative overflow-hidden bg-muted ${className ?? ""}`}>
    {thumb && !failed ? <img src={thumb} alt={fileName ?? "Prévia do vídeo"} className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} /> :
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-800 px-3 text-center text-zinc-200">
        <Film className="h-7 w-7" />
        <span className="text-xs">{failed ? "Prévia indisponível neste navegador" : "Carregando prévia…"}</span>
        <span className="line-clamp-2 break-all text-xs">{fileName}</span>
      </div>}
  </div>;
}
