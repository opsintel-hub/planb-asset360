CREATE OR REPLACE FUNCTION public.set_mssql_cron_schedule(p_job text, p_hour_utc integer, p_minute_utc integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'net'
AS $function$
DECLARE
  v_url text;
  v_headers jsonb;
  v_schedule text;
  v_command text;
BEGIN
  IF p_job NOT IN (
    'mssql-sync-assets-daily',
    'mssql-sync-pm-schedules-daily',
    'mssql-sync-asset-history-daily',
    'crm-sync-ad-contracts-daily'
  ) THEN
    RAISE EXCEPTION 'invalid job name: %', p_job;
  END IF;
  IF p_hour_utc < 0 OR p_hour_utc > 23 OR p_minute_utc < 0 OR p_minute_utc > 59 THEN
    RAISE EXCEPTION 'invalid time';
  END IF;

  IF p_job = 'crm-sync-ad-contracts-daily' THEN
    v_url := 'https://project--6d2903c3-530f-4343-83c9-b9ada7a70d18.lovable.app/api/public/hooks/sync-ad-contracts';
    v_headers := '{"Content-Type":"application/json","x-sync-token":"0ea3235be1bd3fb441b0fcfbb2c05be97a0aa94683ca0026"}'::jsonb;
  ELSE
    v_url := CASE p_job
      WHEN 'mssql-sync-assets-daily'        THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-assets'
      WHEN 'mssql-sync-pm-schedules-daily'  THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-pm-schedules'
      WHEN 'mssql-sync-asset-history-daily' THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-asset-history'
    END;
    v_headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtZWR6bGpibHpuZ3Jsc2FsZnNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNDU5MjAsImV4cCI6MjA5NDgyMTkyMH0.dUcQfG1qZm-Z1lMpqyPXagM2hzHpFUxqEesLmQOX0k0"}'::jsonb;
  END IF;

  v_schedule := p_minute_utc::text || ' ' || p_hour_utc::text || ' * * *';

  v_command := format($cmd$
  SELECT net.http_post(
    url := %L,
    headers := %L::jsonb,
    body := '{}'::jsonb
  );
$cmd$, v_url, v_headers::text);

  BEGIN
    PERFORM cron.unschedule(p_job);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(p_job, v_schedule, v_command);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, integer, integer) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, integer, integer) TO service_role;

SELECT public.set_mssql_cron_schedule('crm-sync-ad-contracts-daily', 21, 30);