# Regras de publicação

O sistema não aplica mais uma quota de 3 Reels por conta por hora.

- O pool aceita a quantidade de Reels definida pelo usuário, limitada aos vídeos únicos disponíveis no lote.
- Espaçamento de 0 segundos permite enfileirar o lote junto. O intervalo continua controlando a geração do próximo lote.
- Na fila, Publicar agora ignora a data futura do post. Publicar selecionados envia todos os itens selecionados elegíveis, com resumo de enviados, reagendados e falhas.
- A rotina automática processa até 50 posts vencidos por execução, sem bloquear novos envios da mesma conta enquanto outros vídeos são processados. O restante fica para as próximas execuções.
- O processamento de vídeo da Meta ainda determina quando cada Reel fica pronto. Respostas de rate-limit continuam acionando recuperação e espera.

Aplicar a migração 20260912010000_allow_custom_pool_batches.sql antes de usar espaçamento zero ou lotes acima de 20. Pools existentes conservam seus valores: para testar 12 juntos, editar o pool com lote 12 e espaçamento 0.
