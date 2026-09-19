
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if present, then schedule
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'elite-publish-scheduled';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END$$;

SELECT cron.schedule(
  'elite-publish-scheduled',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://meuprojetoeu.lovable.app/api/public/cron/publish-scheduled',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'apikey', current_setting('app.settings.publishable_key', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
