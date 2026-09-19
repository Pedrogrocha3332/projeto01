
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS auto_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_lock_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts_log jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_monitor
  ON public.scheduled_posts (status, next_retry_at)
  WHERE status IN ('publishing','failed');
