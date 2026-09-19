export type LocalVideo = { name: string; size: number; webkitRelativePath?: string };
export function panelOrigin(value: string) {
  const url = new URL(value.trim());
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error("Informe a URL HTTPS do painel.");
  return url.origin;
}
export function isImportVideo(file: LocalVideo) {
  return /\.(mp4|mov|m4v|webm)$/i.test(file.name) && file.size > 0;
}
export function groupImportFiles<T extends LocalVideo>(files: T[]) {
  const groups = new Map<string, { key: string; name: string; files: T[] }>();
  for (const file of files
    .filter(isImportVideo)
    .sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, {
        numeric: true,
      }),
    )) {
    const parts = (file.webkitRelativePath || file.name).split("/").slice(0, -1);
    const key = parts.join("/") || "Vídeos";
    const labels = [...parts];
    while (labels.length > 1 && /^(reels|posts|videos|vídeos)$/i.test(labels.at(-1)!)) labels.pop();
    const name = (labels.at(-1) || "Vídeos").slice(0, 100);
    const group = groups.get(key) || { key, name, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// Bounded memory even for large files; same contents produce the same import ID.
export async function videoFingerprint(file: Blob) {
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer(),
    );
    hashes.push(
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
    );
  }
  return `${file.size}:${hashes.join(":")}`;
}
export async function importAssetId(user: string, folder: string, file: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`central-v1:${user}:${folder}:${await videoFingerprint(file)}`),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
