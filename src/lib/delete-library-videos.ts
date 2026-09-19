// Usa a sessão do usuário e as políticas RLS existentes.
export async function deleteLibraryVideos(client: any, ids: string[]) {
  let deleted = 0;
  let storageFailures = 0;
  for (let offset = 0; offset < ids.length; offset += 100) {
    // Remove primeiro o registro: uma falha no banco não apaga o arquivo em uso.
    const { data, error } = await client.from("media_assets").delete()
      .in("id", ids.slice(offset, offset + 100)).eq("media_kind", "video")
      .select("id, storage_path, thumbnail_path");
    if (error) throw new Error(deleted + " vídeos excluídos antes da falha: " + error.message);
    deleted += (data ?? []).length;
    const paths = [...new Set<string>((data ?? []).flatMap((a: any) => [a.storage_path, a.thumbnail_path].filter(Boolean)))];
    if (paths.length) {
      try {
        const result = await client.storage.from("media").remove(paths);
        if (result.error) storageFailures += paths.length;
      } catch { storageFailures += paths.length; }
    }
  }
  return { deleted, storageFailures };
}
