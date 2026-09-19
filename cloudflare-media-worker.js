/**
 * CLOUDFLARE WORKER: ZERO-SIGNAL MEDIA ORIGIN CLOAKING ENGINE
 * 
 * Finalidade: Mascarar o download dos vídeos do Supabase Storage para o robô da Meta (FacebookExternalHit).
 * Remove qualquer cabeçalho de AWS/Supabase e entrega o vídeo como uma CDN profissional Cloudflare.
 * Suporta requisições HTTP 206 (Range Requests) necessárias para streaming de vídeo no Instagram Reels.
 * 
 * Como usar:
 * 1. Acesse https://dash.cloudflare.com -> Workers & Pages -> Create Application -> Create Worker
 * 2. Cole este código no editor do Worker e salve (Deploy).
 * 3. Configure uma rota com seu domínio próprio (ex: cdn.seudominio.com/*) ou use o subdomínio .workers.dev
 * 4. Configure a variável SUPABASE_ORIGIN_HOST com o seu domínio Supabase (ex: abcdefgh.supabase.co)
 * 5. Na Vercel, defina a variável MEDIA_CDN_URL = https://cdn.seudominio.com (ou a URL do seu Worker)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Se bater na raiz, retorna status OK de CDN
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("CDN Edge Active // Status: Ready", {
        status: 200,
        headers: { "Content-Type": "text/plain", "Server": "cloudflare" }
      });
    }

    // Host de origem do Supabase (configurável via env ou fallback)
    const supabaseHost = env?.SUPABASE_ORIGIN_HOST || "YOUR_SUPABASE_ID.supabase.co";

    // Reescreve a URL preservando o caminho assinado original (/storage/v1/object/sign/media/...)
    const targetUrl = new URL(request.url);
    targetUrl.protocol = "https:";
    targetUrl.host = supabaseHost;

    // Repassa Range Request para a origem para suportar 206 Partial Content (Essencial para Reels)
    const forwardHeaders = new Headers();
    forwardHeaders.set("User-Agent", request.headers.get("User-Agent") || "Mozilla/5.0 (CDN Edge Fetcher)");
    forwardHeaders.set("Accept", "*/*");
    
    const rangeHeader = request.headers.get("Range");
    if (rangeHeader) {
      forwardHeaders.set("Range", rangeHeader);
    }

    let originResponse;
    try {
      originResponse = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
        redirect: "follow",
      });
    } catch (err) {
      return new Response("Origin Gateway Error", { status: 502 });
    }

    if (!originResponse.ok && originResponse.status !== 206) {
      return new Response(`Origin error: HTTP ${originResponse.status}`, { status: originResponse.status });
    }

    // Cria os cabeçalhos limpos sem nenhuma assinatura de Nuvem/AWS/Supabase
    const cleanHeaders = new Headers();

    // Headers permitidos/obrigatórios
    cleanHeaders.set("Content-Type", originResponse.headers.get("Content-Type") || "video/mp4");
    cleanHeaders.set("Server", "cloudflare");
    cleanHeaders.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    cleanHeaders.set("Access-Control-Allow-Origin", "*");
    cleanHeaders.set("Accept-Ranges", "bytes");

    if (originResponse.headers.has("Content-Length")) {
      cleanHeaders.set("Content-Length", originResponse.headers.get("Content-Length"));
    }
    if (originResponse.headers.has("Content-Range")) {
      cleanHeaders.set("Content-Range", originResponse.headers.get("Content-Range"));
    }

    // Remove explicitamente qualquer vazamento de cabeçalhos internos
    // (x-amz-*, server, x-powered-by, x-supabase-*, etag, last-modified)
    for (const [key] of originResponse.headers) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith("x-amz-") ||
        lower.startsWith("x-supabase-") ||
        lower === "x-powered-by" ||
        lower === "server" ||
        lower === "via"
      ) {
        cleanHeaders.delete(key);
      }
    }

    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: cleanHeaders,
    });
  },
};
