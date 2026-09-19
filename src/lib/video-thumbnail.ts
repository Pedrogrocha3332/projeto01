import { supabase } from "@/integrations/supabase/client";
import { generateVideoThumbnail, isDarkFrame } from "./video-utils";
import { thumbQueue } from "./thumb-queue";

type Source = { storagePath: string; thumbnailUrl?: string | null; thumbnailPath?: string | null; videoUrl?: string | null };
const cache = new Map<string, Promise<string>>();

function usableImage(src: string): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    const finish = (ok: boolean) => { clearTimeout(timer); img.onload = img.onerror = null; resolve(ok); };
    const timer = setTimeout(() => { finish(false); img.src = ""; }, 8000);
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 32;
        const ctx = c.getContext("2d");
        if (!ctx || !img.naturalWidth) { finish(false); return; }
        ctx.drawImage(img, 0, 0, 32, 32);
        finish(!isDarkFrame(ctx.getImageData(0, 0, 32, 32).data));
      } catch { finish(false); }
    };
    img.onerror = () => finish(false);
    img.src = src;
  });
}
async function signed(path: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = supabase.storage.from("media").createSignedUrl(path, 3600);
  const { data, error } = await Promise.race([
    request,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Tempo esgotado ao acessar a mídia")), 10_000); }),
  ]).finally(() => clearTimeout(timer));
  if (error || !data?.signedUrl) throw new Error("Não foi possível acessar o arquivo");
  return data.signedUrl;
}
async function persist(storagePath: string, blob: Blob) {
  // Keep the original asset owner's storage prefix, including admin views.
  const owner = storagePath.split("/")[0];
  if (!owner) return;
  const path = `${owner}/thumbs/${crypto.randomUUID()}.jpg`;
  const bucket = supabase.storage.from("media");
  const { error } = await bucket.upload(path, blob, { contentType: "image/jpeg" });
  if (error) return;
  const url = await signed(path);
  const result = await supabase.from("media_assets").update({ thumbnail_path: path, thumbnail_url: url }).eq("storage_path", storagePath);
  if (result.error) await bucket.remove([path]);
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler a miniatura"));
    reader.readAsDataURL(blob);
  });
}
export function resolveVideoThumbnail(source: Source): Promise<string> {
  const cached = cache.get(source.storagePath);
  if (cached) return cached;
  const task = thumbQueue.run(async () => {
    if (source.thumbnailUrl && await usableImage(source.thumbnailUrl)) return source.thumbnailUrl;
    if (source.thumbnailPath) {
      try {
        const url = await signed(source.thumbnailPath);
        if (await usableImage(url)) return url;
      } catch { /* Rebuild from the video below. */ }
    }
    // Fresh signed video URL avoids expired legacy links; the browser can use range requests.
    let url: string;
    try { url = await signed(source.storagePath); }
    catch { if (!source.videoUrl) throw new Error("Vídeo indisponível"); url = source.videoUrl; }
    const blob = await generateVideoThumbnail(url);
    const result = await dataUrl(blob);
    void persist(source.storagePath, blob).catch(() => {});
    return result;
  });
  cache.set(source.storagePath, task);
  void task.catch(() => { if (cache.get(source.storagePath) === task) cache.delete(source.storagePath); });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return task;
}
