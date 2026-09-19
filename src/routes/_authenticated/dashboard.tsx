import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageBody, StatusBadge, GradientButton } from "@/components/app/page";
import { CheckCircle2, Circle, Instagram, Image as ImageIcon, PenSquare, TrendingUp, Clock, Mail, Copy, Check, Share2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { LiveClock } from "@/components/app/live-clock";
import { useIsAdminPrincipal } from "@/hooks/use-role";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});


function Dashboard() {
  const { isAdminPrincipal } = useIsAdminPrincipal();
  const [copied, setCopied] = useState(false);
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
  const hasAnyPost = scheduledCount + publishedCount + failedCount > 0;

  const checklist = [
    { done: accounts.length > 0, label: "Conectar uma conta do Instagram", href: "/accounts" as const },
    { done: (data?.mediaCount ?? 0) > 0, label: "Enviar sua primeira mídia", href: "/media" as const },
    { done: hasAnyPost, label: "Agendar sua primeira publicação", href: "/compose" as const },
  ];
  const completed = checklist.filter((c) => c.done).length;

  return (
    <div>
      <PageHeader
        title="Painel"
        description="Sua automação do Instagram, num relance."
        actions={
          <div className="flex items-center gap-2">
            <LiveClock />
            <Link to="/compose"><GradientButton><PenSquare className="h-4 w-4" /> Nova publicação</GradientButton></Link>
          </div>
        }
      />
      <PageBody>
        {completed < checklist.length && (
          <div className="card-elevated mb-6 p-6" style={{ background: "var(--gradient-ig-soft)" }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold">Comece agora</h2>
                <p className="text-sm text-muted-foreground">{completed} de {checklist.length} concluídos</p>
              </div>
              <div className="h-14 w-14 rounded-full ig-gradient flex items-center justify-center text-primary-foreground font-semibold">
                {Math.round((completed / checklist.length) * 100)}%
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {checklist.map((step) => (
                <li key={step.label}>
                  <Link to={step.href} className="flex items-center gap-3 rounded-lg p-2 hover:bg-card/50">
                    {step.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                    <span className={step.done ? "line-through text-muted-foreground" : "font-medium"}>{step.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <Stat icon={Instagram} label="Contas conectadas" value={accounts.length} />
          <Stat icon={Clock} label="Agendadas" value={scheduledCount} />
          <Stat icon={TrendingUp} label="Publicadas" value={publishedCount} />
          <Stat icon={ImageIcon} label="Mídias" value={data?.mediaCount ?? 0} />
        </div>

        {isAdminPrincipal && (
          <div className="mt-6 card-elevated p-5 border border-primary/30 bg-primary/5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg ig-gradient flex items-center justify-center shrink-0">
                  <Mail className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-display text-base font-semibold">Convidar novo membro</h3>
                  <p className="text-sm text-muted-foreground">
                    O ELITE é privado. Gere um link único para enviar por WhatsApp ou e-mail.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/invites"
                  className="inline-flex items-center justify-center gap-2 rounded-lg ig-gradient px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  <PenSquare className="h-4 w-4" /> Gerar convite
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="card-elevated p-5 md:col-span-2">
            <h3 className="font-display text-base font-semibold">Próximas publicações</h3>
            {upcoming.length === 0 ? (
              <p className="mt-6 text-center text-sm text-muted-foreground py-6">Nada agendado por enquanto.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border/60">
                {upcoming.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={p.status} />
                        <span className="text-xs text-muted-foreground">{p.post_type}</span>
                      </div>
                      <div className="truncate text-sm mt-1">{p.caption?.slice(0, 80) || "(sem legenda)"}</div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(p.scheduled_at), { addSuffix: true, locale: ptBR })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card-elevated p-5">
            <h3 className="font-display text-base font-semibold">Saúde do sistema</h3>
            <div className="mt-4 space-y-3 text-sm">
              <Row label="Publicações com falha" value={failedCount} tone={failedCount ? "bad" : "ok"} />
              <Row label="Contas ativas" value={accounts.length} tone={accounts.length ? "ok" : "warn"} />
              <Row label="Meta API" value="Operacional" tone="ok" />
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="card-elevated p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 font-display text-3xl font-semibold">{value}</div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string | number; tone: "ok" | "warn" | "bad" }) {
  const toneClass = tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-destructive";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}
