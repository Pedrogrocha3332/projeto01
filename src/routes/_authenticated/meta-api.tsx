import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMetaCredentials,
  saveMetaCredentials,
  testMetaCredentials,
  getTokenStatus,
  refreshLongLivedToken,
} from "@/lib/meta.functions";
import { PageHeader, PageBody } from "@/components/app/page";
import {
  CheckCircle2, XCircle, Loader2, Eye, EyeOff, KeyRound, ShieldCheck,
  AlertTriangle, Clock, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/meta-api")({
  component: MetaApiPage,
});

type Status =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; user?: { id: string; name?: string } }
  | { kind: "error"; field: string; message: string };

function MetaApiPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMetaCredentials);
  const testFn = useServerFn(testMetaCredentials);
  const saveFn = useServerFn(saveMetaCredentials);
  const statusFn = useServerFn(getTokenStatus);
  const refreshFn = useServerFn(refreshLongLivedToken);

  const { data, isLoading } = useQuery({ queryKey: ["meta-credentials"], queryFn: () => getFn() });
  const tokenStatus = useQuery({
    queryKey: ["meta-token-status"],
    queryFn: () => statusFn(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [token, setToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (data) {
      setAppId(data.app_id ?? "");
      // Secrets are never returned by the server. Leave empty so the user must
      // re-enter to update; placeholders below indicate they exist on the server.
      setAppSecret("");
      setToken("");
      if (data.last_test_status === "connected") setStatus({ kind: "ok" });
      else if (data.last_test_status === "error" && data.last_test_error)
        setStatus({ kind: "error", field: "general", message: data.last_test_error });
    }
  }, [data]);

  const hasSavedSecret = Boolean(data?.has_app_secret);
  const hasSavedToken = Boolean(data?.has_long_lived_token);
  const tokenLast4 = data?.token_last4 ?? null;

  const test = useMutation({
    mutationFn: async () => {
      setStatus({ kind: "testing" });
      return await testFn({ data: { app_id: appId, app_secret: appSecret, long_lived_token: token } });
    },
    onSuccess: (res) => {
      if (res.ok) {
        setStatus({ kind: "ok", user: res.user });
        toast.success(`Conectado como ${res.user?.name ?? res.user?.id}`);
      } else {
        setStatus({ kind: "error", field: res.field, message: res.message });
        toast.error(res.message);
      }
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      setStatus({ kind: "error", field: "general", message: msg });
      toast.error(msg);
    },
  });

  const save = useMutation({
    mutationFn: async () => await saveFn({ data: { app_id: appId, app_secret: appSecret, long_lived_token: token } }),
    onSuccess: (res) => {
      if (res.ok) {
        setStatus({ kind: "ok", user: res.user });
        toast.success("Credenciais salvas e validadas com sucesso");
        qc.invalidateQueries({ queryKey: ["meta-credentials"] });
        qc.invalidateQueries({ queryKey: ["meta-token-status"] });
      } else {
        setStatus({ kind: "error", field: res.field, message: res.message });
        toast.error(`Não foi possível salvar: ${res.message}`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  const refresh = useMutation({
    mutationFn: async () => await refreshFn(),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Token renovado com sucesso");
        qc.invalidateQueries({ queryKey: ["meta-credentials"] });
        qc.invalidateQueries({ queryKey: ["meta-token-status"] });
      } else {
        toast.error(res.message);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao renovar"),
  });

  const fieldError = (name: string) =>
    status.kind === "error" && (status.field === name || status.field === "general") ? status.message : null;

  return (
    <div>
      <PageHeader
        title="Meta API"
        description="Credenciais oficiais da Meta Graph API usadas em todas as publicações do Instagram."
      />
      <PageBody>
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="card-elevated p-5 space-y-5">
            <div className="flex items-center gap-2 text-sm">
              <KeyRound className="h-4 w-4 text-primary" />
              <span className="font-display font-semibold">Credenciais do App</span>
            </div>

            <Field
              label="Meta App ID"
              value={appId}
              onChange={setAppId}
              placeholder="1234567890"
              error={fieldError("app_id")}
            />
            <Field
              label="Meta App Secret"
              value={appSecret}
              onChange={setAppSecret}
              type={showSecret ? "text" : "password"}
              placeholder={hasSavedSecret ? "•••••••• (salvo — digite para atualizar)" : "••••••••"}
              trailing={
                <button onClick={() => setShowSecret((v) => !v)} className="text-muted-foreground hover:text-foreground p-1" aria-label="Mostrar/ocultar">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
              error={fieldError("app_secret")}
              hint={hasSavedSecret ? "Um App Secret já está armazenado com segurança no backend. Deixe em branco para manter o atual." : undefined}
            />
            <Field
              label="Long-Lived Access Token"
              value={token}
              onChange={setToken}
              type={showToken ? "text" : "password"}
              placeholder={hasSavedToken ? `•••• ${tokenLast4 ?? ""} (salvo — digite para atualizar)` : "EAAG..."}
              multiline
              trailing={
                <button onClick={() => setShowToken((v) => !v)} className="text-muted-foreground hover:text-foreground p-1" aria-label="Mostrar/ocultar">
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
              error={fieldError("long_lived_token")}
              hint={hasSavedToken ? "Token salvo com segurança no backend. Use “Renovar Token” para prorrogar sem re-digitar, ou cole um novo aqui para substituir." : "Token de longa duração (~60 dias). Utilize o botão “Renovar Token” antes de expirar."}
            />

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => test.mutate()}
                disabled={test.isPending || !appId || !appSecret || !token}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Testar conexão
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending || !appId || !appSecret || !token}
                className="inline-flex items-center gap-2 rounded-lg ig-gradient px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Salvar
              </button>
              <button
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-primary/40 text-primary px-4 py-2 text-sm font-semibold hover:bg-primary/10 disabled:opacity-50"
              >
                {refresh.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Renovar Token
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <StatusCard status={status} loading={isLoading} lastTestedAt={data?.last_tested_at ?? null} />
            <TokenCountdown query={tokenStatus} lastUpdated={data?.updated_at ?? null} />
            <div className="card-elevated p-4 text-xs text-muted-foreground space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <p>
                  As credenciais são armazenadas criptografadas no backend e nunca são expostas
                  ao navegador. Todas as chamadas à Meta Graph API passam por funções seguras no servidor.
                </p>
              </div>
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, error, trailing, hint, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
  placeholder?: string; error?: string | null; trailing?: React.ReactNode; hint?: string; multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className={`mt-1 flex items-start gap-1 rounded-lg border bg-background px-3 py-2 ${error ? "border-destructive" : "border-input"}`}>
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="flex-1 bg-transparent text-sm outline-none resize-none font-mono"
            style={type === "password" ? { WebkitTextSecurity: "disc" } as React.CSSProperties : undefined}
          />
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        )}
        {trailing}
      </div>
      {hint && !error && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function StatusCard({ status, loading, lastTestedAt }: { status: Status; loading: boolean; lastTestedAt: string | null }) {
  let label = "Não configurado";
  let sub = "Preencha e teste as credenciais.";
  let tone = "bg-muted text-muted-foreground";
  let icon = <XCircle className="h-5 w-5" />;

  if (loading) { label = "Carregando…"; icon = <Loader2 className="h-5 w-5 animate-spin" />; }
  else if (status.kind === "testing") { label = "Testando…"; icon = <Loader2 className="h-5 w-5 animate-spin" />; tone = "bg-primary/10 text-primary"; }
  else if (status.kind === "ok") {
    label = "Conectado";
    sub = status.user ? `Autenticado como ${status.user.name ?? status.user.id}` : "Credenciais válidas.";
    tone = "bg-success/15 text-success";
    icon = <CheckCircle2 className="h-5 w-5" />;
  } else if (status.kind === "error") {
    label = "Erro";
    sub = status.message;
    tone = "bg-destructive/15 text-destructive";
    icon = <XCircle className="h-5 w-5" />;
  }

  return (
    <div className="card-elevated p-4">
      <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
        {icon}
        <span>Status: {label}</span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{sub}</p>
      {lastTestedAt && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Último teste: {formatDistanceToNow(new Date(lastTestedAt), { addSuffix: true, locale: ptBR })}
        </p>
      )}
    </div>
  );
}

function TokenCountdown({
  query,
  lastUpdated,
}: {
  query: ReturnType<typeof useQuery<Awaited<ReturnType<typeof getTokenStatus>>>>;
  lastUpdated: string | null;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const data = query.data;
  const now = Math.floor(Date.now() / 1000);

  let content: React.ReactNode;
  if (query.isLoading) {
    content = <div className="h-16 rounded-lg shimmer" />;
  } else if (!data || !data.connected) {
    content = (
      <div className="text-sm text-muted-foreground">
        {data && "message" in data ? data.message : "Sem dados do token no momento."}
      </div>
    );
  } else if (data.expires_at === null) {
    content = <div className="text-sm text-success">Token permanente — sem expiração.</div>;
  } else if (data.expires_at === undefined) {
    content = <div className="text-sm text-muted-foreground">Data de expiração não informada pela Meta.</div>;
  } else {
    const remaining = data.expires_at - now;
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    const secs = Math.max(0, remaining % 60);
    let tone = "text-success";
    let alert: React.ReactNode = null;
    if (remaining <= 0) {
      tone = "text-destructive";
      alert = <p className="mt-1 text-xs text-destructive font-medium">Token expirado. Renove imediatamente.</p>;
    } else if (days <= 1) {
      tone = "text-destructive";
      alert = <p className="mt-1 text-xs text-destructive">Faltando menos de 1 dia — renove agora.</p>;
    } else if (days <= 3) {
      tone = "text-warning";
      alert = <p className="mt-1 text-xs text-warning">Faltando ≤ 3 dias — planeje a renovação.</p>;
    } else if (days <= 7) {
      tone = "text-warning";
      alert = <p className="mt-1 text-xs text-warning">Faltando ≤ 7 dias.</p>;
    } else if (days <= 15) {
      tone = "text-primary";
      alert = <p className="mt-1 text-xs text-muted-foreground">Faltando ≤ 15 dias.</p>;
    }
    content = (
      <div>
        <div className={`font-mono tabular-nums text-2xl font-bold ${tone}`}>
          {remaining <= 0
            ? "00d 00h 00m 00s"
            : `${String(days).padStart(2, "0")}d ${String(hours).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Expira em {new Date(data.expires_at * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
        </div>
        {alert}
      </div>
    );
  }

  return (
    <div className="card-elevated p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Clock className="h-3.5 w-3.5" /> Contagem regressiva do token
      </div>
      <div className="mt-2">{content}</div>
      {lastUpdated && (
        <div className="mt-3 text-[11px] text-muted-foreground">
          Última atualização das credenciais: {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true, locale: ptBR })}
        </div>
      )}
    </div>
  );
}
