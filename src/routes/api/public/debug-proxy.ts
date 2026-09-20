import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/debug-proxy")({
  server: {
    handlers: {
      GET: async () => {
        const { ProxyAgent, fetch: undiciFetch } = await import("undici");

        let rawProxy = process.env.PROXY_URL?.trim() || "";
        let normalizedProxy = rawProxy;
        if (rawProxy && !rawProxy.startsWith("http://") && !rawProxy.startsWith("https://")) {
          const parts = rawProxy.split(":");
          if (parts.length === 4) {
            normalizedProxy = `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
          } else {
            normalizedProxy = `http://${rawProxy}`;
          }
        }

        const masked = rawProxy.replace(/:[^:@]+@/, ":***@");

        const results: Record<string, any> = {
          rawProxyConfigured: !!rawProxy,
          rawPreview: masked.slice(0, 30) + "...",
          normalizedPreview: normalizedProxy.replace(/:[^:@]+@/, ":***@").slice(0, 35) + "...",
        };

        // Test 1: Direct fetch to Instagram without proxy
        try {
          const t0 = Date.now();
          const r1 = await fetch("https://graph.instagram.com/v21.0/me?access_token=test", {
            headers: { "user-agent": "Mozilla/5.0" }
          });
          results.direct = { ok: true, status: r1.status, ms: Date.now() - t0 };
        } catch (e: any) {
          results.direct = { ok: false, error: e.message, cause: e.cause?.message || e.cause?.code || String(e.cause) };
        }

        // Test 2: Fetch through ProxyAgent (default)
        if (normalizedProxy) {
          try {
            const t0 = Date.now();
            const agent = new ProxyAgent({
              uri: normalizedProxy,
              requestTls: {
                ALPNProtocols: ["h2", "http/1.1"],
                servername: "graph.instagram.com"
              }
            });
            const r2 = await undiciFetch("https://graph.instagram.com/v21.0/me?access_token=test", {
              dispatcher: agent,
              headers: { "user-agent": "Mozilla/5.0" }
            });
            results.proxyWithTls = { ok: true, status: r2.status, ms: Date.now() - t0 };
          } catch (e: any) {
            results.proxyWithTls = { ok: false, error: e.message, cause: e.cause?.message || e.cause?.code || String(e.cause) };
          }

          // Test 3: Fetch through ProxyAgent WITHOUT requestTls
          try {
            const t0 = Date.now();
            const agent2 = new ProxyAgent({
              uri: normalizedProxy
            });
            const r3 = await undiciFetch("https://graph.instagram.com/v21.0/me?access_token=test", {
              dispatcher: agent2,
              headers: { "user-agent": "Mozilla/5.0" }
            });
            results.proxyPlain = { ok: true, status: r3.status, ms: Date.now() - t0 };
          } catch (e: any) {
            results.proxyPlain = { ok: false, error: e.message, cause: e.cause?.message || e.cause?.code || String(e.cause) };
          }
        }

        return Response.json(results);
      }
    }
  }
});
