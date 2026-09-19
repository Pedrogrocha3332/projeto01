import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, PageBody } from "@/components/app/page";
import { groupImportFiles, panelOrigin } from "@/lib/import-plan";
import { ImportConnection } from "@/lib/import-connection";
import {
  importFolders,
  uploadImportedVideo,
  type ImportFolder,
  type ImportDestination,
} from "@/lib/import-upload";

export const Route = createFileRoute("/_authenticated/import-center")({ component: ImportCenter });
type Panel = { origin: string; name: string; folders: ImportFolder[] };
type Mapping = { origin: string; folder: ImportDestination };
type Item = {
  id: number;
  group: string;
  file: File;
  state: "pending" | "sending" | "done" | "duplicate" | "error";
  detail: string;
};
const button = "rounded-lg border border-input px-3 py-2 text-sm disabled:opacity-50";
const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
function ImportCenter() {
  const { user } = Route.useRouteContext();
  const origin = window.location.origin;
  const key = `library-import-config-v1:${user.id}`;
  const qc = useQueryClient();
  const [panels, setPanels] = useState<Panel[]>([{ origin, name: "Este painel", folders: [] }]);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [loaded, setLoaded] = useState(false),
    [panelName, setPanelName] = useState(""),
    [panelUrl, setPanelUrl] = useState("");
  const [items, setItems] = useState<Item[]>([]),
    [busy, setBusy] = useState(false),
    [connecting, setConnecting] = useState(false),
    [locked, setLocked] = useState(false),
    [status, setStatus] = useState("");
  const pause = useRef(false),
    running = useRef(false),
    connection = useRef<ImportConnection | null>(null),
    picker = useRef<HTMLInputElement>(null);
  useBlocker({
    shouldBlockFn: () =>
      running.current &&
      !window.confirm(
        "Há vídeos sendo enviados. Sair agora interrompe o acompanhamento. Deseja sair?",
      ),
    enableBeforeUnload: () => running.current,
  });
  const groups = groupImportFiles(items.map((item) => item.file));
  const completed = items.filter(
    (item) => item.state === "done" || item.state === "duplicate",
  ).length;
  const failed = items.filter((item) => item.state === "error").length;
  const pending = items.filter((item) => item.state === "pending").length;
  useEffect(() => {
    connection.current = new ImportConnection();
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      if (Array.isArray(saved.panels)) {
        const valid = saved.panels.filter((p: Panel) => {
          try {
            return (
              typeof p.name === "string" &&
              panelOrigin(p.origin) === p.origin &&
              Array.isArray(p.folders)
            );
          } catch {
            return false;
          }
        });
        setPanels([
          { origin, name: "Este painel", folders: [] },
          ...valid.filter((p: Panel) => p.origin !== origin),
        ]);
      }
      if (saved.mappings && typeof saved.mappings === "object") setMappings(saved.mappings);
    } catch {
      /* start with this panel if browser settings are unavailable */
    }
    setLoaded(true);
    importFolders()
      .then((folders) =>
        setPanels((old) => old.map((p) => (p.origin === origin ? { ...p, folders } : p))),
      )
      .catch((error) => setStatus(error.message));
    return () => {
      pause.current = true;
      connection.current?.dispose();
    };
  }, [key, origin]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(key, JSON.stringify({ panels, mappings }));
      } catch {
        /* still usable without saved preferences */
      }
  }, [loaded, panels, mappings, key]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (running.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function mapping(group: { key: string; name: string }): Mapping {
    const saved = mappings[group.key];
    return saved && panels.some((p) => p.origin === saved.origin) && saved.folder?.name
      ? saved
      : { origin, folder: { name: group.name } };
  }
  function remember(group: string, value: Mapping) {
    setMappings((old) => ({ ...old, [group]: value }));
  }
  function selectFiles(files: FileList | null) {
    if (!files) return;
    const grouped = groupImportFiles(Array.from(files));
    let index = 0;
    setItems(
      grouped.flatMap((group) =>
        group.files.map((file) => ({
          id: index++,
          group: group.key,
          file,
          state: "pending" as const,
          detail: "Aguardando envio",
        })),
      ),
    );
    setLocked(false);
    const accepted = grouped.reduce((sum, g) => sum + g.files.length, 0);
    setStatus(
      `${accepted} vídeos encontrados em ${grouped.length} pastas. ${files.length - accepted} arquivos não compatíveis ou vazios ignorados.`,
    );
  }
  async function connect(panel: Panel) {
    if (connecting || running.current) return;
    try {
      if (panel.origin !== origin) connection.current!.reserve();
      setConnecting(true);
      setStatus(
        `Conectando ${panel.name}. Confira a janela auxiliar e entre no painel se necessário.`,
      );
      const folders =
        panel.origin === origin
          ? await importFolders()
          : await connection.current!.connect(panel.origin);
      setPanels((old) => [...old.filter((p) => p.origin !== panel.origin), { ...panel, folders }]);
      setStatus(`${panel.name} conectado: ${folders.length} pastas disponíveis.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha na conexão");
    } finally {
      setConnecting(false);
    }
  }
  function addPanel() {
    try {
      const remote = panelOrigin(panelUrl);
      if (!panelName.trim()) throw new Error("Dê um nome ao painel.");
      const panel = {
        origin: remote,
        name: remote === origin ? "Este painel" : panelName.trim(),
        folders: panels.find((p) => p.origin === remote)?.folders || [],
      };
      setPanels((old) => [...old.filter((p) => p.origin !== remote), panel]);
      setPanelName("");
      setPanelUrl("");
      void connect(panel);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "URL inválida");
    }
  }
  function update(id: number, state: Item["state"], detail: string) {
    setItems((old) => old.map((item) => (item.id === id ? { ...item, state, detail } : item)));
  }
  async function send(retry = false) {
    if (running.current || connecting) return;
    const work = items.filter((item) => item.state === (retry ? "error" : "pending"));
    if (!work.length) return;
    const plan = new Map(groups.map((group) => [group.key, mapping(group)]));
    if ([...plan.values()].some((p) => !p.folder.name.trim() || p.folder.name.length > 100)) {
      toast.error("Preencha o nome das pastas (até 100 caracteres).");
      return;
    }
    // Reserve one window in the click event, before any asynchronous operation.
    try {
      if (work.some((item) => plan.get(item.group)!.origin !== origin))
        connection.current!.reserve();
    } catch (error) {
      setStatus((error as Error).message);
      return;
    }
    pause.current = false;
    running.current = true;
    setBusy(true);
    setLocked(true);
    try {
      let previous = "",
        connectionError = "";
      for (const item of work) {
        if (pause.current) break;
        const target = plan.get(item.group)!;
        const label = panels.find((p) => p.origin === target.origin)?.name || target.origin;
        if (previous !== target.origin) {
          previous = target.origin;
          connectionError = "";
          setStatus(`Preparando ${label}. Mantenha a janela auxiliar aberta.`);
          try {
            const folders =
              target.origin === origin
                ? await importFolders()
                : await connection.current!.connect(target.origin);
            setPanels((old) =>
              old.map((p) => (p.origin === target.origin ? { ...p, folders } : p)),
            );
          } catch (error) {
            connectionError = error instanceof Error ? error.message : "Falha ao conectar";
          }
        }
        if (pause.current) break;
        if (connectionError) {
          update(item.id, "error", connectionError);
          continue;
        }
        update(item.id, "sending", `Preparando ${label}`);
        setStatus(`${label} → ${target.folder.name}: ${item.file.name}`);
        try {
          const progress = (phase: string) => update(item.id, "sending", phase);
          const result =
            target.origin === origin
              ? await uploadImportedVideo(item.file, target.folder, progress)
              : await connection.current!.upload(item.file, target.folder, progress);
          update(
            item.id,
            result.duplicate ? "duplicate" : "done",
            result.duplicate
              ? "Já importado nesta pasta pela central"
              : result.warning
                ? `Enviado. ${result.warning}`
                : "Enviado",
          );
        } catch (error) {
          update(item.id, "error", error instanceof Error ? error.message : "Falha no envio");
        }
      }
      setStatus(
        pause.current
          ? "Envio pausado. Você pode continuar de onde parou."
          : "Processamento encerrado. Confira o resultado de cada arquivo abaixo.",
      );
    } finally {
      running.current = false;
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["media-library"] });
      qc.invalidateQueries({ queryKey: ["media-videos-selectable"] });
      qc.invalidateQueries({ queryKey: ["video-folders"] });
    }
  }
  return (
    <>
      <PageHeader
        title="Central de envio"
        description="Distribua os vídeos baixados entre seus painéis e pastas."
      />
      <PageBody>
        <div className="mx-auto max-w-5xl space-y-6 pb-10">
          <p className="rounded-xl border p-4 text-sm text-muted-foreground">
            Baixe pela extensão, mantendo os perfis separados em subpastas. Selecione a pasta
            principal aqui, confira os destinos e envie tudo. Os vídeos entram somente na
            biblioteca.
          </p>
          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="font-display text-xl">1. Painéis de destino</h2>
            <p className="text-sm text-muted-foreground">
              Cadastre cada painel uma vez neste navegador. Todos precisam desta atualização e do
              SQL de pastas. Conecte usando o login normal na janela auxiliar.
            </p>
            <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <input
                aria-label="Nome do painel"
                className={input}
                placeholder="Painel 2"
                value={panelName}
                disabled={busy || connecting || locked}
                onChange={(e) => setPanelName(e.target.value)}
              />
              <input
                aria-label="URL do painel"
                className={input}
                placeholder="https://seu-painel.vercel.app"
                value={panelUrl}
                disabled={busy || connecting || locked}
                onChange={(e) => setPanelUrl(e.target.value)}
              />
              <button
                className={button}
                disabled={busy || connecting || locked || !loaded}
                onClick={addPanel}
              >
                Adicionar e conectar
              </button>
            </div>
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {panels.map((panel) => (
                <div
                  key={panel.origin}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p>{panel.name}</p>
                    <p className="break-all text-xs text-muted-foreground">{panel.origin}</p>
                  </div>
                  <button
                    className={button}
                    disabled={busy || connecting}
                    onClick={() => void connect(panel)}
                  >
                    Conectar / atualizar pastas
                  </button>
                  {panel.origin !== origin && (
                    <button
                      aria-label={`Remover ${panel.name}`}
                      className={button}
                      disabled={busy || connecting || locked}
                      onClick={() =>
                        setPanels((old) => old.filter((p) => p.origin !== panel.origin))
                      }
                    >
                      Remover
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="font-display text-xl">2. Selecionar pasta de vídeos</h2>
            <input
              ref={picker}
              type="file"
              className="hidden"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => selectFiles(e.target.files)}
            />
            <button
              className={button}
              disabled={busy || connecting || !loaded}
              onClick={() => {
                if (picker.current) {
                  picker.current.value = "";
                  picker.current.click();
                }
              }}
            >
              {items.length ? "Selecionar pasta / novo envio" : "Selecionar pasta principal"}
            </button>
            <p className="text-sm text-muted-foreground">
              MP4, MOV, M4V e WebM. Fotos e arquivos de legenda são ignorados. A divisão respeita as
              subpastas, sem separar automaticamente a cada 15 vídeos.
            </p>
          </section>
          {!!groups.length && (
            <section className="space-y-4 rounded-xl border p-4">
              <h2 className="font-display text-xl">3. Conferir destinos</h2>
              <p className="text-sm text-muted-foreground">
                Cada pasta local vai para um destino. A opção “Criar / usar pelo nome” reutiliza uma
                pasta com esse nome, se existir.
              </p>
              {groups.map((group) => {
                const target = mapping(group);
                const panel = panels.find((p) => p.origin === target.origin)!;
                return (
                  <div
                    key={group.key}
                    className="grid items-start gap-3 rounded-lg border p-3 md:grid-cols-3"
                  >
                    <div>
                      <strong className="break-all">{group.name}</strong>
                      <p className="break-all text-xs text-muted-foreground">{group.key}</p>
                      <p className="text-sm">
                        {group.files.length} vídeos ·{" "}
                        {(group.files.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <label className="space-y-1 text-sm">
                      Painel
                      <select
                        className={input}
                        disabled={busy || locked || connecting}
                        value={target.origin}
                        onChange={(e) =>
                          remember(group.key, {
                            origin: e.target.value,
                            folder: { name: group.name },
                          })
                        }
                      >
                        {panels.map((p) => (
                          <option key={p.origin} value={p.origin}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="space-y-2">
                      <label className="space-y-1 text-sm">
                        Pasta no painel
                        <select
                          className={input}
                          disabled={busy || locked || connecting}
                          value={target.folder.id || "new"}
                          onChange={(e) =>
                            remember(group.key, {
                              ...target,
                              folder:
                                e.target.value === "new"
                                  ? { name: group.name }
                                  : panel.folders.find((f) => f.id === e.target.value)!,
                            })
                          }
                        >
                          <option value="new">Criar / usar pelo nome</option>
                          {target.folder.id &&
                            !panel.folders.some((f) => f.id === target.folder.id) && (
                              <option value={target.folder.id}>
                                {target.folder.name} (reconecte para conferir)
                              </option>
                            )}
                          {panel.folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!target.folder.id && (
                        <input
                          aria-label={`Nome da pasta para ${group.name}`}
                          className={input}
                          maxLength={100}
                          disabled={busy || locked || connecting}
                          value={target.folder.name}
                          onChange={(e) =>
                            remember(group.key, { ...target, folder: { name: e.target.value } })
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50"
                disabled={busy || connecting || !pending}
                onClick={() => void send()}
              >
                {locked ? `Continuar (${pending})` : `Enviar tudo (${items.length})`}
              </button>
              {!!failed && (
                <button
                  className={button}
                  disabled={busy || connecting}
                  onClick={() => void send(true)}
                >
                  Tentar novamente as {failed} falhas
                </button>
              )}
              {busy && (
                <button
                  className={button}
                  onClick={() => {
                    pause.current = true;
                    setStatus("Pausando após terminar o arquivo atual…");
                  }}
                >
                  Pausar após este arquivo
                </button>
              )}
              <span className="text-sm">
                {completed}/{items.length} concluídos · {failed} falhas
              </span>
            </div>
            <progress
              aria-label="Progresso do envio"
              className="w-full accent-yellow-500"
              max={Math.max(items.length, 1)}
              value={completed}
            />
            <p role="status" className="break-words text-sm">
              {status}
            </p>
            <p className="text-xs text-muted-foreground">
              Mantenha a central e a janela auxiliar abertas. Para retomar após fechar a página,
              selecione os arquivos novamente: vídeos já importados pela central na mesma pasta não
              serão duplicados.
            </p>
            {!!items.length && (
              <div className="max-h-96 overflow-y-auto divide-y">
                {items.map((item) => (
                  <div key={item.id} className="py-2 text-sm">
                    <p className="break-all">{item.file.webkitRelativePath || item.file.name}</p>
                    <p
                      className={
                        item.state === "error"
                          ? "text-destructive"
                          : item.state === "done" || item.state === "duplicate"
                            ? "text-green-500"
                            : "text-muted-foreground"
                      }
                    >
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </PageBody>
    </>
  );
}
