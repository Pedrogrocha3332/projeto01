
DO $$
DECLARE
  acct RECORD;
  post RECORD;
  v_offset_seconds INT := 0;
  v_stagger_seconds INT := 240; -- 4 minutos entre contas
  v_base TIMESTAMPTZ := date_trunc('minute', now()) + interval '3 minutes';
  v_account_start TIMESTAMPTZ;
  v_last_published TIMESTAMPTZ;
  v_slot TIMESTAMPTZ;
  v_i INT;
  v_group INT;
  v_within INT;
  v_group_size INT := 3;
  v_within_gap_secs INT := 20; -- 20s entre os 3 do mesmo grupo
BEGIN
  FOR acct IN
    SELECT DISTINCT sp.ig_account_id
    FROM public.scheduled_posts sp
    JOIN public.instagram_accounts ia ON ia.id = sp.ig_account_id
    WHERE sp.status IN ('scheduled','failed','publishing')
      AND ia.is_active = true
      AND COALESCE(ia.is_restricted, false) = false
    ORDER BY sp.ig_account_id
  LOOP
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
      v_group  := v_i / v_group_size;               -- 0,0,0, 1,1,1, 2,2,2 ...
      v_within := v_i % v_group_size;               -- 0,1,2, 0,1,2, 0,1,2 ...
      v_slot := v_account_start
              + make_interval(mins => 60 * v_group)
              + make_interval(secs => v_within_gap_secs * v_within);

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

UPDATE public.media_pools
SET next_batch_at = now() + interval '60 minutes',
    updated_at = now()
WHERE status = 'active';
