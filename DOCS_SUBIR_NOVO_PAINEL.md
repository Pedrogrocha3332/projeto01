# 🌐 Guia Definitivo: Como Subir um Novo Painel com Isolamento Total (Zero-Footprint)

Este manual detalha o processo para criar novos painéis (Painel 02, Painel 03, etc.) com **isolamento absoluto de infraestrutura**. 

---

## 🛡️ A Regra de Ouro do Blackhat: Isolamento de URN e Origem

Quando o Instagram recebe uma ordem para publicar um Reel, a Meta faz uma requisição HTTP para a URL do vídeo (`video_url`) para baixar o arquivo nos servidores deles.

> [!CAUTION]
> **Por que NUNCA compartilhar a mesma URL do Cloudflare Worker entre painéis?**
> Se 15 contas do Painel 01 e 15 contas do Painel 02 baixarem vídeos da mesma URN/Host (`https://meu-worker.workers.dev`), a Meta identifica que 30 perfis distintos estão consumindo mídia da mesma infraestrutura. Se uma conta sofrer penalização de alcance, todas as outras que usam o mesmo domínio de CDN podem ser correlacionadas e penalizadas.

Para cada novo painel que você subir, você deve isolar:
1. **Proxy Residencial**: Porta/usuário exclusivo de saída para as chamadas à API da Meta.
2. **Cloudflare Worker**: Subdomínio ou worker exclusivo para a entrega dos vídeos (evita URN idêntica).
3. **Deploy no Vercel**: Instância e URL do painel independentes.
4. **Cronjob de Disparo**: Linha de agendamento exclusiva.

---

## 📋 Checklist de Componentes por Painel

| Componente | Painel 01 (Atual) | Painel 02 (Novo) | Painel 03 (Futuro) |
| :--- | :--- | :--- | :--- |
| **Vercel URL** | `projeto01-phi-six.vercel.app` | `painel02-xxxx.vercel.app` | `painel03-xxxx.vercel.app` |
| **Proxy Residencial** | `sv1.allanproxys.com:10000` | `sv1.allanproxys.com:10001` *(ou credencial 2)* | `sv1.allanproxys.com:10002` |
| **Cloudflare Worker** | `p1-media.workers.dev` | `p2-media.workers.dev` | `p3-media.workers.dev` |
| **Contas Instagram** | Lote 01 (15 contas) | Lote 02 (15 contas) | Lote 03 (15 contas) |
| **Cronjob na VPS** | Minuto a minuto (`painel_cron`) | Minuto a minuto (`painel02_cron`) | Minuto a minuto (`painel03_cron`) |

---

## 🚀 Passo a Passo: Subindo o Painel 02

### Passo 1: Criar o Cloudflare Worker Exclusivo para o Painel 02

1. Acesse seu painel da **Cloudflare** -> **Workers & Pages** -> **Create application** -> **Create Worker**.
2. Dê um nome único, por exemplo: `painel02-cdn`.
3. Clique em **Deploy** e depois em **Edit Code**.
4. Cole o código do Worker de Proxy de Mídia (ele busca o vídeo com segurança e entrega para o Instagram com headers perfeitos):

```javascript
// Worker de Entrega de Vídeos - Painel 02
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("URL ausente", { status: 400 });
    }

    // Busca o vídeo original no storage com streaming de alta velocidade
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
    });

    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Content-Type", "video/mp4");
    newHeaders.set("Cache-Control", "public, max-age=86400");

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  },
};
```
5. Salve e implante (**Save and Deploy**).
6. Copie a URL do Worker gerada:
   Exemplo: `https://painel02-cdn.seudominio.workers.dev`

---

### Passo 2: Configurar o Proxy Residencial para o Painel 02

No seu provedor de proxy (ex: AllanProxy ou outro):
- Gere uma nova porta ou um novo usuário/senha residencial dedicado para o Painel 02.
- Exemplo:
  `http://usuario_p2:senha_p2@sv1.allanproxys.com:10001`
- Isso garante que as 15 contas do Painel 02 naveguem por um bloco de IPs totalmente separado do Painel 01.

---

### Passo 3: Deploy do Painel 02 no Vercel

1. Acesse o **Vercel** -> **Add New...** -> **Project**.
2. Conecte ao mesmo repositório do GitHub (`Pedrogrocha3332/projeto01`).
3. Dê o nome do projeto: `painel02-automacao`.
4. Em **Environment Variables**, adicione as variáveis com os dados exclusivos do Painel 02:

```env
# Banco de Dados
VITE_SUPABASE_URL=https://nrokcurppdvhbadpigql.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_a260FWfRJJKOB-BM1ejrrQ_iPOGfNGJ
SUPABASE_URL=https://nrokcurppdvhbadpigql.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_a260FWfRJJKOB-BM1ejrrQ_iPOGfNGJ

# PROXY DEDICADO DO PAINEL 02 (Não compartilhe com o painel 01)
PROXY_URL=http://usuario_p2:senha_p2@sv1.allanproxys.com:10001

# CLOUDFLARE WORKER DEDICADO DO PAINEL 02 (Não compartilhe com o painel 01)
CLOUDFLARE_WORKER_URL=https://painel02-cdn.seudominio.workers.dev

# URL DO NOVO PAINEL
APP_URL=https://painel02-automacao.vercel.app
```

5. Clique em **Deploy**.

---

### Passo 4: Configurar o Cronjob na VPS para o Painel 02

O cron precisa chamar o endpoint do Painel 02 a cada 1 minuto para processar a fila das novas contas:

1. Acesse sua VPS Contabo via SSH:
   ```bash
   ssh root@13.140.33.130
   ```
2. Abra o arquivo de crons:
   ```bash
   nano /etc/cron.d/painel_cron
   ```
3. Adicione a linha correspondente ao Painel 02 logo abaixo da linha do Painel 01:
   ```cron
   * * * * * root curl -s -X POST -H "apikey: sb_publishable_a260FWfRJJKOB-BM1ejrrQ_iPOGfNGJ" https://projeto01-phi-six.vercel.app/api/public/cron/publish-scheduled >> /var/log/cron_publish.log 2>&1
   * * * * * root curl -s -X POST -H "apikey: sb_publishable_a260FWfRJJKOB-BM1ejrrQ_iPOGfNGJ" https://painel02-automacao.vercel.app/api/public/cron/publish-scheduled >> /var/log/cron_painel02.log 2>&1
   ```
4. Salve (`Ctrl+O`, `Enter`) e saia (`Ctrl+X`).
5. Reinicie o cron da VPS:
   ```bash
   systemctl restart cron
   ```

---

### Passo 5: Cadastrar as Contas e Criar os Pools

1. Abra o novo painel (`https://painel02-automacao.vercel.app`).
2. Adicione as 15 contas de Instagram exclusivas deste painel.
3. Crie os pools de rotação com seus criativos e legendas.
4. O worker da VPS de camuflagem (FFmpeg 24/7) já atende automaticamente todas as mídias da base, limpando os hashes de forma independente!

---

## 🔒 Resumo do Nível de Proteção por Painel

```
[ Painel 01 ] ──▶ IP Residencial 1 ──▶ Cloudflare CDN 1 (p1-media) ──▶ Contas 1 a 15 (S24, Pixel 8...)
[ Painel 02 ] ──▶ IP Residencial 2 ──▶ Cloudflare CDN 2 (p2-media) ──▶ Contas 16 a 30 (Xiaomi, S23...)
[ Painel 03 ] ──▶ IP Residencial 3 ──▶ Cloudflare CDN 3 (p3-media) ──▶ Contas 31 a 45 (Motorola...)
```

Com essa estrutura, a Meta enxerga cada painel como um cluster de usuários completamente independente, sem nenhuma ligação de IP, sem nenhuma ligação de URN e sem cruzamento de metadados.
