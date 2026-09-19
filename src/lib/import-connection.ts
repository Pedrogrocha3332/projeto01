import { panelOrigin } from "@/lib/import-plan";
import type { ImportDestination, ImportFolder, ImportResult } from "@/lib/import-upload";
export const IMPORT_CHANNEL = "elite-library-import-v1";
export function validImportMessage(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  origin: string,
  source: Window | null,
  nonce: string,
) {
  return (
    !!source &&
    event.source === source &&
    event.origin === origin &&
    event.data?.channel === IMPORT_CHANNEL &&
    event.data?.nonce === nonce
  );
}
export class ImportConnection {
  private popup: Window | null = null;
  private origin = "";
  private nonce = "";
  private ready = false;
  private name = `library-import-${crypto.randomUUID()}`;
  private pending = new Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (error: Error) => void;
      phase?: (phase: string) => void;
    }
  >();
  private listener = (event: MessageEvent) => {
    if (!validImportMessage(event, this.origin, this.popup, this.nonce)) return;
    const item = this.pending.get(event.data.id);
    if (!item) return;
    if (event.data.type === "progress") {
      item.phase?.(String(event.data.phase));
      return;
    }
    if (event.data.type !== "result") return;
    event.data.error
      ? item.reject(new Error(String(event.data.error)))
      : item.resolve(event.data.result);
  };
  constructor() {
    window.addEventListener("message", this.listener);
  }
  reserve() {
    if (this.popup && !this.popup.closed) return;
    this.popup = window.open("about:blank", this.name, "popup,width=800,height=720");
    this.ready = false;
    if (!this.popup)
      throw new Error("Permita abrir janelas para conectar os painéis e tente novamente.");
  }
  private wait<T>(id: string, ms: number, phase?: (phase: string) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, result?: T) => {
        clearTimeout(timer);
        clearInterval(closed);
        this.pending.delete(id);
        error ? reject(error) : resolve(result!);
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "O painel não respondeu. Confira a janela auxiliar, o login e o deploy; depois reconecte.",
            ),
          ),
        ms,
      );
      const closed = setInterval(() => {
        if (!this.popup || this.popup.closed) {
          this.ready = false;
          finish(new Error("A janela auxiliar foi fechada. Reconecte o painel."));
        }
      }, 1000);
      this.pending.set(id, {
        resolve: (result) => finish(undefined, result),
        reject: (error) => finish(error),
        phase,
      });
    });
  }
  async connect(value: string): Promise<ImportFolder[]> {
    const origin = panelOrigin(value);
    if (!this.popup || this.popup.closed)
      throw new Error("Clique em Conectar para abrir a janela auxiliar.");
    if (this.ready && this.origin === origin) return this.request("folders", {});
    this.origin = origin;
    this.nonce = crypto.randomUUID();
    this.ready = false;
    const response = this.wait<ImportFolder[]>("ready", 5 * 60 * 1000);
    const url = new URL("/import-receiver", origin);
    url.searchParams.set("central", window.location.origin);
    url.searchParams.set("nonce", this.nonce);
    this.popup.location.href = url.href;
    const folders = await response;
    this.ready = true;
    return folders;
  }
  private request<T>(type: string, payload: object, phase?: (phase: string) => void): Promise<T> {
    if (!this.ready || !this.popup || this.popup.closed)
      return Promise.reject(new Error("Reconecte o painel de destino."));
    const id = crypto.randomUUID();
    const response = this.wait<T>(id, type === "upload" ? 30 * 60 * 1000 : 60000, phase);
    this.popup.postMessage(
      { channel: IMPORT_CHANNEL, nonce: this.nonce, id, type, ...payload },
      this.origin,
    );
    return response;
  }
  upload(file: File, destination: ImportDestination, phase: (value: string) => void) {
    return this.request<ImportResult>("upload", { file, destination }, phase);
  }
  dispose() {
    window.removeEventListener("message", this.listener);
    for (const item of [...this.pending.values()]) item.reject(new Error("Central encerrada."));
  }
}
