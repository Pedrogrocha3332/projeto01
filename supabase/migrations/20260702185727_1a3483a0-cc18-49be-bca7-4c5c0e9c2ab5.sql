
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
    headers := jsonb_build_object('content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
