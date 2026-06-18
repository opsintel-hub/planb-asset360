
CREATE OR REPLACE FUNCTION public.get_mssql_cron_schedules()
RETURNS TABLE(job_name text, schedule text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT jobname::text, schedule::text
  FROM cron.job
  WHERE jobname IN (
    'mssql-sync-assets-daily',
    'mssql-sync-pm-schedules-daily',
    'mssql-sync-asset-history-daily'
  );
$$;

REVOKE ALL ON FUNCTION public.get_mssql_cron_schedules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mssql_cron_schedules() TO service_role;

CREATE OR REPLACE FUNCTION public.set_mssql_cron_schedule(
  p_job text,
  p_hour_utc int,
  p_minute_utc int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_url text;
  v_schedule text;
  v_command text;
BEGIN
  IF p_job NOT IN (
    'mssql-sync-assets-daily',
    'mssql-sync-pm-schedules-daily',
    'mssql-sync-asset-history-daily'
  ) THEN
    RAISE EXCEPTION 'invalid job name: %', p_job;
  END IF;
  IF p_hour_utc < 0 OR p_hour_utc > 23 OR p_minute_utc < 0 OR p_minute_utc > 59 THEN
    RAISE EXCEPTION 'invalid time';
  END IF;

  v_url := CASE p_job
    WHEN 'mssql-sync-assets-daily'        THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-assets'
    WHEN 'mssql-sync-pm-schedules-daily'  THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-pm-schedules'
    WHEN 'mssql-sync-asset-history-daily' THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-asset-history'
  END;

  v_schedule := p_minute_utc::text || ' ' || p_hour_utc::text || ' * * *';

  v_command := format($cmd$
  SELECT net.http_post(
    url := %L,
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtZWR6bGpibHpuZ3Jsc2FsZnNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNDU5MjAsImV4cCI6MjA5NDgyMTkyMH0.dUcQfG1qZm-Z1lMpqyPXagM2hzHpFUxqEesLmQOX0k0"}'::jsonb,
    body := '{}'::jsonb
  );
$cmd$, v_url);

  BEGIN
    PERFORM cron.unschedule(p_job);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(p_job, v_schedule, v_command);
END;
$$;

REVOKE ALL ON FUNCTION public.set_mssql_cron_schedule(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, int, int) TO service_role;
