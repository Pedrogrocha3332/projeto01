# Regras de Agendamento e Segurança de Reels (Pools)

Este documento detalha o funcionamento completo do motor de agendamento e segurança de publicação de Reels desenvolvido para a sua plataforma. 

---

## 1. Parâmetros Definidos por Pool (Configuração do Usuário)

Ao criar ou editar um Pool, três variáveis definem o fluxo de postagem de cada conta:

*   **Lote (Batch Size):** A quantidade de Reels agendados por ciclo. 
    *   *Configuração recomendada:* `3` Reels.
*   **Intervalo (Interval Minutes):** O tempo de espera entre o início de cada lote.
    *   *Configuração recomendada:* `60` minutos (1 hora).
*   **Espaço (Spacing Seconds):** A folga em segundos entre os vídeos do *mesmo lote* na *mesma conta*.
    *   *Configuração recomendada:* `300` segundos (5 minutos).

### 📍 Exemplo Prático de Fila (Lote=3, Intervalo=60min, Espaço=300seg):
Se o ciclo da conta começar às **14:00**:
*   **Reel 1:** Agendado para **14:00**
*   **Reel 2:** Agendado para **14:05** (14:00 + 300 segundos)
*   **Reel 3:** Agendado para **14:10** (14:05 + 300 segundos)
*   *Próximo Lote:* Começará a partir das **15:00** (14:00 + 60 minutos).

---

## 2. Regras de Segurança e Anti-Bloqueio (Motor do Servidor)

Para proteger as contas contra os sistemas de detecção de spam da Meta (Instagram), o servidor aplica as seguintes regras automáticas em tempo de execução:

### A. Escalonamento entre Contas Diferentes (Account Staggering)
Se você gerencia **40 contas**, seria fatal se todas tentassem enviar um Reel exatamente às 14:00:00. O sistema resolve isso em dois níveis:
1.  **Offset Determinístico:** Cada conta recebe um desvio padrão de alguns minutos (ex: Conta A começa às 14:02, Conta B às 14:05) calculado de forma única a partir do ID da conta.
2.  **Folga Global de Choque (5 segundos):** O sistema garante um intervalo mínimo de **5 segundos** entre disparos de contas diferentes. Se duas contas tentarem postar no exato mesmo segundo, uma delas será empurrada de 5 a 15 segundos para a frente.

### B. Limite Máximo de Postagem por Conta (Account Group Limit)
*   **A Regra:** Cada conta pode postar no máximo **3 Reels a cada 60 minutos** (janela móvel).
*   **Como funciona:** Se por algum erro de configuração o sistema tentar agendar um 4º post para a mesma conta dentro de um intervalo menor que 1 hora, o motor de segurança intercepta o post e o adia automaticamente para o próximo horário seguro.

### C. Bloqueio Consecutivo de Conta (Account Lock / Fila de Espera)
*   **A Regra:** O sistema **nunca** tenta enviar dois vídeos da mesma conta ao mesmo tempo.
*   **Como funciona:** Se dois Pools ativos gerarem posts para a mesma conta no mesmo minuto (ex: dois posts às 14:00):
    1.  O sistema inicia a publicação do primeiro Reel (status muda para **`Publishing`** / amarelo).
    2.  O segundo Reel entra em espera com o status *"aguardando a publicação anterior da mesma conta"*.
    3.  A Meta leva cerca de 2 minutos para processar o primeiro vídeo. Assim que ele é concluído (muda para **`Published`** / verde), o sistema detecta que a conta foi liberada e inicia o envio do segundo Reel imediatamente.

### D. Tolerância de Agendamento (IMMEDIATE_TOLERANCE = 60s)
*   Se o cálculo de horário seguro determinar que um post precisa ser adiado por menos de 1 minuto em relação ao horário atual, o sistema ignora o atraso e **publica na hora**. Isso evita que posts fiquem sendo adiados infinitamente em filas em andamento.
