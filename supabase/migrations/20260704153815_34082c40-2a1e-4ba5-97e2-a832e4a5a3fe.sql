
DO $$
DECLARE
  v_base timestamptz := date_trunc('minute', now()) + interval '3 minutes';
  v_stagger_seconds int := 90;
  v_gap_minutes int := 20;
  v_acct record;
  v_post record;
  v_i int;
  v_acct_idx int := 0;
  v_account_start timestamptz;
BEGIN
  FOR v_acct IN
    SELECT DISTINCT ig_account_id
    FROM public.scheduled_posts
    WHERE status IN ('scheduled','failed','publishing')
      AND ig_account_id IS NOT NULL
    ORDER BY ig_account_id
  LOOP
    v_account_start := v_base + make_interval(secs => v_acct_idx * v_stagger_seconds);
    v_i := 0;
    FOR v_post IN
      SELECT id
      FROM public.scheduled_posts
      WHERE ig_account_id = v_acct.ig_account_id
        AND status IN ('scheduled','failed','publishing')
      ORDER BY scheduled_at ASC, created_at ASC
    LOOP
      UPDATE public.scheduled_posts
      SET scheduled_at = v_account_start + make_interval(mins => v_gap_minutes * v_i),
          status = CASE WHEN status = 'failed' THEN 'scheduled' ELSE status END,
          processing_lock_at = NULL,
          updated_at = now()
      WHERE id = v_post.id;
      v_i := v_i + 1;
    END LOOP;
    v_acct_idx := v_acct_idx + 1;
  END LOOP;
END $$;

UPDATE public.media_pools
SET next_batch_at = now() + interval '20 minutes',
    interval_minutes = 20,
    batch_size = 1,
    updated_at = now()
WHERE status = 'active';
