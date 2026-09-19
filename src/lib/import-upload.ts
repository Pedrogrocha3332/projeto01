import { supabase } from "@/integrations/supabase/client";
import { extractVideoMeta, generateVideoThumbnail, REEL_LIMITS } from "@/lib/video-utils";
import { importAssetId, isImportVideo } from "@/lib/import-plan";
export type ImportFolder = { id: string; name: string };
export type ImportDestination = { id?: string; name: string };
export type ImportResult = { duplicate: boolean; warning?: string };
const db = () => supabase as any;
async function owner() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Entre novamente neste painel e reconecte à central.");
  return data.user.id;
}
export async function importFolders(): Promise<ImportFolder[]> {
  const user = await owner();
  const folders: ImportFolder[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db()
      .from("media_folders")
      .select("id,name")
      .eq("user_id", user)
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error("Aplique o SQL de pastas de vídeos neste painel antes de conectar.");
    folders.push(...data);
    if (data.length < 500) break;
  }
  return folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
async function destinationFolder(user: string, destination: ImportDestination) {
  if (
    !destination ||
    typeof destination.name !== "string" ||
    !destination.name.trim() ||
    destination.name.length > 100
  )
    throw new Error("Pasta inválida.");
  let query = db().from("media_folders").select("id").eq("user_id", user);
  query = destination.id
    ? query.eq("id", destination.id)
    : query.eq("name", destination.name.trim());
  const { data, error } = await query.order("created_at").limit(1);
  if (error) throw new Error(error.message);
  if (data.length) return data[0].id as string;
  if (destination.id) throw new Error("A pasta foi removida. Reconecte o painel e escolha outra.");
  const created = await db()
    .from("media_folders")
    .insert({ user_id: user, name: destination.name.trim() })
    .select("id")
    .single();
  if (created.error) throw new Error(created.error.message);
  return created.data.id as string;
}
function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Tempo esgotado ao gerar prévia")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
export async function uploadImportedVideo(
  file: File,
  destination: ImportDestination,
  progress: (phase: string) => void = () => {},
): Promise<ImportResult> {
  if (!(file instanceof File) || !isImportVideo(file) || file.size > REEL_LIMITS.maxBytes)
    throw new Error("Escolha um vídeo MP4, MOV, M4V ou WebM de até 4 GB.");
  const user = await owner();
  const folder = await destinationFolder(user, destination);
  progress("Conferindo arquivo");
  const id = await importAssetId(user, folder, file);
  const existing = await db()
    .from("media_assets")
    .select("id")
    .eq("id", id)
    .eq("user_id", user)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return { duplicate: true };
  // Deterministic paths and IDs make retries safe after an uncertain response.
  const path = `${user}/central/${id}`;
  progress("Enviando vídeo");
  const storage = supabase.storage.from("media");
  const mime =
    file.type ||
    (/\.mov$/i.test(file.name)
      ? "video/quicktime"
      : /\.webm$/i.test(file.name)
        ? "video/webm"
        : "video/mp4");
  const uploaded = await storage.upload(path, file, { contentType: mime, upsert: false });
  if (
    uploaded.error &&
    String(uploaded.error.statusCode) !== "409" &&
    !/already exists|duplicate/i.test(uploaded.error.message)
  )
    throw new Error(uploaded.error.message);
  const signed = await storage.createSignedUrl(path, 31536000);
  if (signed.error || !signed.data?.signedUrl)
    throw new Error("Não foi possível confirmar o arquivo. Tente novamente.");
  progress("Gerando prévia");
  let width: number | null = null,
    height: number | null = null,
    duration: number | null = null,
    thumbnail_path: string | null = null,
    thumbnail_url: string | null = null;
  const warnings: string[] = [];
  try {
    const meta = await deadline(extractVideoMeta(file), 15000);
    width = meta.width;
    height = meta.height;
    duration = Number.isFinite(meta.duration) ? meta.duration : null;
  } catch {
    warnings.push("Metadados indisponíveis");
  }
  try {
    const thumb = await deadline(generateVideoThumbnail(file), 20000);
    const thumbPath = `${user}/central/${id}.jpg`;
    const up = await storage.upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: false });
    if (
      up.error &&
      String(up.error.statusCode) !== "409" &&
      !/already exists|duplicate/i.test(up.error.message)
    )
      throw up.error;
    const signedThumb = await storage.createSignedUrl(thumbPath, 31536000);
    if (signedThumb.error) throw signedThumb.error;
    thumbnail_path = thumbPath;
    thumbnail_url = signedThumb.data.signedUrl;
  } catch {
    warnings.push("Sem miniatura; confira o vídeo na biblioteca");
  }
  progress("Salvando na biblioteca");
  const saved = await db()
    .from("media_assets")
    .insert({
      id,
      user_id: user,
      folder_id: folder,
      ig_account_id: null,
      storage_path: path,
      public_url: signed.data.signedUrl,
      file_name: file.name,
      mime_type: mime,
      media_kind: "video",
      size_bytes: file.size,
      width,
      height,
      duration_seconds: duration,
      thumbnail_path,
      thumbnail_url,
    });
  if (saved.error && saved.error.code !== "23505") throw new Error(saved.error.message);
  return { duplicate: saved.error?.code === "23505", warning: warnings.join(". ") || undefined };
}
