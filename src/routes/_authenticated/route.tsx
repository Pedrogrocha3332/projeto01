import { createFileRoute, Outlet, redirect, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  LayoutDashboard, CalendarDays, ListChecks, PenSquare, BarChart3,
  Image as ImageIcon, Instagram, Settings, BookOpen, Menu, X, LogOut, KeyRound, Crown, Mail, Repeat,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { LiveClock } from "@/components/app/live-clock";
import { NotificationBell } from "@/components/app/notification-bell";
import { useIsAdminPrincipal } from "@/hooks/use-role";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";
import { FloatingAgent } from "@/components/app/floating-agent";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { redirect: location.href } as never });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { to: "/compose", label: "Nova publicação", icon: PenSquare, accent: true },
  { to: "/rounds", label: "Publicação em rodadas", icon: ListChecks },
  { to: "/pools", label: "Pools de Rotação", icon: Repeat },
  { to: "/calendar", label: "Calendário", icon: CalendarDays },
  { to: "/queue", label: "Fila", icon: ListChecks },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/media", label: "Biblioteca", icon: ImageIcon },
  { to: "/import-center", label: "Central de envio", icon: ImageIcon },
  { to: "/accounts", label: "Contas do Instagram", icon: Instagram },
] as const;

const SECONDARY = [
  { to: "/settings", label: "Configurações", icon: Settings },
  { to: "/meta-api", label: "Meta API", icon: KeyRound },
  { to: "/setup-guide", label: "Guia de Instalação", icon: BookOpen },
] as const;

const ADMIN_ONLY = [
  { to: "/invites", label: "Convites", icon: Mail },
] as const;

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext() as { user: User };
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdminPrincipal } = useIsAdminPrincipal();
  useRealtimeSync();

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; accent?: boolean };

  const NavItems = ({ items }: { items: readonly NavItem[] }) => (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const active = pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(item.to));
        const isAccent = item.accent;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : isAccent
                ? "text-primary-foreground shadow-md ig-gradient hover:opacity-95"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            }`}
          >
            <item.icon className={`h-4 w-4 shrink-0 ${active && !isAccent ? "text-primary" : ""}`} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const primaryItems: NavItem[] = [
    ...NAV,
    ...(isAdminPrincipal ? ADMIN_ONLY : []),
  ];
  const secondaryItems: NavItem[] = [...SECONDARY];


  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar - desktop */}
      <aside
        className={`hidden md:flex md:flex-col shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] ${
          collapsed ? "md:w-16" : "md:w-60"
        }`}
      >
        <div className="flex h-16 items-center gap-2.5 px-4 border-b border-sidebar-border">
          <div className="h-8 w-8 rounded-lg ig-gradient shrink-0 flex items-center justify-center">
            <Crown className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && <span className="font-display text-lg font-bold gold-text tracking-wider">ELITE</span>}
          <div className="ml-auto flex items-center gap-1">
            {!collapsed && <NotificationBell userId={user.id} />}
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label="Alternar menu"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-6">
          <NavItems items={primaryItems} />
          <div>
            {!collapsed && <div className="px-3 pb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/50">Configurar</div>}
            <NavItems items={secondaryItems} />
          </div>
        </div>
        {!collapsed && (
          <div className="px-3 pb-3">
            <LiveClock />
          </div>
        )}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg p-2">
            <div className="h-8 w-8 shrink-0 rounded-full ig-gradient flex items-center justify-center text-primary-foreground text-xs font-semibold">
              {(user.email ?? "?").charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs font-medium">{user.email}</div>
                  {isAdminPrincipal && <div className="text-[10px] gold-text font-semibold">Administrador Principal</div>}
                </div>
                <button onClick={handleSignOut} className="rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-destructive" title="Sair">
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div
        className="md:hidden fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur px-4"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
          height: "calc(3.5rem + env(safe-area-inset-top))",
        }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="-ml-2 rounded-md p-3 hover:bg-accent active:bg-accent"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md ig-gradient flex items-center justify-center"><Crown className="h-3 w-3 text-primary-foreground" /></div>
          <span className="font-display font-bold gold-text tracking-wider">ELITE</span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell userId={user.id} />
          <LiveClock compact />
        </div>
      </div>


      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex w-64 flex-col bg-sidebar border-r border-sidebar-border">
            <div className="flex h-14 items-center justify-between px-4 border-b border-sidebar-border">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-md ig-gradient flex items-center justify-center"><Crown className="h-3.5 w-3.5 text-primary-foreground" /></div>
                <span className="font-display font-bold gold-text tracking-wider">ELITE</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="rounded-md p-1.5 hover:bg-sidebar-accent"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-6">
              <NavItems items={primaryItems} />
              <div>
                <div className="px-3 pb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/50">Configurar</div>
                <NavItems items={secondaryItems} />
              </div>
            </div>
            <div className="px-3 py-2"><LiveClock /></div>
            <div className="border-t border-sidebar-border p-3">
              <div className="flex items-center gap-2">
                <div className="text-xs truncate text-sidebar-foreground/70 flex-1">{user.email}</div>
                <button onClick={handleSignOut} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"><LogOut className="h-4 w-4" /></button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div
          className="md:hidden"
          style={{ height: "calc(3.5rem + env(safe-area-inset-top))" }}
          aria-hidden
        />
        <Outlet />
      </main>

      <FloatingAgent />



    </div>
  );
}
