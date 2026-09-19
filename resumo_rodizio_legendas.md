# Manual de Uso - Rodízio de Legendas (3 Legendas Alternadas)

Este documento explica como funciona a nova funcionalidade de **Rodízio de Legendas** implementada na sua automação de Reels.

---

## 📋 O que foi Feito?

Agora, em vez de usar apenas uma legenda fixa para todos os Reels do seu Pool de Rotação, você pode cadastrar até **3 legendas diferentes** que se alternam de forma inteligente a cada **6 publicações** daquela conta.

### 🛠️ Arquivos Modificados/Criados:
1.  **Migração SQL:** [20260808133500_add_caption_rotation.sql](file:///c:/Users/pedro/Documents/novo-vercel/supabase/migrations/20260808133500_add_caption_rotation.sql) (colunas `caption_2` e `caption_3` adicionadas à tabela `media_pools` no seu Supabase).
2.  **Validações e Handlers:** [pools.functions.ts](file:///c:/Users/pedro/Documents/novo-vercel/src/lib/pools.functions.ts) (atualização do esquema do banco e das chamadas de salvar/editar).
3.  **Lógica da Rotação:** [pools.server.ts](file:///c:/Users/pedro/Documents/novo-vercel/src/lib/pools.server.ts) (contagem no banco e matemática do rodízio de 6 em 6).
4.  **Interface de Abas:** [pools.tsx](file:///c:/Users/pedro/Documents/novo-vercel/src/routes/_authenticated/pools.tsx) (visual premium de abas no modal de Novo Pool e aba de Configurações).

---

## ⚙️ Como funciona a Lógica do Rodízio?

Quando você dispara um Pool, o robô verifica o histórico de publicações daquele pool específico no banco de dados e calcula a legenda do próximo post da seguinte forma:

*   **Posts de 1 a 6:** Usa o texto escrito em **Legenda 1** (`caption`).
*   **Posts de 7 a 12:** Usa o texto escrito em **Legenda 2** (`caption_2`).
*   **Posts de 13 a 18:** Usa o texto escrito em **Legenda 3** (`caption_3`).
*   **Posts de 19 a 24:** Reinicia o ciclo e usa a **Legenda 1** novamente.
*   *Ciclo infinito:* Continua alternando de 6 em 6 posts indefinidamente.

### 🛡️ Trava de Segurança (Fallback)
Se você preencher apenas a **Legenda 1** e deixar as abas 2 e 3 em branco, o sistema detecta que você deseja usar a mesma legenda e **usará a Legenda 1 em todas as postagens**. Isso evita que seus Reels sejam postados sem legenda no Instagram.

---

## 🚀 Como Usar no seu Painel:

1.  **Acesse a tela de Pools:** Clique em criar um **Novo Pool** (ou edite um Pool ativo).
2.  **Preencha as Abas:** Na seção de legendas, você verá 3 botões: **Legenda 1**, **Legenda 2** e **Legenda 3**. Clique em cada aba e insira os textos que deseja alternar.
3.  **Salve e Ative:** Configure o ritmo desejado e ative o Pool. O sistema fará todo o cálculo de ordenação e alternância automaticamente!
