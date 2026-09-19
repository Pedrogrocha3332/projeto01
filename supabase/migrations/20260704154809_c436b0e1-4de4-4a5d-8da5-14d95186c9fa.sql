
-- 1) Log de correções automáticas aplicadas pelo self-healing agent
CREATE TABLE IF NOT EXISTS public.auto_healing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_account_id UUID REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  category TEXT,
  reason TEXT,
  original_scheduled_at TIMESTAMPTZ,
  new_scheduled_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.auto_healing_log TO authenticated;
GRANT ALL ON public.auto_healing_log TO service_role;

ALTER TABLE public.auto_healing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "healing log admin or owner"
ON public.auto_healing_log FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR private.is_admin_principal(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_healing_log_account_time
  ON public.auto_healing_log (ig_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_healing_log_user_time
  ON public.auto_healing_log (user_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.auto_healing_log;

-- 2) Marcação de revisão manual em contas
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS manual_review_at TIMESTAMPTZ;

-- 3) Acelerar cron do monitor de 3min para 1min
DO $$
BEGIN
  PERFORM cron.unschedule('elite-monitor-posts');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'elite-monitor-posts',
  '* * * * *',
  $CRON$
  SELECT net.http_post(
    url:='https://project--7cc17ba5-0136-4079-90d7-e62a71f62980-dev.lovable.app/api/public/cron/monitor-posts',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51anBlcGRuc3lod3lhdHhlaGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NTQxMzYsImV4cCI6MjA5ODUzMDEzNn0.9cClgRRflk4mcULFKggg0wVRx4vzzoTGZ59vwGueTns"}'::jsonb,
    body:='{}'::jsonb
  );
  $CRON$
);
