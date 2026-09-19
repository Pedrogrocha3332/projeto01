import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/components/app/page";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip, BarChart, Bar } from "recharts";
import { Users, CheckCircle2, XCircle, Clock, Image as ImageIcon, Download, ExternalLink, Eye, RefreshCw } from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { refreshRecentMetrics } from "@/lib/metrics.functions";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({
    queryKey: ["ig-accounts"],
    queryFn: async () => (await supabase.from("instagram_accounts").select("id, username, followers_count, media_count, profile_picture_url")).data ?? [],
  });

  const { data: posts = [] } = useQuery({
    queryKey: ["analytics-posts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("scheduled_posts")
        .select("id, status, post_type, scheduled_at, published_at, ig_permalink, view_count, like_count, reach_count, post_media(media_assets(public_url, storage_path))")
        .order("scheduled_at", { ascending: false })
        .limit(500);
      return data ?? [];
    },
  });

  const refreshBatchMetricsFn = useServerFn(refreshRecentMetrics);
  const refreshBatch = useMutation({
    mutationFn: async () => refreshBatchMetricsFn({ data: { limit: 40 } }),
    onSuccess: (res) => {
      toast.success(`Métricas de ${res.synced} posts sincronizadas com a Meta!`);
      qc.invalidateQueries({ queryKey: ["analytics-posts"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao sincronizar métricas"),
  });

  const totalFollowers = accounts.reduce((n, a) => n + (a.followers_count ?? 0), 0);
  const published = posts.filter((p) => p.status === "published");
  const totalViews = published.reduce((n, p) => n + ((p as any).view_count ?? 0), 0);
  const avgViews = published.length > 0 ? Math.round(totalViews / published.length) : 0;
  const scheduled = posts.filter((p) => p.status === "scheduled");
  const failed = posts.filter((p) => p.status === "failed");
  const attempted = published.length + failed.length;
  const successRate = attempted > 0 ? Math.round((published.length / attempted) * 100) : 0;

  // 14-day series of published posts
  const days = Array.from({ length: 14 }, (_, i) => startOfDay(subDays(new Date(), 13 - i)));
  const series = days.map((d) => {
    const key = format(d, "yyyy-MM-dd");
    const count = published.filter((p) => p.published_at && format(new Date(p.published_at), "yyyy-MM-dd") === key).length;
    return { date: format(d, "dd/MM", { locale: ptBR }), publicadas: count };
  });

  // Best hour heat by weekday × hour bucket
  const heat: number[][] = Array.from({ length: 12 }, () => Array(7).fill(0));
  published.forEach((p) => {
    if (!p.published_at) return;
    const d = new Date(p.published_at);
    heat[Math.floor(d.getHours() / 2)][(d.getDay() + 6) % 7] += 1;
  });
  const heatMax = Math.max(1, ...heat.flat());

  const recent = published.slice(0, 12);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Desempenho real de publicações, views de Reels e contas conectadas."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshBatch.mutate()}
              disabled={refreshBatch.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
              title="Puxa dados da Meta Graph API em tempo real"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshBatch.isPending ? "animate-spin text-primary" : ""}`} />
              {refreshBatch.isPending ? "Sincronizando..." : "Sincronizar Views (Meta)"}
            </button>
            <button
              onClick={() => {
                const rows = [["data", "status", "tipo", "views", "likes", "permalink"], ...posts.map((p: any) => [
                  p.published_at ?? p.scheduled_at ?? "", p.status ?? "", p.post_type ?? "", p.view_count ?? 0, p.like_count ?? 0, p.ig_permalink ?? "",
                ])];
                const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
                const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                const a = document.createElement("a"); a.href = url; a.download = "elite-analytics.csv"; a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
            >
              <Download className="h-4 w-4" /> Exportar CSV
            </button>
          </div>
        }
      />
      <PageBody>
        {accounts.length === 0 && (
          <div className="card-elevated mb-5 p-4 border-warning/40 text-sm">
            Conecte uma conta do Instagram para ver dados de seguidores e mídia.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-5">
          <Metric icon={Eye} label="Views em Reels" value={totalViews.toLocaleString("pt-BR")} sub={`média ~${avgViews.toLocaleString("pt-BR")}/reel`} tone="success" />
          <Metric icon={Users} label="Seguidores" value={totalFollowers.toLocaleString("pt-BR")} sub={`${accounts.length} conta(s)`} />
          <Metric icon={CheckCircle2} label="Publicadas" value={published.length.toLocaleString("pt-BR")} sub={`taxa ${successRate}%`} tone="success" />
          <Metric icon={Clock} label="Agendadas" value={scheduled.length.toLocaleString("pt-BR")} sub="na fila" />
          <Metric icon={XCircle} label="Com falha" value={failed.length.toLocaleString("pt-BR")} sub="revisar" tone={failed.length ? "danger" : undefined} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="card-elevated p-5 lg:col-span-2">
            <h3 className="font-display text-base font-semibold">Publicações por dia (14d)</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.28 0.02 85 / 0.4)" />
                  <XAxis dataKey="date" stroke="oklch(0.66 0.02 85)" fontSize={11} />
                  <YAxis stroke="oklch(0.66 0.02 85)" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "oklch(0.145 0.006 60)", border: "1px solid oklch(0.28 0.02 85)", borderRadius: 12 }} />
                  <Bar dataKey="publicadas" fill="#d4af37" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card-elevated p-5">
            <h3 className="font-display text-base font-semibold">Horário das publicações</h3>
            <p className="mt-1 text-xs text-muted-foreground">Frequência por hora × dia da semana</p>
            <div className="mt-4 grid grid-cols-8 gap-1 text-[10px]">
              <div />
              {["S","T","Q","Q","S","S","D"].map((d, i) => <div key={i} className="text-center text-muted-foreground">{d}</div>)}
              {Array.from({ length: 12 }).map((_, hr) => (
                <div key={`row-${hr}`} className="contents">
                  <div className="text-right text-muted-foreground pr-1">{hr * 2}h</div>
                  {Array.from({ length: 7 }).map((_, day) => {
                    const v = heat[hr][day] / heatMax;
                    return (
                      <div key={`c${hr}-${day}`} className="aspect-square rounded-sm" title={`${heat[hr][day]} post(s)`}
                        style={{ background: `oklch(0.80 0.14 85 / ${0.06 + v * 0.75})` }} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 card-elevated p-5">
          <h3 className="font-display text-base font-semibold">Contas conectadas</h3>
          {accounts.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma conta ainda.</p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="h-10 w-10 rounded-full ig-gradient p-0.5 shrink-0">
                    <div className="h-full w-full rounded-full bg-card overflow-hidden flex items-center justify-center">
                      {a.profile_picture_url
                        ? <img src={a.profile_picture_url} alt="" className="h-full w-full object-cover" />
                        : <ImageIcon className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">@{a.username}</div>
                    <div className="text-[11px] text-muted-foreground">{(a.followers_count ?? 0).toLocaleString("pt-BR")} seguidores · {a.media_count ?? 0} posts</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-[11px] text-muted-foreground">Total de mídia nas contas: {totalMedia.toLocaleString("pt-BR")}</div>
        </div>

        <div className="mt-6 card-elevated p-5">
          <h3 className="font-display text-base font-semibold">Publicadas recentes</h3>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma publicação ainda.</p>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6">
              {recent.map((p) => {
                const thumb = p.post_media?.[0]?.media_assets?.public_url;
                return (
                  <a key={p.id} href={p.ig_permalink ?? "#"} target="_blank" rel="noreferrer"
                    className="group relative aspect-square overflow-hidden rounded-lg bg-muted">
                    {thumb
                      ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                      : <div className="h-full w-full ig-gradient opacity-70" />}
                    <div className="absolute inset-0 flex flex-col justify-end p-2 text-white bg-gradient-to-t from-black/70 to-transparent text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center gap-1"><ExternalLink className="h-3 w-3" /> Abrir no Instagram</div>
                      <div className="mt-0.5">{p.published_at ? format(new Date(p.published_at), "dd MMM, HH:mm", { locale: ptBR }) : ""}</div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </PageBody>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone?: "success" | "danger" }) {
  const toneClass = tone === "success" ? "text-success" : tone === "danger" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="card-elevated p-5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span> <Icon className="h-4 w-4" />
      </div>
      <div className="mt-2 font-display text-2xl font-semibold">{value}</div>
      {sub && <div className={`text-[11px] ${toneClass}`}>{sub}</div>}
    </div>
  );
}
