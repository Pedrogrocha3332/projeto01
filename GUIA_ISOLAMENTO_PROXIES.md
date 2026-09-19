# Guia Prático de Isolamento Total dos Painéis e Blindagem de Vídeos

Este guia explica como ativar o **isolamento 1:1 por proxy residencial** em cada um dos seus 10 painéis na Vercel e como usar o script de **camuflagem perceptual suprema** para anular o algoritmo PDQ Hash da Meta.

---

## 1. Ativando o Proxy Residencial na Vercel (Isolamento de Rede)

O código em `publish.server.ts` já foi atualizado para ler a variável de ambiente `PROXY_URL`. Quando ela existe, todas as requisições para a Meta Graph API (`POST /{ig-user-id}/media`, `media_publish`, polling de status) saem **exclusivamente através do proxy residencial configurado**.

### Passo a passo na Vercel:
Para cada um dos seus 10 projetos na Vercel:

1. Acesse o painel da **Vercel** (`https://vercel.com`).
2. Abra o projeto do painel (ex: `painel-cliente-01`).
3. Vá em **Settings** > **Environment Variables**.
4. Adicione a variável:
   * **Key:** `PROXY_URL`
   * **Value:** O endereço do seu proxy residencial (ex: `http://usuario:senha@ip-ou-host:porta`)
   * **Target:** Marque *Production*, *Preview* e *Development*.
5. Salve e faça um **Redeploy** (ou dê um git push da alteração).

> 💡 **Regra de Ouro do Isolamento:**  
> Use uma porta ou sessão diferente para cada painel:
> * **Painel 01:** `PROXY_URL = http://user:pass@br.proxy.com:10001`
> * **Painel 02:** `PROXY_URL = http://user:pass@br.proxy.com:10002`
> * ...
> * **Painel 10:** `PROXY_URL = http://user:pass@br.proxy.com:10010`
> 
> Dessa forma, a Meta enxerga 10 clientes residenciais brasileiros completamente diferentes. **Zero cruzamento de IP da Vercel!**

---

## 2. Camuflando os Vídeos com FFmpeg (Anti-Duplicação Suprema)

Criamos o script utilitário em `scripts/camuflar_criativos.py`. Ele utiliza o mesmo motor já validado no seu desktop, aplicando:
* **Micro-Trim de 0.2s a 0.4s** (destrói I-Frames e fingerprint temporal).
* **Micro-Rotação de 0.25° + Zoom 1.025x** (destrói o PDQ Hash de pixels sem perder qualidade).
* **Micro-Equalização e Ruído Temporal imperceptível**.
* **Trend Hijacking** (mixa áudio viral a 1% se houver pasta `audios_trend`).
* **Limpeza de metadados** (`-map_metadata -1`).
* **Assinatura binária única** no final de cada arquivo.

### Como usar na sua máquina ou VPS:
1. Abra o terminal na pasta do projeto:
   ```bash
   cd c:\Users\pedro\Desktop\Avaliable-domain-main
   ```
2. Coloque seus vídeos brutos dentro da pasta `videos_brutos/`.
3. *(Opcional)* Se tiver músicas em alta, coloque-as em `audios_trend/`.
4. Execute o script:
   ```bash
   python scripts/camuflar_criativos.py --input videos_brutos --output videos_camuflados
   ```
5. Os vídeos gerados na pasta `videos_camuflados` já estão 100% blindados e matematicamente inéditos no mundo.
6. Basta fazer o upload desses vídeos para a biblioteca do painel/Supabase.

---

## 3. Cadência Segura de Publicação

* Evite disparos com menos de **90 segundos de intervalo** na mesma conta.
* Mantenha o ciclo padrão de viralização: **lotes de 3 a 5 Reels com intervalo humano de 1m30s a 2m15s e pausa automática de 1 hora entre os ciclos**.
