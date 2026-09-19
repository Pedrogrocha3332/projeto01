
DO $$
DECLARE
  acct RECORD;
  post RECORD;
  v_offset_seconds INT := 0;
  v_stagger_seconds INT := 180; -- 3 minutos entre contas
  v_base TIMESTAMPTZ := date_trunc('minute', now()) + interval '2 minutes';
  v_account_start TIMESTAMPTZ;
  v_last_published TIMESTAMPTZ;
  v_slot TIMESTAMPTZ;
  v_i INT;
BEGIN
  -- Para cada conta ativa com posts pendentes, na ordem original,
  -- atribui slot = (base + offset_conta) + i*60min, respeitando 60min desde o último published.
  FOR acct IN
    SELECT DISTINCT sp.ig_account_id
    FROM public.scheduled_posts sp
    JOIN public.instagram_accounts ia ON ia.id = sp.ig_account_id
    WHERE sp.status IN ('scheduled','failed','publishing')
      AND ia.is_active = true
      AND COALESCE(ia.is_restricted, false) = false
    ORDER BY sp.ig_account_id
  LOOP
    -- Último published dessa conta (para respeitar 60min desde a última publicação real).
    SELECT MAX(published_at) INTO v_last_published
    FROM public.scheduled_posts
    WHERE ig_account_id = acct.ig_account_id AND status = 'published';

    v_account_start := GREATEST(
      v_base + make_interval(secs => v_offset_seconds),
      COALESCE(v_last_published + interval '60 minutes', v_base)
    );

    v_i := 0;
    FOR post IN
      SELECT id FROM public.scheduled_posts
      WHERE ig_account_id = acct.ig_account_id
        AND status IN ('scheduled','failed','publishing')
      ORDER BY scheduled_at ASC, created_at ASC
    LOOP
      v_slot := v_account_start + make_interval(mins => 60 * v_i);
      UPDATE public.scheduled_posts
      SET scheduled_at = v_slot,
          status = 'scheduled',
          processing_lock_at = NULL,
          next_retry_at = NULL,
          last_error = NULL,
          ig_container_id = NULL,
          auto_retry_count = 0,
          updated_at = now()
      WHERE id = post.id;
      v_i := v_i + 1;
    END LOOP;

    v_offset_seconds := v_offset_seconds + v_stagger_seconds;
  END LOOP;
END $$;

-- Pools ativos: próximo batch dali a 60min para respeitar o ciclo.
UPDATE public.media_pools
SET next_batch_at = now() + interval '60 minutes',
    updated_at = now()
WHERE status = 'active';
