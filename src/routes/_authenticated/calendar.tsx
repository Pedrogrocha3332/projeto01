import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody } from "@/components/app/page";
import { useMemo, useState } from "react";
import { addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, PenSquare, Video } from "lucide-react";
import { AssetImage } from "@/components/app/asset-image";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
});

function CalendarPage() {
  const [cursor, setCursor] = useState(new Date());
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) arr.push(new Date(d));
    return arr;
  }, [start, end]);

  const { data: posts = [] } = useQuery({
    queryKey: ["calendar", format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data } = await supabase
        .from("scheduled_posts")
        .select("id, caption, status, scheduled_at, post_type, cover:media_assets!cover_media_id(public_url, storage_path, mime_type), post_media(position, media_assets(public_url, storage_path, mime_type))")
        .gte("scheduled_at", start.toISOString())
        .lte("scheduled_at", end.toISOString())
        .order("scheduled_at");
      return data ?? [];
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, typeof posts>();
    for (const p of posts) {
      const k = format(new Date(p.scheduled_at), "yyyy-MM-dd");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return map;
  }, [posts]);

  return (
    <div>
      <PageHeader
        title="Calendário"
        description="Visualize sua fila e identifique lacunas."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setCursor(addMonths(cursor, -1))} className="rounded-md border border-border p-2 hover:bg-accent" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
            <div className="font-display text-sm font-semibold w-40 text-center capitalize">{format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}</div>
            <button onClick={() => setCursor(addMonths(cursor, 1))} className="rounded-md border border-border p-2 hover:bg-accent" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
            <Link to="/compose" className="ml-2 inline-flex items-center gap-1.5 rounded-lg ig-gradient px-3 py-2 text-xs font-semibold text-primary-foreground shadow">
              <PenSquare className="h-3.5 w-3.5" /> Nova
            </Link>
          </div>
        }
      />
      <PageBody>
        <div className="card-elevated overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border/60 bg-muted/40 text-xs font-medium text-muted-foreground">
            {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d) => <div key={d} className="p-2 text-center">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 auto-rows-[minmax(120px,auto)]">
            {days.map((d) => {
              const key = format(d, "yyyy-MM-dd");
              const dayPosts = byDay.get(key) ?? [];
              const conflict = dayPosts.length > 3;
              const inMonth = isSameMonth(d, cursor);
              const today = isSameDay(d, new Date());
              return (
                <div key={key} className={`border-b border-r border-border/40 p-1.5 ${inMonth ? "" : "opacity-40"} ${conflict ? "bg-warning/5" : ""}`}>
                  <div className="flex items-center justify-between px-1">
                    <span className={`text-xs ${today ? "flex h-6 w-6 items-center justify-center rounded-full ig-gradient text-primary-foreground font-bold" : "text-muted-foreground"}`}>
                      {format(d, "d")}
                    </span>
                    {conflict && <span className="text-[10px] text-warning">{dayPosts.length} posts</span>}
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayPosts.slice(0, 3).map((p: any) => {
                      const media = (p.post_media ?? []).slice().sort((a: any, b: any) => a.position - b.position).map((m: any) => m.media_assets).filter(Boolean);
                      const nonVideo = media.find((m: any) => !(m.mime_type || "").startsWith("video"));
                      const thumb = p.cover ?? nonVideo ?? media[0];
                      const isVideo = !!thumb && (thumb.mime_type || "").startsWith("video");
                      return (
                        <div key={p.id} className="group flex items-center gap-1.5 rounded-md bg-card border border-border/60 p-1 text-[11px]">
                          <div className="h-6 w-6 shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center">
                            {thumb?.storage_path && !isVideo ? (
                              <AssetImage storagePath={thumb.storage_path} publicUrl={thumb.public_url} className="h-full w-full object-cover" />
                            ) : (
                              <Video className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 truncate">{p.caption?.slice(0, 24) || p.post_type}</div>
                        </div>
                      );
                    })}
                    {dayPosts.length > 3 && <div className="pl-1 text-[10px] text-muted-foreground">+{dayPosts.length - 3} mais</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Reagendamento por arrastar em breve. Por enquanto, edite a data pela Fila.</p>
      </PageBody>
    </div>
  );
}
