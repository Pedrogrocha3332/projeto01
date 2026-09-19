import { useEffect, useRef, useState } from "react";
import { Bell, X, AlertTriangle, Check, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { retryPostManually } from "@/lib/retry.functions";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read_at: string | null;
  created_at: string;
  metadata: any;
};

export function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const askedPerm = useRef(false);
  const retryFn = useServerFn(retryPostManually);

  const unread = items.filter((i) => !i.read_at).length;

  async function load() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setItems(data as NotificationItem[]);
  }

  useEffect(() => {
    load();
    if (!askedPerm.current && typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "default") {
      askedPerm.current = true;
      window.Notification.requestPermission().catch(() => {});
    }

    const channel = supabase.channel(`notif-${userId}-${Math.random().toString(36).slice(2, 8)}`);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (payload) => {
        const n = payload.new as NotificationItem;
        setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
        toast.error(n.title, { description: n.message ?? undefined, duration: 8000 });
        try {
          if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
            new window.Notification(n.title, { body: n.message ?? "", tag: n.id });
          }
        } catch {}
      },
    );
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);


  async function markAllRead() {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (!ids.length) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, read_at: new Date().toISOString() } : i)));
  }

  async function remove(id: string) {
    await supabase.from("notifications").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function markRead(id: string) {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read_at: new Date().toISOString() } : i)));
  }

  async function handleRetry(n: NotificationItem) {
    const postId = n.metadata?.post_id as string | undefined;
    if (!postId) return;
    setRetryingId(n.id);
    try {
      await retryFn({ data: { postId } });
      toast.success("Tentando novamente — o post foi reenviado para a fila.");
      await markRead(n.id);
    } catch (e) {
      toast.error("Não foi possível reiniciar o post", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        aria-label="Notificações"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] rounded-lg border border-border bg-popover shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="text-sm font-semibold">Notificações</div>
              <div className="flex gap-1">
                {unread > 0 && (
                  <button onClick={markAllRead} className="rounded p-1 text-xs text-muted-foreground hover:bg-accent" title="Marcar todas como lidas">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma notificação</div>
              ) : (
                items.map((n) => {
                  const canRetry = n.type === "publish_failed_final" && n.metadata?.can_retry && n.metadata?.post_id;
                  return (
                    <div
                      key={n.id}
                      className={`group border-b border-border/50 px-3 py-2.5 last:border-0 ${!n.read_at ? "bg-accent/30" : ""}`}
                    >
                      <div className="flex gap-2">
                        <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${n.type.startsWith("publish_failed") ? "text-destructive" : "text-primary"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium leading-tight">{n.title}</div>
                          {n.message && <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-3">{n.message}</div>}
                          <div className="mt-1 text-[10px] text-muted-foreground/70">
                            {new Date(n.created_at).toLocaleString("pt-BR")}
                          </div>
                          {canRetry && (
                            <button
                              onClick={() => handleRetry(n)}
                              disabled={retryingId === n.id}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                            >
                              <RefreshCw className={`h-3 w-3 ${retryingId === n.id ? "animate-spin" : ""}`} />
                              {retryingId === n.id ? "Reiniciando..." : "Tentar novamente manualmente"}
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => remove(n.id)}
                          className="opacity-0 group-hover:opacity-100 rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive self-start"
                          aria-label="Remover"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
