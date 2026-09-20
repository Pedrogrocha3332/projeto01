import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, StatusBadge } from "@/components/app/page";
import { Instagram, Image as ImageIcon, PenSquare, TrendingUp, Clock, Repeat, CalendarClock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: async () => {
      const [accounts, upcoming, media, scheduledCount, publishedCount, failedCount] = await Promise.all([
        supabase.from("instagram_accounts").select("id, user_id, ig_user_id, username, account_type, profile_picture_url, page_id, page_name, token_expires_at, followers_count, media_count, is_active, created_at, updated_at").eq("is_active", true),
        supabase.from("scheduled_posts").select("id, status, post_type, caption, scheduled_at").eq("status", "scheduled").order("scheduled_at", { ascending: true }).limit(5),
        supabase.from("media_assets").select("id", { count: "exact", head: true }),
        supabase.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
        supabase.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "published"),
        supabase.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "failed"),
      ]);
      return {
        accounts: accounts.data ?? [],
        upcoming: upcoming.data ?? [],
        mediaCount: media.count ?? 0,
        scheduledCount: scheduledCount.count ?? 0,
        publishedCount: publishedCount.count ?? 0,
        failedCount: failedCount.count ?? 0,
      };
    },
  });

  const accounts = data?.accounts ?? [];
  const upcoming = data?.upcoming ?? [];
  const scheduledCount = data?.scheduledCount ?? 0;
  const publishedCount = data?.publishedCount ?? 0;
  const failedCount = data?.failedCount ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader
        title="Painel"
        description="Sua automação do Instagram, num relance."
        actions={
          <Link
            to="/compose"
            className="inline-flex items-center gap-2 rounded-xl bg-[#09090B] px-4.5 py-2.5 text-sm font-semibold text-white shadow-xs transition-all duration-200 hover:bg-[#18181B] hover:shadow-md active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] focus-visible:ring-offset-2 min-h-[44px]"
          >
            <PenSquare className="h-4 w-4 text-white" aria-hidden="true" />
            <span>Nova publicação</span>
          </Link>
        }
      />
      <PageBody>
        {/* AÇÕES RÁPIDAS */}
        <div className="card-elevated p-6 mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#27272A] mb-4">
            Ações Rápidas
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Link
              to="/accounts"
              className="flex items-center justify-between rounded-2xl border border-[#E5E5EA] p-4 transition-all duration-200 hover:border-[#09090B]/30 hover:shadow-md bg-white group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] focus-visible:ring-offset-2 min-h-[72px]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className="h-11 w-11 rounded-full text-white flex items-center justify-center shrink-0 shadow-xs transition-transform group-hover:scale-105"
                  style={{
                    background: "linear-gradient(45deg, #FEDA75 0%, #FA7E1E 25%, #D62976 50%, #962FBF 75%, #4F5BD5 100%)",
                  }}
                  aria-hidden="true"
                >
                  <Instagram className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm text-[#18181B] group-hover:text-black transition-colors">
                    Conectar Contas
                  </div>
                  <div className="text-xs text-[#4B5563] truncate font-medium mt-0.5">
                    Adicionar perfis de Instagram
                  </div>
                </div>
              </div>
            </Link>

            <Link
              to="/pools"
              className="flex items-center justify-between rounded-2xl border border-[#E5E5EA] p-4 transition-all duration-200 hover:border-[#09090B]/30 hover:shadow-md bg-white group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] focus-visible:ring-offset-2 min-h-[72px]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className="h-11 w-11 rounded-full text-white flex items-center justify-center shrink-0 shadow-xs transition-transform group-hover:scale-105"
                  style={{
                    background: "linear-gradient(135deg, #27272A 0%, #18181B 50%, #09090B 100%)",
                  }}
                  aria-hidden="true"
                >
                  <Repeat className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm text-[#18181B] group-hover:text-black transition-colors">
                    Pools de Rotação
                  </div>
                  <div className="text-xs text-[#4B5563] truncate font-medium mt-0.5">
                    Gerenciar legendas e filas
                  </div>
                </div>
              </div>
            </Link>

            <Link
              to="/compose"
              className="flex items-center justify-between rounded-2xl border border-[#E5E5EA] p-4 transition-all duration-200 hover:border-[#09090B]/30 hover:shadow-md bg-white group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] focus-visible:ring-offset-2 min-h-[72px]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className="h-11 w-11 rounded-full bg-[#09090B] text-white flex items-center justify-center shrink-0 shadow-xs transition-transform group-hover:scale-105"
                  aria-hidden="true"
                >
                  <PenSquare className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-sm text-[#18181B] group-hover:text-black transition-colors">
                    Nova Publicação
                  </div>
                  <div className="text-xs text-[#4B5563] truncate font-medium mt-0.5">
                    Criar e agendar post
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* 4 STAT CARDS */}
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <Stat
            icon={Instagram}
            label="Contas conectadas"
            value={accounts.length}
            subtext="Perfis ativos no painel"
            badgeClass="bg-[#FDF2F8] text-[#BE185D] border border-[#FBCFE8]"
          />
          <Stat
            icon={Clock}
            label="Agendadas"
            value={scheduledCount}
            subtext="Aguardando publicação"
            badgeClass="bg-[#F4F4F6] text-[#09090B] border border-[#E5E5EA]"
          />
          <Stat
            icon={TrendingUp}
            label="Publicadas"
            value={publishedCount}
            subtext="Disparadas com sucesso"
            badgeClass="bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]"
          />
          <Stat
            icon={ImageIcon}
            label="Mídias"
            value={data?.mediaCount ?? 0}
            subtext="Prontas na biblioteca"
            badgeClass="bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A]"
          />
        </div>

        {/* BOTTOM SECTION */}
        <div className="grid gap-6 md:grid-cols-3">
          <div className="card-elevated p-6 md:col-span-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#27272A] mb-4">
              Próximas Publicações
            </h3>
            {upcoming.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div
                  className="h-12 w-12 rounded-2xl bg-[#F4F4F6] border border-[#E5E5EA] flex items-center justify-center text-[#09090B] mb-3 shadow-xs"
                  aria-hidden="true"
                >
                  <CalendarClock className="h-6 w-6" aria-hidden="true" />
                </div>
                <h4 className="text-sm font-bold text-[#101828]">Nenhuma publicação agendada</h4>
                <p className="text-xs text-[#667085] max-w-sm mt-1 mb-4 leading-relaxed">
                  Sua fila está vazia no momento. Crie e agende novos posts ou carrosséis para manter seu perfil sempre ativo.
                </p>
                <Link
                  to="/compose"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#09090B] px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-[#18181B] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] focus-visible:ring-offset-2 min-h-[44px]"
                >
                  <PenSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Agendar primeira publicação</span>
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {upcoming.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-3.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={p.status} />
                        <span className="text-xs text-[#4B5563] font-medium">{p.post_type}</span>
                      </div>
                      <div className="truncate text-sm font-semibold text-[#18181B] mt-1">
                        {p.caption?.slice(0, 80) || "(sem legenda)"}
                      </div>
                    </div>
                    <div className="text-xs text-[#4B5563] shrink-0 font-medium ml-4">
                      {formatDistanceToNow(new Date(p.scheduled_at), { addSuffix: true, locale: ptBR })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card-elevated p-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#27272A] mb-4">
              Saúde do Sistema
            </h3>
            <div className="space-y-1 text-sm">
              <Row label="Publicações com falha" value={failedCount} tone={failedCount ? "bad" : "neutral"} />
              <Row label="Contas ativas" value={accounts.length} tone="neutral" />
              <Row label="Meta API" value="Operacional" tone="ok" />
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  subtext,
  badgeClass,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  value: number;
  subtext?: string;
  badgeClass: string;
}) {
  return (
    <div className="card-elevated p-5 flex flex-col justify-between min-h-[140px] transition-all hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#4B4B55] font-semibold tracking-tight">{label}</span>
        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${badgeClass}`} aria-hidden="true">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-3">
        <div className="font-sans text-3xl font-bold text-[#09090B] tracking-tight">{value}</div>
        {subtext && <div className="text-[11px] text-[#667085] font-medium mt-1">{subtext}</div>}
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string | number; tone: "ok" | "warn" | "bad" | "neutral" }) {
  const toneClass =
    tone === "ok"
      ? "text-[#15803D] font-bold"
      : tone === "warn"
      ? "text-amber-600 font-bold"
      : tone === "bad"
      ? "text-rose-600 font-bold"
      : "text-[#18181B] font-bold";
  return (
    <div className="flex items-center justify-between py-2.5 px-1.5 border-b border-neutral-100 last:border-0 hover:bg-[#FAFAFB] rounded-lg transition-colors">
      <span className="text-[#4B4B55] text-xs font-medium">{label}</span>
      <span className={`text-xs ${toneClass} flex items-center gap-1.5`} role="status" aria-label={`${label}: ${value}`}>
        {tone === "ok" && <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse" aria-hidden="true" />}
        {value}
      </span>
    </div>
  );
}
