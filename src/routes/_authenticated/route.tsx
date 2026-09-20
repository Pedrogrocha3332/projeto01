import { createFileRoute, Outlet, redirect, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  LayoutDashboard, ListChecks, PenSquare, BarChart3,
  Image as ImageIcon, Instagram, Menu, X, LogOut, KeyRound, Repeat,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useIsAdminPrincipal } from "@/hooks/use-role";
import { useRealtimeSync } from "@/hooks/use-realtime-sync";

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
  { to: "/pools", label: "Pools de Rotação", icon: Repeat, accent: true },
  { to: "/rounds", label: "Publicação em rodadas", icon: ListChecks },
  { to: "/compose", label: "Nova publicação", icon: PenSquare },
  { to: "/queue", label: "Fila", icon: ListChecks },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/media", label: "Biblioteca", icon: ImageIcon },
  { to: "/import-center", label: "Central de envio", icon: ImageIcon },
  { to: "/accounts", label: "Contas do Instagram", icon: Instagram },
] as const;

const SECONDARY = [
  { to: "/meta-api", label: "Meta API", icon: KeyRound },
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

  const NavItems = ({ items, label }: { items: readonly NavItem[]; label?: string }) => (
    <nav className="space-y-1.5" aria-label={label || "Navegação"}>
      {items.map((item) => {
        const active = pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(item.to));
        const isAccent = item.accent;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] ${
              active
                ? "bg-[#09090B] text-white font-semibold shadow-xs"
                : isAccent
                ? "bg-[#F4F4F6] text-[#09090B] border border-[#E5E5EA] hover:bg-[#EAEAEA] font-semibold"
                : "text-[#344054] hover:bg-[#F2F4F7] hover:text-[#101828]"
            }`}
          >
            <item.icon
              className={`h-4.5 w-4.5 shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                active ? "text-white" : isAccent ? "text-[#09090B]" : "text-[#667085] group-hover:text-[#101828]"
              }`}
              aria-hidden="true"
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const primaryItems: NavItem[] = [...NAV];
  const secondaryItems: NavItem[] = [...SECONDARY];

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar - desktop */}
      <aside
        className={`hidden md:flex md:flex-col shrink-0 border-r border-[#EAECF0] bg-white transition-[width] duration-200 ${
          collapsed ? "md:w-16" : "md:w-60"
        }`}
      >
        <div
          className={`relative flex items-center justify-center bg-white border-b border-[#EAECF0] transition-all duration-200 ${
            collapsed ? "h-20 px-2" : "py-5 px-4"
          }`}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="flex items-center justify-center rounded-xl p-1 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B]"
              aria-label="Expandir menu"
              title="Expandir menu"
            >
              <img
                src="/alpha-elite-sidebar-logo.png"
                alt="Alpha Elite"
                className="h-12 w-12 object-contain"
              />
            </button>
          ) : (
            <>
              <button
                onClick={() => setCollapsed(true)}
                className="absolute right-3 top-3 rounded-lg p-1.5 text-[#667085] hover:bg-[#F2F4F7] hover:text-[#101828] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B]"
                aria-label="Recolher menu"
                title="Recolher menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <Link
                to="/dashboard"
                className="flex items-center justify-center transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] rounded-2xl"
                title="Alpha Elite - Painel"
              >
                <img
                  src="/alpha-elite-sidebar-logo.png"
                  alt="Alpha Elite"
                  className="w-32 h-32 object-contain"
                />
              </Link>
            </>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          <NavItems items={primaryItems} label="Navegação principal" />
          <div className="pt-3 border-t border-[#EAECF0]">
            {!collapsed && (
              <div className="px-3 pb-2 text-[10.5px] font-bold uppercase tracking-wider text-[#98A2B3]">
                Configuração
              </div>
            )}
            <NavItems items={secondaryItems} label="Configurações" />
          </div>
        </div>

        {/* User Profile Footer */}
        <div className="border-t border-[#EAECF0] p-3 bg-white">
          <div className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-[#F2F4F7]">
            <div
              className="h-9 w-9 shrink-0 rounded-full bg-[#EEF2F6] border border-[#E2E8F0] flex items-center justify-center text-[#1E293B] text-xs font-bold shadow-xs"
              aria-hidden="true"
            >
              {(user.email ?? "?").charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs font-semibold text-[#101828] tracking-tight" title={user.email}>
                    {user.email}
                  </div>
                  {isAdminPrincipal && (
                    <div className="text-[10.5px] text-[#667085] font-medium tracking-tight">
                      Administrador Principal
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSignOut}
                  className="rounded-lg p-1.5 text-[#98A2B3] transition-colors hover:bg-[#FEE2E2] hover:text-[#EF4444] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B]"
                  title="Sair da conta"
                  aria-label="Sair da conta"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div
        className="md:hidden fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-[#EAECF0] bg-white/95 backdrop-blur px-4"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
          height: "calc(3.75rem + env(safe-area-inset-top))",
        }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu de navegação"
          className="-ml-2 rounded-lg p-2 text-[#344054] hover:bg-[#F2F4F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B]"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>
        <Link
          to="/dashboard"
          className="flex items-center justify-center transition-transform active:scale-95"
          aria-label="Alpha Elite - Ir para o painel"
        >
          <img
            src="/alpha-elite-sidebar-logo.png"
            alt="Alpha Elite"
            className="h-12 w-12 object-contain"
          />
        </Link>
        <div className="w-10" aria-hidden="true" />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação mobile"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex w-68 max-w-[85vw] flex-col bg-white border-r border-[#EAECF0] shadow-2xl">
            <div className="relative flex items-center justify-center bg-white border-b border-[#EAECF0] py-4 px-4">
              <Link
                to="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-center transition-transform hover:scale-105"
                title="Alpha Elite - Painel"
              >
                <img
                  src="/alpha-elite-sidebar-logo.png"
                  alt="Alpha Elite"
                  className="w-28 h-28 object-contain"
                />
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-1.5 text-[#667085] hover:bg-[#F2F4F7] hover:text-[#101828] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B]"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
              <NavItems items={primaryItems} label="Navegação principal" />
              <div className="pt-3 border-t border-[#EAECF0]">
                <div className="px-3 pb-2 text-[10.5px] font-bold uppercase tracking-wider text-[#98A2B3]">
                  Integração
                </div>
                <NavItems items={secondaryItems} label="Integrações" />
              </div>
            </div>
            <div className="border-t border-[#EAECF0] p-3 bg-white">
              <div className="flex items-center gap-2.5 rounded-xl p-1.5">
                <div
                  className="h-8 w-8 shrink-0 rounded-full bg-[#EEF2F6] border border-[#E2E8F0] flex items-center justify-center text-[#1E293B] text-xs font-bold"
                  aria-hidden="true"
                >
                  {(user.email ?? "?").charAt(0).toUpperCase()}
                </div>
                <div className="text-xs truncate text-[#101828] font-semibold flex-1">
                  {user.email}
                </div>
                <button
                  onClick={handleSignOut}
                  className="rounded-lg p-1.5 text-[#98A2B3] hover:text-[#EF4444] hover:bg-[#FEE2E2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B]"
                  aria-label="Sair da conta"
                  title="Sair"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
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
    </div>
  );
}
