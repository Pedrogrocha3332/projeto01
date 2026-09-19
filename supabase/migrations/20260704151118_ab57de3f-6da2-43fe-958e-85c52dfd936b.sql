
-- Rebalanceia posts scheduled/failed usando o novo espaçamento (60min/conta).
-- Preserva a ordem original por scheduled_at dentro de cada conta.
DO $$
DECLARE
  r RECORD;
  v_last_by_acct JSONB := '{}'::jsonb;
  v_global_ts TIMESTAMPTZ := now();
  v_next_ts TIMESTAMPTZ;
  v_last_acct_ts TIMESTAMPTZ;
  v_acct_key TEXT;
BEGIN
  -- Para cada conta, pega o último published_at ou publishing scheduled_at como base.
  FOR r IN
    SELECT sp.id, sp.ig_account_id, sp.scheduled_at, sp.status
    FROM public.scheduled_posts sp
    WHERE sp.status IN ('scheduled','failed')
      AND sp.ig_account_id IS NOT NULL
    ORDER BY sp.ig_account_id, sp.scheduled_at ASC
  LOOP
    v_acct_key := r.ig_account_id::text;

    -- Última referência dessa conta: publicado mais recente OU último slot já alocado.
    IF v_last_by_acct ? v_acct_key THEN
      v_last_acct_ts := (v_last_by_acct ->> v_acct_key)::timestamptz;
    ELSE
      SELECT COALESCE(MAX(published_at), MAX(scheduled_at) FILTER (WHERE status='publishing'))
      INTO v_last_acct_ts
      FROM public.scheduled_posts
      WHERE ig_account_id = r.ig_account_id
        AND status IN ('published','publishing');
    END IF;

    -- Próximo slot: max(agora, último_conta + 60min, global + 30s)
    v_next_ts := GREATEST(
      now() + interval '30 seconds',
      COALESCE(v_last_acct_ts + interval '60 minutes', now()),
      v_global_ts + interval '30 seconds'
    );

    UPDATE public.scheduled_posts
    SET scheduled_at = v_next_ts,
        status = 'scheduled',
        processing_lock_at = NULL,
        next_retry_at = NULL,
        last_error = NULL,
        updated_at = now()
    WHERE id = r.id;

    v_last_by_acct := jsonb_set(v_last_by_acct, ARRAY[v_acct_key], to_jsonb(v_next_ts::text));
    v_global_ts := v_next_ts;
  END LOOP;
END $$;

-- Reajusta próximo batch dos pools ativos para começar em 60min a partir de agora.
UPDATE public.media_pools
SET next_batch_at = now() + interval '5 minutes',
    updated_at = now()
WHERE status = 'active'
  AND (next_batch_at IS NULL OR next_batch_at < now());
