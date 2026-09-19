# Biblioteca por conta e ordem dos vídeos

## Aplicação

1. Aplicar `supabase/migrations/20260912020000_media_account_library.sql` em cada banco Supabase do painel.
2. Aplicar também `supabase/migrations/20260912030000_shared_pool_library.sql` para habilitar seleção entre contas. Essa atualização só substitui a validação de novos vínculos, sem alterar dados existentes.
3. Publicar o código atualizado. Esta migração precisa existir antes de usar a biblioteca e criar novos pools na nova versão.

A migração não atribui automaticamente os arquivos antigos a contas, não remove vídeos dos pools e não altera posts já agendados. Os pools existentes continuam aleatórios por padrão. A cópia administrativa de painéis preserva vínculos legados e remapeia a conta dos arquivos para a conta copiada.

## Uso

Na Biblioteca, escolher a conta antes de enviar vídeos. Para arquivos antigos, abrir Sem conta, selecionar os vídeos e escolher Vincular à conta. O vínculo organiza novas seleções; se um vídeo já está em outros pools, continua nesses pools. Fotos e capas permanecem compartilhadas.

Nos seletores de criar pool e adicionar vídeos, as abas Todas, @conta e Sem conta filtram os vídeos acessíveis na biblioteca do painel atual. Trocar a aba preserva a seleção e a ordem; Selecionar todos vale somente para os vídeos visíveis na aba e busca. A conta que publica continua sendo a do pool. Trocar essa conta no cadastro limpa a seleção anterior. Usar um vídeo de outra conta não move o arquivo nem altera seu vínculo na biblioteca ou nos outros pools.

O servidor e o banco continuam exigindo acesso à conta de publicação, ao pool e ao vídeo. Não são modificadas políticas RLS nem adicionadas conexões entre bancos de painéis diferentes. Os pools ativos, suas posições, ciclos e posts agendados não são atualizados pela migração.

Ao criar um pool, marcar Escolher ordem dos vídeos e usar as setas para organizar a lista selecionada. Para um pool existente, pausar, abrir a aba de vídeos, marcar a opção, ordenar, salvar e retomar. Os próximos lotes usam a ordem dos vídeos ainda não enfileirados no ciclo. No próximo ciclo, a sequência começa novamente desde o primeiro vídeo. Os posts que já estão na fila não mudam.

A ordem controla o agendamento e o envio à API. O tempo de processamento e falhas do Instagram podem alterar a ordem de conclusão. Publicar selecionados na fila é uma ação manual independente dos horários do pool.

## Validação

- `node --test tests/media-account.test.cjs tests/publication-scheduling.test.cjs`
- `node --test tests/shared-pool-library.test.cjs` (com `PGLITE_PATH` definido, testa dois bancos com cinco pools ativos cada, preservação dos registros e permissões).
- `npm run build`
- Teste SQL: instalar `@electric-sql/pglite` num diretório temporário, definir `PGLITE_PATH` como caminho absoluto para o pacote e executar `node --test tests/media-account-sql.test.cjs`. Sem essa variável, somente o teste SQL é ignorado.

A checagem TypeScript ainda encontra os dois erros anteriores em `__root.tsx` e na tipagem de `caption_2` / `caption_3` de pools. Não foram introduzidos novos erros nessa checagem.
