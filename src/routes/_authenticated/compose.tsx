import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, GradientButton } from "@/components/app/page";
import { useMemo, useState, useRef, useEffect } from "react";
import { Image as ImageIcon, Smile, Hash, MapPin, Calendar as CalendarIcon, Repeat, Send, Instagram, Heart, MessageCircle, Bookmark, ChevronDown, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AssetImage } from "@/components/app/asset-image";
import { VideoThumb } from "@/components/app/video-thumb";
import { validateReel } from "@/lib/video-utils";

export const Route = createFileRoute("/_authenticated/compose")({
  component: Compose,
});

const CAP_LIMIT = 2200;
const EMOJIS = ["✨","🔥","💫","🎉","📸","💡","🚀","❤️","☕","🌊","🌿","🎨","🍕","🌸","🎯","🏆"];

const TYPE_LABEL: Record<string, string> = {
  image: "Imagem",
  carousel: "Carrossel",
  reel: "Reel",
};

const REC_LABEL: Record<string, string> = {
  none: "Uma vez",
  daily: "Diária",
  weekly: "Semanal",
  monthly: "Mensal",
};

const INTERVAL_PRESETS: { label: string; minutes: number }[] = [
  { label: "A cada 40 min", minutes: 40 },
  { label: "A cada 1 h", minutes: 60 },
  { label: "A cada 2 h", minutes: 120 },
  { label: "A cada 3 h", minutes: 180 },
  { label: "A cada 6 h", minutes: 360 },
  { label: "1x por dia", minutes: 1440 },
];

function Compose() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["ig-accounts"],
    queryFn: async () => (await supabase.from("instagram_accounts").select("id, username, profile_picture_url").eq("is_active", true)).data ?? [],
  });
  const { data: media = [] } = useQuery({
    queryKey: ["media-library"],
    queryFn: async () => (await supabase.from("media_assets").select("*").order("created_at", { ascending: false }).limit(60)).data ?? [],
  });
  const { data: hashtagGroups = [] } = useQuery({
    queryKey: ["hashtag-groups"],
    queryFn: async () => (await supabase.from("hashtag_groups").select("*")).data ?? [],
  });

  const [postType, setPostType] = useState<"image" | "carousel" | "reel">("image");
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [location, setLocation] = useState("");
  const [accountId, setAccountId] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [showEmojis, setShowEmojis] = useState(false);
  const [coverUrl, setCoverUrl] = useState("");
  const [thumbOffset, setThumbOffset] = useState<string>("");

  const selectedAssets = useMemo(
    () => selectedMedia.map((id) => media.find((m) => m.id === id)).filter(Boolean) as typeof media,
    [selectedMedia, media]
  );

  const [intervalMinutes, setIntervalMinutes] = useState<number | "">("");
  const [coverMediaId, setCoverMediaId] = useState<string>("");


  function toggleMedia(id: string) {
    if (postType === "image" || postType === "reel") setSelectedMedia([id]);
    else setSelectedMedia((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length < 10 ? [...s, id] : s);
  }

  const schedulePost = useMutation({
    mutationFn: async (status: "scheduled" | "draft") => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Não autenticado");
      if (!accountId) throw new Error("Selecione uma conta do Instagram");
      if (selectedMedia.length === 0) throw new Error("Adicione ao menos uma mídia");
      if (caption.length > CAP_LIMIT) throw new Error("Legenda muito longa");

      const finalScheduledAt = new Date(scheduledAt);

      const { data: post, error } = await supabase.from("scheduled_posts").insert({
        user_id: userData.user.id,
        ig_account_id: accountId,
        post_type: postType,
        caption,
        first_comment: firstComment || null,
        location_name: location || null,
        scheduled_at: finalScheduledAt.toISOString(),
        recurrence,
        status,
        cover_url: postType === "reel" && coverUrl.trim() ? coverUrl.trim() : null,
        cover_media_id: postType === "reel" && !coverUrl.trim() && coverMediaId ? coverMediaId : null,
        thumbnail_offset: postType === "reel" && !coverUrl.trim() && !coverMediaId && thumbOffset ? Number(thumbOffset) : null,
        interval_minutes: intervalMinutes ? Number(intervalMinutes) : null,
      } as any).select().single();
      if (error) throw error;
      const rows = selectedMedia.map((mid, i) => ({ post_id: post.id, media_asset_id: mid, position: i }));
      const { error: pmError } = await supabase.from("post_media").insert(rows);
      if (pmError) throw pmError;
      return post;
    },
    onSuccess: (_, status) => {
      toast.success(status === "scheduled" ? "Publicação agendada" : "Rascunho salvo");
      qc.invalidateQueries();
      navigate({ to: "/queue" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao agendar"),
  });

  return (
    <div>
      <PageHeader title="Nova publicação" description="Crie, pré-visualize e agende no Instagram." />
      <PageBody>
        {accounts.length === 0 && (
          <div className="card-elevated mb-5 p-4 border-warning/40">
            <p className="text-sm">Você precisa conectar uma conta do Instagram antes de agendar. <Link to="/accounts" className="text-primary underline">Conectar agora →</Link></p>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {/* Type */}
            <div className="card-elevated p-5">
              <label className="mb-3 block text-xs font-medium text-muted-foreground">Tipo de publicação</label>
              <div className="grid grid-cols-3 gap-2">
                {(["image","carousel","reel"] as const).map((t) => (
                  <button key={t} onClick={() => { setPostType(t); setSelectedMedia([]); }}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      postType === t ? "ig-gradient text-primary-foreground border-transparent shadow-md" : "border-border hover:bg-accent"
                    }`}>{TYPE_LABEL[t]}</button>
                ))}
              </div>
            </div>

            {/* Media picker */}
            <div className="card-elevated p-5">
              <div className="mb-3 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  Mídia {postType === "carousel" && `(${selectedMedia.length}/10)`}
                </label>
                <Link to="/media" className="text-xs text-primary hover:underline">Gerenciar biblioteca</Link>
              </div>
              {media.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Nenhuma mídia ainda. <Link to="/media" className="text-primary underline">Enviar arquivos</Link>.
                </div>
              ) : (() => {
                const list = media.filter((m) => {
                  if (m.media_kind === "cover") return false;
                  if (postType === "reel") return m.media_kind === "video";
                  if (postType === "image") return m.media_kind === "image";
                  return m.media_kind === "image" || m.media_kind === "video";
                });
                if (list.length === 0) {
                  return (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      {postType === "reel"
                        ? <>Nenhum vídeo na biblioteca. Reels precisam de um arquivo de vídeo (mp4/mov). <Link to="/media" className="text-primary underline">Enviar vídeo</Link>.</>
                        : postType === "image"
                          ? <>Nenhuma foto disponível. <Link to="/media" className="text-primary underline">Enviar foto</Link>.</>
                          : <>Nenhuma foto ou vídeo. <Link to="/media" className="text-primary underline">Enviar arquivos</Link>.</>}
                    </div>
                  );
                }
                return (
                  <div className="grid grid-cols-4 gap-2 md:grid-cols-6">
                    {list.map((m) => {
                      const idx = selectedMedia.indexOf(m.id);
                      const isVideo = m.media_kind === "video";
                      return (
                        <button key={m.id} onClick={() => toggleMedia(m.id)}
                          className={`relative aspect-square overflow-hidden rounded-md border-2 transition ${
                            idx >= 0 ? "border-primary" : "border-transparent hover:border-border"
                          }`}>
                          {isVideo
                            ? <VideoThumb storagePath={m.storage_path} thumbnailUrl={(m as any).thumbnail_url} thumbnailPath={(m as any).thumbnail_path} videoUrl={m.public_url} fileName={m.file_name} className="h-full w-full" />
                            : <AssetImage storagePath={m.storage_path} publicUrl={m.public_url} alt={m.file_name} className="h-full w-full object-cover" />}
                          {isVideo && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">VÍDEO</span>}
                          {idx >= 0 && (
                            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full ig-gradient text-[10px] font-bold text-primary-foreground">
                              {idx + 1}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Reel validation warnings */}
            {postType === "reel" && selectedMedia.length > 0 && (() => {
              const sel = media.find((m) => m.id === selectedMedia[0]) as any;
              if (!sel || sel.media_kind !== "video") return null;
              const warnings = validateReel({
                meta: sel.width && sel.height ? { width: sel.width, height: sel.height, duration: Number(sel.duration_seconds ?? 0) } : null,
                mime: sel.mime_type, fileName: sel.file_name, sizeBytes: Number(sel.size_bytes ?? 0),
              });
              if (warnings.length === 0) return (
                <div className="card-elevated p-3 text-xs text-emerald-600 flex items-center gap-2">
                  <Check className="h-4 w-4" /> Vídeo dentro dos padrões do Reels.
                </div>
              );
              return (
                <div className="card-elevated p-4 space-y-2 border-amber-500/40">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-600">
                    <AlertTriangle className="h-4 w-4" /> Avisos do Reel — você pode publicar assim mesmo, mas pode ter menos alcance.
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-5">
                    {warnings.map((w, i) => (
                      <li key={i} className={w.severity === "error" ? "text-destructive" : ""}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}


            {/* Reel cover */}
            {postType === "reel" && (
              <div className="card-elevated p-5 space-y-3">
                <label className="block text-xs font-medium text-muted-foreground">Capa do Reel (opcional)</label>

                {/* Cover picker from library */}
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">Escolher da biblioteca (Capas)</label>
                  {media.filter((m) => m.media_kind === "cover").length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                      Nenhuma capa salva. <Link to="/media" className="text-primary underline">Enviar capas</Link>.
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 md:grid-cols-6">
                      {media.filter((m) => m.media_kind === "cover").map((m) => {
                        const active = coverMediaId === m.id;
                        return (
                          <button key={m.id} type="button"
                            onClick={() => setCoverMediaId(active ? "" : m.id)}
                            className={`relative aspect-square overflow-hidden rounded-md border-2 transition ${active ? "border-primary" : "border-transparent hover:border-border"}`}>
                            <AssetImage storagePath={m.storage_path} publicUrl={m.public_url} alt={m.file_name} className="h-full w-full object-cover" />
                            {active && <span className="absolute right-1 top-1 h-4 w-4 rounded-full ig-gradient" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="text-center text-[11px] text-muted-foreground">— ou —</div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">URL de imagem pública (jpg/png)</label>
                  <input
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                    placeholder="https://…/capa.jpg"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="text-center text-[11px] text-muted-foreground">— ou —</div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">Frame do vídeo (ms) — se nada acima for informado</label>
                  <input
                    type="number"
                    min={0}
                    value={thumbOffset}
                    onChange={(e) => setThumbOffset(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            )}

            {/* Caption */}
            <div className="card-elevated p-5">
              <label className="mb-2 block text-xs font-medium text-muted-foreground">Legenda</label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={6}
                maxLength={CAP_LIMIT}
                placeholder="Escreva sua legenda…"
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => setShowEmojis((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
                  <Smile className="h-3.5 w-3.5" /> Emoji
                </button>
                {hashtagGroups.map((g) => (
                  <button key={g.id} onClick={() => setCaption((c) => c + "\n\n" + g.hashtags.map((h: string) => (h.startsWith("#") ? h : `#${h}`)).join(" "))}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
                    <Hash className="h-3.5 w-3.5" /> {g.name}
                  </button>
                ))}
                <div className={`ml-auto text-xs tabular-nums ${caption.length > CAP_LIMIT - 100 ? "text-warning" : "text-muted-foreground"}`}>
                  {caption.length}/{CAP_LIMIT}
                </div>
              </div>
              {showEmojis && (
                <div className="mt-2 grid grid-cols-8 gap-1 rounded-lg border border-border bg-background p-2">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => setCaption((c) => c + e)} className="rounded p-1.5 text-xl hover:bg-accent">{e}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="card-elevated p-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Primeiro comentário (hashtags)</label>
                <textarea value={firstComment} onChange={(e) => setFirstComment(e.target.value)} rows={3}
                  placeholder="#fotografia #criador …"
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground"><MapPin className="inline h-3 w-3 mr-1" /> Localização</label>
                  <input value={location} onChange={(e) => setLocation(e.target.value)}
                    placeholder="Buscar um lugar…"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Conta do Instagram</label>
                  <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
                </div>
              </div>
            </div>

            {/* Schedule */}
            <div className="card-elevated p-5 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground"><CalendarIcon className="inline h-3 w-3 mr-1" /> Quando publicar (horário de SP)</label>
                  <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground"><Repeat className="inline h-3 w-3 mr-1" /> Recorrência base</label>
                  <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as never)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                    {(["none","daily","weekly","monthly"] as const).map(r => <option key={r} value={r}>{REC_LABEL[r]}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Intervalo personalizado (opcional — sobrepõe a recorrência)</label>
                <div className="flex flex-wrap gap-2">
                  {INTERVAL_PRESETS.map((p) => {
                    const active = intervalMinutes === p.minutes;
                    return (
                      <button key={p.minutes} type="button"
                        onClick={() => setIntervalMinutes(active ? "" : p.minutes)}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
                        {p.label}
                      </button>
                    );
                  })}
                  <div className="flex items-center gap-1">
                    <input type="number" min={5} placeholder="min"
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-20 rounded-lg border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring" />
                    <span className="text-xs text-muted-foreground">min</span>
                  </div>
                  {intervalMinutes !== "" && (
                    <button type="button" onClick={() => setIntervalMinutes("")}
                      className="text-xs text-muted-foreground hover:text-foreground underline">Limpar</button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">A cada publicação, o sistema clona automaticamente a próxima no intervalo definido.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button onClick={() => schedulePost.mutate("draft")} disabled={schedulePost.isPending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent">
                Salvar rascunho
              </button>
              <GradientButton onClick={() => schedulePost.mutate("scheduled")} disabled={schedulePost.isPending}>
                <Send className="h-4 w-4" /> Agendar publicação
              </GradientButton>
            </div>
          </div>

          {/* Preview */}
          <div className="lg:sticky lg:top-6 lg:h-fit">
            <div className="card-elevated p-4">
              <div className="mb-3 text-xs font-medium text-muted-foreground">Pré-visualização</div>
              <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 p-3">
                  <div className="h-8 w-8 rounded-full ig-gradient p-0.5">
                    <div className="h-full w-full rounded-full bg-card flex items-center justify-center overflow-hidden">
                      {accounts.find((a) => a.id === accountId)?.profile_picture_url
                        ? <img src={accounts.find((a) => a.id === accountId)!.profile_picture_url!} alt="" className="h-full w-full object-cover" />
                        : <Instagram className="h-4 w-4" />}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">{accounts.find((a) => a.id === accountId)?.username ? `@${accounts.find((a) => a.id === accountId)?.username}` : "seu.perfil"}</div>
                </div>
                <div className="aspect-square bg-muted overflow-hidden">
                  {selectedAssets[0] ? (
                    <PreviewMedia
                      asset={selectedAssets[0]}
                      coverAsset={coverMediaId ? media.find((m) => m.id === coverMediaId) : undefined}
                      coverUrl={coverUrl}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-10 w-10" />
                    </div>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-4 text-foreground">
                    <Heart className="h-5 w-5" />
                    <MessageCircle className="h-5 w-5" />
                    <Bookmark className="h-5 w-5 ml-auto" />
                  </div>
                  <div className="text-xs whitespace-pre-wrap line-clamp-6">
                    <span className="font-semibold mr-1">{accounts.find((a) => a.id === accountId)?.username ?? "seu.perfil"}</span>
                    {caption || "Sua legenda aparecerá aqui…"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

type MediaAsset = {
  storage_path: string;
  public_url?: string | null;
  file_name?: string | null;
  media_kind?: string | null;
  mime_type?: string | null;
};

function PreviewMedia({ asset, coverAsset, coverUrl }: { asset: MediaAsset; coverAsset?: MediaAsset; coverUrl?: string }) {
  const isVideo = asset.media_kind === "video" || (asset.mime_type ?? "").startsWith("video/");

  if (isVideo) {
    if (coverAsset?.storage_path) {
      return <AssetImage storagePath={coverAsset.storage_path} publicUrl={coverAsset.public_url} alt="Capa do Reel" className="h-full w-full object-cover" loading="eager" />;
    }

    if (coverUrl?.trim()) {
      return <img src={coverUrl.trim()} alt="Capa do Reel" className="h-full w-full object-cover" loading="eager" />;
    }

    return (
      <video
        src={asset.public_url ?? undefined}
        className="h-full w-full object-cover"
        muted
        playsInline
        controls
        preload="metadata"
      />
    );
  }

  return <AssetImage storagePath={asset.storage_path} publicUrl={asset.public_url} alt={asset.file_name ?? "Prévia"} className="h-full w-full object-cover" loading="eager" />;
}

type IgAccount = { id: string; username: string; profile_picture_url: string | null };

function AccountPicker({ accounts, value, onChange }: { accounts: IgAccount[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = accounts.find((a) => a.id === value);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none hover:bg-accent focus:ring-2 focus:ring-ring"
      >
        {selected ? (
          <>
            <Avatar url={selected.profile_picture_url} />
            <span className="font-medium">@{selected.username}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Selecione a conta…</span>
        )}
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {accounts.length === 0 && <div className="p-3 text-xs text-muted-foreground">Nenhuma conta conectada.</div>}
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onChange(a.id); setOpen(false); }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent ${a.id === value ? "bg-accent" : ""}`}
            >
              <Avatar url={a.profile_picture_url} />
              <span className="font-medium truncate">@{a.username}</span>
              {a.id === value && <Check className="ml-auto h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ url }: { url: string | null }) {
  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ig-gradient p-0.5">
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-card">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Instagram className="h-3.5 w-3.5" />}
      </span>
    </span>
  );
}
