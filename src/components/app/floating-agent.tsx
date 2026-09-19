import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Send, X, Loader2, Sparkles, Minimize2, Volume2, VolumeX } from "lucide-react";
import { diagnosePosts } from "@/lib/diagnose.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import agentAvatar from "@/assets/elite-agent-avatar.png";

type Msg = { role: "user" | "assistant"; content: string; ts: number };

const STORAGE_KEY = "elite-agent-chat-v1";
const VOICE_PREF_KEY = "elite-agent-voice-on";

function loadHistory(): Msg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Msg[];
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch { return []; }
}

function saveHistory(m: Msg[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(m.slice(-40))); } catch { /* ignore */ }
}

// Avatar animado: flutua suavemente + brilho pulsante no núcleo.
function AgentAvatar({ size = 40, speaking = false }: { size?: number; speaking?: boolean }) {
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <div
        className={`absolute inset-0 rounded-full bg-primary/30 blur-md ${speaking ? "animate-pulse" : ""}`}
      />
      <img
        src={agentAvatar}
        alt="ELITE Agent"
        loading="lazy"
        className={`relative h-full w-full rounded-full object-cover object-top ring-2 ring-primary/50 ${
          speaking ? "elite-agent-speak" : "elite-agent-float"
        }`}
      />
      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-card animate-pulse" />
    </div>
  );
}

export function FloatingAgent() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fn = useServerFn(diagnosePosts);

  useEffect(() => {
    setMessages(loadHistory());
    try { setVoiceOn(localStorage.getItem(VOICE_PREF_KEY) === "1"); } catch { /* ignore */ }
  }, []);
  useEffect(() => { saveHistory(messages); }, [messages]);
  useEffect(() => {
    try { localStorage.setItem(VOICE_PREF_KEY, voiceOn ? "1" : "0"); } catch { /* ignore */ }
  }, [voiceOn]);

  const { data: badge } = useQuery({
    queryKey: ["agent-badge"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [flagged, failed] = await Promise.all([
        supabase.from("instagram_accounts").select("id", { count: "exact", head: true }).eq("needs_manual_review", true),
        supabase.from("scheduled_posts").select("id", { count: "exact", head: true }).eq("status", "failed"),
      ]);
      return (flagged.count ?? 0) + (failed.count ?? 0);
    },
  });

  function stopAudio() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    setSpeaking(false);
  }

  async function speak(text: string) {
    stopAudio();
    if (!voiceOn || !text) return;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      if (!bytes.byteLength) return;
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audioRef.current = audio;
      await audio.play();
      setSpeaking(true);
    } catch { /* autoplay bloqueado ou erro — silenciosamente ignora */ }
  }

  const ask = useMutation({
    mutationFn: async (q: string) => {
      const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      return fn({ data: { question: q, history } });
    },
    onSuccess: (r) => {
      setMessages((prev) => [...prev, { role: "assistant", content: r.answer, ts: Date.now() }]);
      if (voiceOn) void speak(r.answer);
    },
    onError: (e) => {
      const err = e instanceof Error ? e.message : "Falha ao consultar o agente";
      toast.error(err);
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${err}`, ts: Date.now() }]);
    },
  });

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, messages, ask.isPending]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => () => stopAudio(), []);

  function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || ask.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: q, ts: Date.now() }]);
    setInput("");
    ask.mutate(q);
  }

  function clearChat() { setMessages([]); saveHistory([]); }

  const suggestions = [
    "Como está a fila agora?",
    "Tem algum post travado?",
    "Alguma conta com problema?",
  ];

  const panel = open && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-x-2 bottom-2 z-[100] sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[380px]">
      <div className="flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden h-[70vh] sm:h-[560px]">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
          <div className="flex items-center gap-2.5 min-w-0">
            <AgentAvatar size={40} speaking={speaking || ask.isPending} />
            <div className="min-w-0">
              <div className="text-sm font-semibold flex items-center gap-1">
                ELITE Agent
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              <div className="text-[10px] text-muted-foreground">
                {speaking ? "Falando…" : ask.isPending ? "Analisando…" : "Cuidando da fila em tempo real"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { if (voiceOn) stopAudio(); setVoiceOn((v) => !v); }}
              className={`rounded p-1.5 hover:bg-accent ${voiceOn ? "text-primary" : "text-muted-foreground"}`}
              title={voiceOn ? "Voz ligada — clique para desligar" : "Voz desligada — clique para ligar"}
            >
              {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            {messages.length > 0 && (
              <button onClick={clearChat} className="rounded p-1 text-xs text-muted-foreground hover:bg-accent" title="Limpar conversa">
                Limpar
              </button>
            )}
            <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent" title="Minimizar">
              <Minimize2 className="h-4 w-4" />
            </button>
            <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent sm:hidden" title="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="flex justify-center py-2">
                <AgentAvatar size={80} speaking={false} />
              </div>
              <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                <div className="font-medium mb-1">👋 Oi! Eu sou o ELITE Agent.</div>
                <div className="text-muted-foreground text-xs">
                  Eu monitoro sua fila em tempo real: reagendo posts que falharam, respeito o limite de 1 reel a cada 20 min por conta, e paro contas com rate limit sozinho. Me pergunta qualquer coisa. {!voiceOn && "Clique 🔊 pra eu falar."}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left rounded-lg border border-border bg-background px-3 py-2 text-xs hover:bg-accent transition-colors"
                  >
                    💬 {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start gap-2"}`}>
              {m.role === "assistant" && <AgentAvatar size={28} />}
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {ask.isPending && (
            <div className="flex justify-start gap-2">
              <AgentAvatar size={28} speaking />
              <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-muted-foreground text-xs">Analisando a fila…</span>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border p-2 bg-background/50">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              rows={1}
              placeholder="Pergunte ou peça pra ajeitar a fila…"
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-32"
            />
            <button
              onClick={() => send()}
              disabled={ask.isPending || !input.trim()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90"
              title="Enviar"
            >
              {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  const fab = !open && typeof document !== "undefined" ? createPortal(
    <button
      onClick={() => setOpen(true)}
      className="fixed bottom-4 right-4 z-[100] group inline-flex items-center gap-2 rounded-full bg-card border border-border pl-1.5 pr-3 py-1.5 shadow-2xl hover:scale-105 transition-transform"
      title="Falar com o ELITE Agent"
    >
      <AgentAvatar size={40} />
      <span className="hidden sm:inline text-sm font-semibold">ELITE Agent</span>
      {typeof badge === "number" && badge > 0 && (
        <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1">
          {badge}
        </span>
      )}
    </button>,
    document.body,
  ) : null;

  return <>{fab}{panel}</>;
}
