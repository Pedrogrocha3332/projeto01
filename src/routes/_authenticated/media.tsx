import { deleteLibraryVideos } from "@/lib/delete-library-videos";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVideoFolders } from "@/lib/video-folders";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, EmptyState, GradientButton } from "@/components/app/page";
import { Upload, Image as ImageIcon, Trash2, Search, Film, Camera, AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AssetImage } from "@/components/app/asset-image";
import { VideoThumb } from "@/components/app/video-thumb";
import { extractVideoMeta, generateVideoThumbnail, validateReel, REEL_LIMITS } from "@/lib/video-utils";

export const Route = createFileRoute("/_authenticated/media")({
  component: MediaPage,
});

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VIDEO = REEL_LIMITS.maxBytes; // 4GB (Instagram Reels limit)

type Kind = "image" | "video" | "cover";
type Tab = "all" | Kind;

function formatDuration(s: number): string {
  if (!isFinite(s) || s <= 0) return "0s";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${sec}s`;
}

function detectKind(file: File): Kind | null {
  const t = file.type;
  const name = file.name.toLowerCase();
  if (t.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)) return "video";
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name)) return "image";
  return null;
}

function MediaPage() {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [targetAccount, setTargetAccount] = useState("");
  const folderQuery=useVideoFolders();
  const accounts=folderQuery.data??[];
  const createFolder=useMutation({mutationFn:async(name:string)=>{
    const {data:user,error:authError}=await supabase.auth.getUser();
    if(authError||!user.user)throw new Error("Entre novamente no painel");
    const {data,error}=await (supabase as any).from("media_folders").insert({user_id:user.user.id,name:name.trim()}).select("id").single();
    if(error)throw new Error(error.message);return data.id as string;
  },onSuccess:id=>{qc.invalidateQueries({queryKey:["video-folders"]});setAccountId(id);setSelected([]);},onError:e=>toast.error(e.message)});
  const assign = useMutation({
    mutationFn: async () => {const {error}=await (supabase as any).rpc("move_videos_to_folder",{p_ids:selected,p_folder:targetAccount});if(error)throw new Error(error.message);},
    onSuccess: () => {
      toast.success("Vídeos movidos para a pasta. Pools e posts existentes foram preservados.");
      setSelected([]);
      qc.invalidateQueries({ queryKey: ["media-library"] });
      qc.invalidateQueries({ queryKey: ["media-videos-selectable"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao vincular"),
  });
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const { data: assets = [], isLoading, error: libraryError } = useQuery({
    queryKey: ["media-library"],
    queryFn: async () => {
      const rows: any[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("media_assets").select("*")
          .order("created_at", { ascending: false }).order("id").range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      return rows;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const accountAssets = assets.filter(a => {
    if (a.media_kind !== "video" || accountId === "all") return true;
    return accountId === "unassigned" ? !a.folder_id : a.folder_id === accountId;
  });
  const counts = {
    all: accountAssets.length,
    image: accountAssets.filter((a) => a.media_kind === "image").length,
    video: accountAssets.filter((a) => a.media_kind === "video").length,
    cover: accountAssets.filter((a) => a.media_kind === "cover").length,
  };
  const totalBytes = assets.reduce((n, a) => n + Number(a.size_bytes ?? 0), 0);

  const del = useMutation({
    mutationFn: async (a: { id: string; storage_path: string; thumbnail_path?: string | null }) => {
      const paths = [a.storage_path];
      if (a.thumbnail_path) paths.push(a.thumbnail_path);
      const { data, error } = await supabase.from("media_assets").delete().eq("id", a.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Arquivo não encontrado ou sem permissão para excluir");
      const { error: storageError } = await supabase.storage.from("media").remove(paths);
      if (storageError) toast.error("Registro excluído, mas o arquivo não pôde ser removido do armazenamento");
    },
    onSuccess: () => { toast.success("Excluído"); qc.invalidateQueries({ queryKey: ["media-library"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir"),
  });

  const deleteAll = useMutation({
    mutationFn: (ids: string[]) => deleteLibraryVideos(supabase, ids),
    onSuccess: ({ deleted, storageFailures }) => {
      toast.success(deleted + " vídeos excluídos");
      if (storageFailures) toast.error("Alguns arquivos não puderam ser removidos do armazenamento. Os registros da biblioteca já foram excluídos.");
      setSelected([]);
    },
    onError: e => toast.error(e instanceof Error ? e.message : "Falha ao excluir"),
    onSettled: () => { qc.invalidateQueries(); },
  });
  function confirmDeleteAll() {
    const ids = accountAssets.filter(a => a.media_kind === "video").map(a => a.id);
    const scope = accountId === "all" ? "TODAS AS PASTAS deste painel" : accountId === "unassigned" ? "SEM PASTA" : (accounts.find(a => a.id === accountId)?.name ?? accountId);
    if (ids.length && window.confirm("Apagar " + ids.length + " vídeos de " + scope + "?\n\nA busca por nome não limita esta ação. Fotos e capas serão mantidas.\nOs vídeos também serão removidos dos pools e dos posts que os utilizam. Posts na fila podem ficar sem vídeo e falhar. Esta exclusão não pode ser desfeita.")) deleteAll.mutate(ids);
  }

  const setKind = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: Kind }) => {
      const { error } = await supabase.from("media_assets").update({ media_kind: kind }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast.success(v.kind === "cover" ? "Marcada como capa" : "Categoria atualizada"); qc.invalidateQueries({ queryKey: ["media-library"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar"),
  });

  async function handleFiles(files: FileList | null, forceKind?: "cover") {
    if (!files || files.length === 0) return;
    if (libraryError || isLoading || folderQuery.isLoading || folderQuery.error) { toast.error("Aguarde a biblioteca carregar antes de enviar arquivos"); return; }
    const uploadAccount = accountId !== "all" && accountId !== "unassigned" ? accountId : null;
    if (Array.from(files).some(file => detectKind(file) === "video") && !uploadAccount) {
      toast.error("Escolha uma pasta antes de enviar vídeos");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setUploading(true);
    setProgress({ current: 0, total: files.length });
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Não autenticado");
      let index = 0;
      for (const file of Array.from(files)) {
        index++;
        setProgress({ current: index, total: files.length });
        const detected = detectKind(file);
        if (!detected) { toast.error(`${file.name}: tipo não suportado`); continue; }
        // "cover" upload forces image, stored as cover kind
        if (forceKind === "cover" && detected !== "image") {
          toast.error(`${file.name}: capa precisa ser imagem`); continue;
        }
        if (detected === "image" && file.size > MAX_IMAGE) { toast.error(`${file.name}: imagem acima de 8MB`); continue; }
        if (detected === "video" && file.size > MAX_VIDEO) { toast.error(`${file.name}: vídeo acima de 4GB`); continue; }
        const safeName = file.name.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-");
        const path = `${userData.user.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("media").upload(path, file, { contentType: file.type || undefined });
        if (upErr) throw upErr;
        const { data: signed } = await supabase.storage.from("media").createSignedUrl(path, 60 * 60 * 24 * 365);
        const kind: Kind = forceKind === "cover" ? "cover" : detected;

        // Extract metadata + generate thumbnail for videos (best-effort)
        let width: number | null = null;
        let height: number | null = null;
        let duration: number | null = null;
        let thumbPath: string | null = null;
        let thumbUrl: string | null = null;
        if (detected === "video") {
          try {
            const meta = await extractVideoMeta(file);
            width = meta.width; height = meta.height; duration = meta.duration;
            const warnings = validateReel({ meta, mime: file.type, fileName: file.name, sizeBytes: file.size });
            const errs = warnings.filter((w) => w.severity === "error");
            const warns = warnings.filter((w) => w.severity === "warning");
            if (errs.length) toast.error(`${file.name}: ${errs.map((w) => w.message).join(" · ")}`);
            if (warns.length) toast.warning(`${file.name}: ${warns.map((w) => w.message).join(" · ")}`);
          } catch { /* metadata optional */ }
          try {
            const thumbBlob = await generateVideoThumbnail(file);
            thumbPath = `${userData.user.id}/thumbs/${crypto.randomUUID()}.jpg`;
            const up = await supabase.storage.from("media").upload(thumbPath, thumbBlob, { contentType: "image/jpeg" });
            if (!up.error) {
              const { data: s } = await supabase.storage.from("media").createSignedUrl(thumbPath, 60 * 60 * 24 * 365);
              thumbUrl = s?.signedUrl ?? null;
            } else { thumbPath = null; }
          } catch { /* thumbnail optional */ }
        }

        const { error: insErr } = await supabase.from("media_assets").insert({
          user_id: userData.user.id,
          storage_path: path,
          public_url: signed?.signedUrl ?? "",
          file_name: file.name,
          mime_type: file.type || (detected === "video" ? "video/mp4" : "image/jpeg"),
          media_kind: kind,
          ig_account_id: null,
          ...(detected === "video" ? { folder_id: uploadAccount } : {}),
          size_bytes: file.size,
          width, height, duration_seconds: duration,
          thumbnail_path: thumbPath,
          thumbnail_url: thumbUrl,
        });
        if (insErr) {
          await supabase.storage.from("media").remove([path, ...(thumbPath ? [thumbPath] : [])]);
          throw insErr;
        }
      }
      toast.success("Upload concluído");
      qc.invalidateQueries({ queryKey: ["media-library"] });
      qc.invalidateQueries({ queryKey: ["media-videos-selectable"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    } finally {
      qc.invalidateQueries({ queryKey: ["media-library"] });
      qc.invalidateQueries({ queryKey: ["media-videos-selectable"] });
      setUploading(false);
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
      if (coverInput.current) coverInput.current.value = "";
    }
  }

  const filtered = accountAssets.filter((a) => {
    if (tab !== "all" && a.media_kind !== tab) return false;
    if (search && !a.file_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const [visibleCount, setVisibleCount] = useState(24);

  useEffect(() => {
    setVisibleCount(24);
  }, [search, tab, accountId, assets.length]);

  useEffect(() => {
    if (visibleCount >= filtered.length) return;
    let cancelled = false;
    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const loadMore = () => {
      if (!cancelled) setVisibleCount((count) => Math.min(count + 18, filtered.length));
    };
    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(loadMore, { timeout: 900 });
    } else {
      timeoutId = globalThis.setTimeout(loadMore, 250);
    }
    return () => {
      cancelled = true;
      if (idleId != null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
      if (timeoutId != null) globalThis.clearTimeout(timeoutId);
    };
  }, [filtered.length, visibleCount]);
  const visibleAssets = filtered.slice(0, visibleCount);

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "all", label: "Todos", icon: ImageIcon },
    { key: "image", label: "Fotos", icon: ImageIcon },
    { key: "video", label: "Vídeos", icon: Film },
    { key: "cover", label: "Capas", icon: Camera },
  ];

  return (
    <div>
      <PageHeader
        title="Biblioteca de mídia"
        description={`${assets.length} arquivos · ${(totalBytes / (1024 * 1024)).toFixed(1)} MB utilizados`}
        actions={
          <>
            <button onClick={confirmDeleteAll} disabled={deleteAll.isPending || del.isPending || uploading || assign.isPending || isLoading || Boolean(libraryError) || counts.video === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> {deleteAll.isPending ? "Apagando vídeos…" : "Apagar todos os vídeos"}
            </button>
            <input ref={fileInput} type="file" multiple hidden accept="image/*,video/*" onChange={(e) => handleFiles(e.target.files)} />
            <input ref={coverInput} type="file" multiple hidden accept="image/*" onChange={(e) => handleFiles(e.target.files, "cover")} />
            <button
              onClick={() => coverInput.current?.click()}
              disabled={deleteAll.isPending || uploading || assign.isPending || Boolean(libraryError) || isLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              <Camera className="h-4 w-4" /> Enviar capas
            </button>
            <GradientButton onClick={() => fileInput.current?.click()} disabled={deleteAll.isPending || uploading}>
              <Upload className="h-4 w-4" /> {uploading ? "Enviando…" : "Enviar fotos/vídeos"}
            </GradientButton>
          </>
        }
      />
      <PageBody>
        <div className="mb-4 space-y-2">
          <label className="block text-sm">Pasta dos vídeos</label>
          <select aria-label="Pasta dos vídeos" value={accountId} disabled={deleteAll.isPending || uploading || assign.isPending}
            onChange={(e) => { setAccountId(e.target.value); setSelected([]); }}
            className="rounded border border-input bg-background px-3 py-2 text-sm">
            <option value="all">Todas as pastas</option>
            <option value="unassigned">Sem pasta</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Escolha uma pasta antes de enviar vídeos. Fotos e capas continuam compartilhadas.</p>
          <button className="ml-2 rounded border border-input px-3 py-2 text-sm" disabled={createFolder.isPending||uploading||Boolean(folderQuery.error)} onClick={()=>{const name=window.prompt("Nome da pasta", "Pasta "+(accounts.length+1));if(name?.trim()&&name.trim().length<=100)createFolder.mutate(name);}}>Nova pasta</button>
          {folderQuery.error&&<p role="alert" className="text-sm text-destructive">{folderQuery.error.message}</p>}
          {libraryError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar a biblioteca. Confira a conexão e se o SQL da biblioteca por conta foi aplicado.</p>}
          {selected.length > 0 && <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{selected.length} vídeos selecionados</span>
            <select aria-label="Mover vídeos para pasta" value={targetAccount} onChange={e => setTargetAccount(e.target.value)} disabled={deleteAll.isPending || assign.isPending}
              className="rounded border border-input bg-background px-3 py-2 text-sm">
              <option value="">Escolha a pasta de destino</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={() => assign.mutate()} disabled={deleteAll.isPending || !targetAccount || assign.isPending || selected.length > 500 || uploading}
              className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{assign.isPending ? "Movendo…" : "Mover para pasta"}</button>
            <p className="w-full text-xs text-muted-foreground">O vínculo vale para novas seleções. Vídeos já adicionados aos pools continuam nesses pools.</p>
          </div>}
        </div>
        {progress && (
          <div className="card-elevated mb-4 p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Enviando arquivo {progress.current} de {progress.total}</span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full ig-gradient transition-[width]" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setSelected([]); }}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{counts[t.key]}</span>
              </button>
            );
          })}
          <div className="relative ml-auto max-w-sm flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar arquivos…"
              className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-3 gap-3 md:grid-cols-6">{Array.from({ length: 12 }).map((_, i) => <div key={i} className="aspect-square rounded-lg shimmer" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={ImageIcon} title="Nenhuma mídia ainda"
            description="Envie fotos, vídeos ou capas para reutilizar em publicações."
            action={<GradientButton onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" /> Enviar arquivos</GradientButton>} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visibleAssets.map((a, index) => {
              const isVideo = a.media_kind === "video";
              const reelWarnings = isVideo
                ? validateReel({
                    meta: a.width && a.height ? { width: a.width, height: a.height, duration: Number(a.duration_seconds ?? 0) } : null,
                    mime: a.mime_type, fileName: a.file_name, sizeBytes: Number(a.size_bytes ?? 0),
                  })
                : [];
              const hasIssue = reelWarnings.length > 0;
              return (
              <div key={a.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                {isVideo && <input type="checkbox" aria-label={`Selecionar ${a.file_name}`} checked={selected.includes(a.id)} disabled={deleteAll.isPending || assign.isPending || uploading}
                  onChange={() => setSelected(prev => prev.includes(a.id) ? prev.filter(id => id !== a.id) : [...prev, a.id])}
                  className="absolute left-2 top-9 z-10 h-5 w-5 accent-primary" />}
                {isVideo
                  ? <VideoThumb storagePath={a.storage_path} thumbnailUrl={a.thumbnail_url} thumbnailPath={a.thumbnail_path} videoUrl={a.public_url} fileName={a.file_name} className="h-full w-full" priority={index < 6} />
                  : <AssetImage storagePath={a.storage_path} publicUrl={a.public_url} alt={a.file_name} className="h-full w-full object-cover" loading={index < 6 ? "eager" : "lazy"} />}
                <span className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                  isVideo ? "bg-blue-500/80 text-white" :
                  a.media_kind === "cover" ? "bg-amber-500/80 text-black" :
                  "bg-black/60 text-white"
                }`}>
                  {isVideo ? (accounts.find(folder => folder.id === a.folder_id)?.name ?? "Sem pasta") : a.media_kind === "cover" ? "Capa" : "Foto"}
                </span>
                {isVideo && hasIssue && (
                  <span
                    title={reelWarnings.map((w) => w.message).join("\n")}
                    className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-medium text-black"
                  >
                    <AlertTriangle className="h-3 w-3" /> Reel
                  </span>
                )}
                {isVideo && a.duration_seconds != null && (
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white">
                    {formatDuration(Number(a.duration_seconds))}
                  </span>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                  <div className="flex items-center justify-between gap-1 text-[10px] text-white">
                    <span className="line-clamp-2 break-all flex-1">{a.file_name}</span>
                    {a.media_kind === "image" && (
                      <button onClick={() => setKind.mutate({ id: a.id, kind: "cover" })}
                        className="rounded bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-medium text-black hover:bg-amber-400"
                        title="Marcar como capa">Capa</button>
                    )}
                    {a.media_kind === "cover" && (
                      <button onClick={() => setKind.mutate({ id: a.id, kind: "image" })}
                        className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-medium hover:bg-white/30"
                        title="Voltar para foto">Foto</button>
                    )}
                    <button disabled={deleteAll.isPending || del.isPending} onClick={() => del.mutate({ id: a.id, storage_path: a.storage_path, thumbnail_path: a.thumbnail_path })} className="rounded p-1 hover:bg-white/20" aria-label="Excluir"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </PageBody>
    </div>
  );
}
