DO $$
DECLARE
  jid bigint;
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51anBlcGRuc3lod3lhdHhlaGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NTQxMzYsImV4cCI6MjA5ODUzMDEzNn0.9cClgRRflk4mcULFKggg0wVRx4vzzoTGZ59vwGueTns';
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'elite-publish-scheduled';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END$$;

SELECT cron.schedule(
  'elite-publish-scheduled',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://meuprojetoeu.lovable.app/api/public/cron/publish-scheduled',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51anBlcGRuc3lod3lhdHhlaGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NTQxMzYsImV4cCI6MjA5ODUzMDEzNn0.9cClgRRflk4mcULFKggg0wVRx4vzzoTGZ59vwGueTns'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
