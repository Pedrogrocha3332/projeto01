import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { importFolders, uploadImportedVideo } from "@/lib/import-upload";
import { IMPORT_CHANNEL, validImportMessage } from "@/lib/import-connection";
import { panelOrigin } from "@/lib/import-plan";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/import-receiver")({
  component: Receiver,
  validateSearch: (search: Record<string, unknown>) => ({
    central: typeof search.central === "string" ? search.central : "",
    nonce: typeof search.nonce === "string" ? search.nonce : "",
  }),
});
function Receiver() {
  const { central, nonce } = Route.useSearch();
  const [allowed, setAllowed] = useState(false),
    [status, setStatus] = useState("Confira o endereço da central antes de conectar."),
    [user, setUser] = useState("");
  const busy = useRef(false);
  const opener = useRef(window.opener as Window | null);
  let origin = "";
  try {
    origin = panelOrigin(central);
  } catch {
    /* invalid request is shown below */
  }
  const key = `library-import-trust:${user}`;
  useEffect(() => {
    let live = true;
    supabase.auth.getUser().then(({ data }) => {
      if (live) setUser(data.user?.id ?? "");
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!user || !origin || !nonce || !opener.current) return;
    try {
      if ((JSON.parse(localStorage.getItem(key) || "[]") as string[]).includes(origin))
        setAllowed(true);
    } catch {
      /* request consent again */
    }
  }, [user, origin, nonce, key]);
  useEffect(() => {
    if (!allowed || !user || !origin || !nonce || !opener.current) return;
    let live = true;
    const send = (id: string, result?: unknown, error?: string) =>
      opener.current?.postMessage(
        { channel: IMPORT_CHANNEL, nonce, id, type: "result", result, error },
        origin,
      );
    const listener = async (event: MessageEvent) => {
      if (
        !validImportMessage(event, origin, opener.current, nonce) ||
        typeof event.data.id !== "string"
      )
        return;
      const { id, type, file, destination } = event.data;
      if (type !== "folders" && type !== "upload") return;
      if (busy.current) {
        send(
          id,
          undefined,
          "Este painel ainda está recebendo um arquivo. Aguarde e tente novamente.",
        );
        return;
      }
      busy.current = true;
      try {
        // If the user changes account in another tab, reconnect rather than importing under a different identity.
        const auth = await supabase.auth.getUser();
        if (auth.data.user?.id !== user) throw new Error("O login mudou. Reconecte o painel.");
        if (type === "folders") {
          send(id, await importFolders());
          return;
        }
        setStatus(`Recebendo: ${file?.name || "vídeo"}`);
        const result = await uploadImportedVideo(file, destination, (phase) => {
          setStatus(`${phase}: ${file.name}`);
          opener.current?.postMessage(
            { channel: IMPORT_CHANNEL, nonce, id, type: "progress", phase },
            origin,
          );
        });
        send(id, result);
        setStatus(
          result.duplicate
            ? "Vídeo já importado. Aguardando o próximo."
            : "Vídeo salvo na biblioteca. Aguardando o próximo.",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha no envio";
        send(id, undefined, message);
        setStatus(message);
      } finally {
        busy.current = false;
      }
    };
    window.addEventListener("message", listener);
    importFolders().then(
      (folders) => {
        if (live) {
          send("ready", folders);
          setStatus("Conectado. Volte à central para escolher os destinos e enviar.");
        }
      },
      (error) => {
        if (live) {
          send("ready", undefined, error.message);
          setStatus(error.message);
        }
      },
    );
    return () => {
      live = false;
      window.removeEventListener("message", listener);
    };
  }, [allowed, user, origin, nonce]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function approve() {
    try {
      const old = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(
        key,
        JSON.stringify([...new Set([...(Array.isArray(old) ? old : []), origin])]),
      );
    } catch {
      /* this connection still works without persistence */
    }
    setAllowed(true);
  }
  return (
    <div className="mx-auto max-w-xl space-y-5 p-6">
      <h1 className="font-display text-2xl">Receber vídeos da central</h1>
      <p className="break-all">
        Painel de destino: <strong>{window.location.origin}</strong>
      </p>
      {!origin || !nonce || !opener.current ? (
        <p role="alert">Abra esta janela pelo botão Conectar da Central de envio.</p>
      ) : (
        <>
          <p className="break-all">
            Central solicitante: <strong>{origin}</strong>
          </p>
          <p>
            Ao conectar, esta central poderá consultar suas pastas, criar pastas e adicionar vídeos
            à sua biblioteca usando seu login neste painel. Senhas e tokens não são enviados à
            central.
          </p>
          {!allowed ? (
            <button
              disabled={!user}
              onClick={approve}
              className="rounded-lg bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50"
            >
              Conectar esta central
            </button>
          ) : (
            <button
              disabled={busy.current}
              className="rounded border px-3 py-2 disabled:opacity-50"
              onClick={() => {
                try {
                  const saved = JSON.parse(localStorage.getItem(key) || "[]");
                  localStorage.setItem(
                    key,
                    JSON.stringify(saved.filter((value: string) => value !== origin)),
                  );
                } catch {}
                setAllowed(false);
                setStatus("Conexão removida.");
              }}
            >
              Desconectar esta central
            </button>
          )}
          <p role="status" className="rounded-xl border p-4">
            {status}
          </p>
          <p className="text-sm text-muted-foreground">
            Mantenha esta janela e a central abertas durante o envio. Nenhuma publicação é iniciada
            aqui.
          </p>
        </>
      )}
    </div>
  );
}
