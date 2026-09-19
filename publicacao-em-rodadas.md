# Publicação em rodadas

Seção /rounds, separada dos pools normais. Rascunhos não criam media_pools nem scheduled_posts. Escolha de 1 a 100 contas, a ordem das contas, vídeos em ordem manual, legendas e capa por conta. Padrões: duas contas em paralelo, 10 por conta/rodada, 20 no total por conta, 60 segundos entre vídeos da mesma conta. Se a lista acabar, recomeça na mesma ordem. A última rodada pode ser menor que o lote.

## Operação

1. Nova execução: escolha contas, vídeos e ordem, depois Salvar rascunho.
2. Pause pools normais e resolva posts scheduled/publishing/failed existentes antes de Iniciar rodadas. Só uma execução por banco pode reservar o painel.
3. Iniciar materializa o plano numa transação. O cron cria até um scheduled_post pendente por conta do par, cada um com seu post_media, atomicamente. A confirmação de cada conta libera seu próximo vídeo; o próximo par só é liberado quando ambas completam a rodada. Para número ímpar de contas, a última roda sozinha. O espaçamento é contado a partir da confirmação anterior; a frequência dos crons e a Meta podem aumentar a espera.
4. Pausar impede novos inícios; envios já iniciados podem terminar, inclusive o parceiro de uma conta que falhou. Continuar usa o mesmo post/container. Falhas pausam a execução, sem retry automático do monitor normal. Corrija a causa e continue, ou pause/encerre. Cancelar durante envio em processamento é bloqueado.
5. Ao terminar, a execução fica concluída e não se repete automaticamente. Nenhum pool normal é criado ou ativado por ela. O total por conta vale para esta execução e é independente do limite vitalício de media_pools.

## Integridade e limites da garantia

claim_publication_send serializa decisões com o início da execução usando advisory lock e um lease por post com token, válido por 15 minutos. Cron, publicação manual e recuperação usam a mesma porta antes das chamadas à Meta. A porta permite dois parceiros em paralelo, mas nunca dois envios da mesma conta nem um terceiro participante. Publicação normal fica em espera enquanto uma execução estiver ativa, pausada ou com falha. Sem execução reservada, o fluxo normal continua.

Os itens registram confirmação durável: limpar o histórico após concluir não reinicia a contagem. Vídeos/posts usados por uma execução reservada não podem ser apagados. A exclusão individual da biblioteca verifica o banco antes de remover o arquivo, para respeitar esse bloqueio. Depois de encerrar/concluir, a limpeza é permitida. Pools normais e seus limites/ordem não são modificados pela migração.

A garantia é por banco/painel e cobre envios por este código atualizado. Não controla publicações feitas diretamente no Instagram, por outro serviço ou por outro painel/banco. Credenciais, disponibilidade da Meta e agendadores continuam sendo dependências externas. Não foram publicados reels reais durante os testes.

## Instalação

Aplicar supabase/migrations/20260914010000_publication_rounds.sql e depois supabase/migrations/20260914020000_rounds_account_pairs.sql em cada banco que receberá o deploy ANTES de publicar o código. Não reaplicar combined_migration.sql. A migração pode ser repetida e não inicia nenhuma execução. Os crons existentes publish-scheduled e process-pools acionam o coordenador; não é preciso criar um cron adicional. O monitor normal ignora os posts de rodadas.

## Validação

Testes PostgreSQL/PGlite: 15 contas x 20 posts, concorrência, fila bloqueada até confirmar, totais não divisíveis, pausa/falha/retomada, exclusividade, RLS, repetição da migração e limpeza de histórico. Testes do publicador com Meta simulada cobrem bloqueio dos três caminhos, publicação normal e retomada após falha de persistência sem novo media_publish. Interface real testada com backend simulado em 1280x800 e 390x844. Build de produção passa. Typecheck mantém apenas os dois erros preexistentes em __root.tsx e na tipagem caption_2/caption_3 de pools.tsx.

A atualização de pares preserva itens existentes, confirmações e a expressão de seleção da legenda. Testes adicionais cobrem 15 contas em pares x 20, parceiro lento, primeira conta já iniciada antes da migração, espaçamento de 60 segundos por conta, falha com parceiro em processamento e o cron de dois workers.

## Contas ao mesmo tempo

Aplique `20260914030000_rounds_configurable_concurrency.sql` após o SQL inicial de rodadas. Na criação ou edição do rascunho, escolha de 1 a 5 contas simultâneas (novas execuções começam com 3). Cada conta mantém um vídeo por vez, a ordem e o espaçamento configurados. O próximo grupo espera todas as contas do atual concluírem a rodada. Execuções existentes permanecem com 2; a quantidade fica fixa após iniciar, inclusive quando pausada. Não altera legendas nem pools normais.
