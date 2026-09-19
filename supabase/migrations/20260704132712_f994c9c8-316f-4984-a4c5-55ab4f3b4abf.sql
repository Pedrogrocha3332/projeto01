DO $$
DECLARE
  base_time timestamptz := now() + interval '90 minutes';
BEGIN
  -- Posts agendados próximos demais são reagendados em sequência global de 2 minutos,
  -- preservando a ordem atual e evitando rajada de contas diferentes no mesmo minuto.
  WITH candidates AS (
    SELECT
      id,
      row_number() OVER (ORDER BY scheduled_at, created_at, id) - 1 AS rn
    FROM public.scheduled_posts
    WHERE status = 'scheduled'
      AND scheduled_at < base_time
  )
  UPDATE public.scheduled_posts p
     SET scheduled_at = base_time + (c.rn * interval '2 minutes'),
         updated_at = now(),
         processing_lock_at = NULL
    FROM candidates c
   WHERE p.id = c.id;

  -- Falhas por "too many actions" não devem tentar de novo agora.
  -- Mantemos visíveis como failed, mas empurramos o retry para depois do cooldown,
  -- também espaçado globalmente.
  WITH failed_rate AS (
    SELECT
      id,
      row_number() OVER (ORDER BY coalesce(next_retry_at, scheduled_at), created_at, id) - 1 AS rn
    FROM public.scheduled_posts
    WHERE status = 'failed'
      AND last_error ILIKE '%too many actions%'
  )
  UPDATE public.scheduled_posts p
     SET next_retry_at = base_time + (f.rn * interval '2 minutes'),
         processing_lock_at = NULL,
         updated_at = now()
    FROM failed_rate f
   WHERE p.id = f.id;

  -- Pools ativos cujo próximo lote está vencido ou perto demais também esperam o cooldown.
  -- Isso impede que o processador crie novo lote imediatamente enquanto a conta está quente.
  WITH due_pools AS (
    SELECT
      id,
      row_number() OVER (ORDER BY coalesce(next_batch_at, now()), id) - 1 AS rn
    FROM public.media_pools
    WHERE status = 'active'
      AND (next_batch_at IS NULL OR next_batch_at < base_time)
  )
  UPDATE public.media_pools p
     SET next_batch_at = base_time + (d.rn * interval '2 minutes'),
         updated_at = now()
    FROM due_pools d
   WHERE p.id = d.id;
END $$;