import { createFileRoute, Outlet, redirect, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import {
  LayoutDashboard, ListChecks, PenSquare,
  Image as ImageIcon, Instagram, Menu, X, LogOut, KeyRound, Repeat,
  ChevronDown, ChevronUp, Send,
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

const POSTAGEM_ITEMS = [
  { to: "/rounds", label: "Publicação em rodadas", icon: ListChecks },
  { to: "/compose", label: "Nova publicação", icon: PenSquare },
] as const;

const PRIMARY_TOP = [
  { to: "/dashboard", label: "Painel", icon: LayoutDashboard },
  { to: "/pools", label: "Pools de Rotação", icon: Repeat, accent: true },
] as const;

const PRIMARY_BOTTOM = [
  { to: "/queue", label: "Fila", icon: ListChecks },
  { to: "/media", label: "Biblioteca", icon: ImageIcon },
] as const;

const SECONDARY = [
  { to: "/accounts", label: "Contas do Instagram", icon: Instagram },
  { to: "/import-center", label: "Central de envio", icon: ImageIcon },
  { to: "/meta-api", label: "Meta API", icon: KeyRound },
] as const;

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext() as { user: User };
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [postagemOpen, setPostagemOpen] = useState(true);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdminPrincipal } = useIsAdminPrincipal();
  useRealtimeSync();

  const isPostagemActive = pathname.startsWith("/rounds") || pathname.startsWith("/compose");

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; accent?: boolean };

  const RenderNavLink = ({ item, isSub = false }: { item: NavItem; isSub?: boolean }) => {
    const active = pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(item.to));
    const isAccent = item.accent;
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={`group relative flex items-center gap-3 rounded-xl transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] ${
          isSub ? "px-2.5 py-2 text-xs" : "px-3 py-2.5 text-sm"
        } font-medium ${
          active
            ? "bg-[#09090B] text-[#E5B842] border border-[#E5B842]/30 font-semibold shadow-xs"
            : isAccent
            ? "bg-[#F4F4F6] text-[#09090B] border border-[#E5E5EA] hover:bg-[#EAEAEA] font-semibold"
            : "text-[#344054] hover:bg-[#F2F4F7] hover:text-[#101828]"
        }`}
      >
        <item.icon
          className={`${isSub ? "h-4 w-4" : "h-4.5 w-4.5"} shrink-0 transition-transform duration-150 group-hover:scale-105 ${
            active ? "text-[#E5B842]" : isAccent ? "text-[#09090B]" : "text-[#667085] group-hover:text-[#101828]"
          }`}
          aria-hidden="true"
        />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  const NavContent = () => (
    <div className="space-y-4">
      {/* Itens Superiores (Painel, Pools de Rotação) */}
      <nav className="space-y-1.5" aria-label="Navegação principal">
        {PRIMARY_TOP.map((item) => (
          <RenderNavLink key={item.to} item={item} />
        ))}

        {/* Grupo Retrátil Postagem */}
        <div className="space-y-1 pt-0.5">
          <button
            type="button"
            onClick={() => setPostagemOpen((v) => !v)}
            title={collapsed ? "Postagem" : undefined}
            className={`group relative flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090B] ${
              isPostagemActive && !postagemOpen
                ? "bg-[#09090B] text-[#E5B842] border border-[#E5B842]/30 font-semibold shadow-xs"
                : "text-[#344054] hover:bg-[#F2F4F7] hover:text-[#101828]"
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Send
                className={`h-4.5 w-4.5 shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                  isPostagemActive && !postagemOpen ? "text-[#E5B842]" : "text-[#667085] group-hover:text-[#101828]"
                }`}
                aria-hidden="true"
              />
              {!collapsed && <span className="truncate">Postagem</span>}
            </div>
            {!collapsed && (
              <span className="text-[#98A2B3] group-hover:text-[#101828]">
                {postagemOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            )}
          </button>

          {(postagemOpen || collapsed) && (
            <div className={`${collapsed ? "space-y-1 pt-1" : "pl-3 ml-3 border-l-2 border-[#E5E5EA] space-y-1 my-1"}`}>
              {POSTAGEM_ITEMS.map((item) => (
                <RenderNavLink key={item.to} item={item} isSub={!collapsed} />
              ))}
            </div>
          )}
        </div>

        {/* Itens Inferiores (Fila, Biblioteca) */}
        {PRIMARY_BOTTOM.map((item) => (
          <RenderNavLink key={item.to} item={item} />
        ))}
      </nav>

      {/* Seção Configuração */}
      <div className="pt-3 border-t border-[#EAECF0]">
        {!collapsed && (
          <div className="px-3 pb-2 text-[10.5px] font-bold uppercase tracking-wider text-[#98A2B3]">
            Configuração
          </div>
        )}
        <nav className="space-y-1.5" aria-label="Configurações">
          {SECONDARY.map((item) => (
            <RenderNavLink key={item.to} item={item} />
          ))}
        </nav>
      </div>
    </div>
  );

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
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavContent />
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
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <NavContent />
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
