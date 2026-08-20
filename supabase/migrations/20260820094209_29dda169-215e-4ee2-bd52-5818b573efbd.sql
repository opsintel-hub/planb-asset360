CREATE TABLE public.ad_contracts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_old_code text,
  equipment_id text,
  product_name text,
  ad_contract text,
  status text,
  start_date_contract date,
  end_date_contract date,
  favor_start_date_contract date,
  favor_end_date_contract date,
  source text NOT NULL DEFAULT 'crm',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ad_contracts_natural_key
  ON public.ad_contracts (
    COALESCE(ad_contract, ''),
    COALESCE(asset_old_code, ''),
    COALESCE(product_name, ''),
    COALESCE(start_date_contract, '1900-01-01'::date)
  );
CREATE INDEX ad_contracts_asset_idx ON public.ad_contracts (asset_old_code);
CREATE INDEX ad_contracts_status_idx ON public.ad_contracts (status);
CREATE INDEX ad_contracts_dates_idx ON public.ad_contracts (start_date_contract, end_date_contract);
CREATE INDEX ad_contracts_product_trgm ON public.ad_contracts USING gin (product_name gin_trgm_ops);

GRANT SELECT ON public.ad_contracts TO authenticated;
GRANT ALL ON public.ad_contracts TO service_role;
ALTER TABLE public.ad_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ad_contracts_read_authenticated"
  ON public.ad_contracts FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_ad_contracts_updated_at
  BEFORE UPDATE ON public.ad_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE VIEW public.ad_current_by_asset
WITH (security_invoker = true) AS
SELECT DISTINCT ON (c.asset_old_code)
  c.asset_old_code,
  c.product_name,
  c.ad_contract,
  c.equipment_id,
  c.start_date_contract,
  c.end_date_contract,
  c.favor_start_date_contract,
  c.favor_end_date_contract,
  c.status,
  (c.end_date_contract - CURRENT_DATE) AS days_to_end
FROM public.ad_contracts c
WHERE c.status = 'current'
  AND c.asset_old_code IS NOT NULL
  AND (c.end_date_contract IS NULL OR c.end_date_contract >= CURRENT_DATE)
ORDER BY c.asset_old_code, c.end_date_contract DESC NULLS LAST, c.start_date_contract DESC NULLS LAST;

GRANT SELECT ON public.ad_current_by_asset TO authenticated;
GRANT ALL ON public.ad_current_by_asset TO service_role;

CREATE OR REPLACE FUNCTION public.get_mssql_cron_schedules()
 RETURNS TABLE(job_name text, schedule text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
  SELECT jobname::text, schedule::text
  FROM cron.job
  WHERE jobname IN (
    'mssql-sync-assets-daily',
    'mssql-sync-pm-schedules-daily',
    'mssql-sync-asset-history-daily',
    'crm-sync-ad-contracts-daily'
  );
$function$;

CREATE OR REPLACE FUNCTION public.set_mssql_cron_schedule(p_job text, p_hour_utc integer, p_minute_utc integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'net'
AS $function$
DECLARE
  v_url text;
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

  v_url := CASE p_job
    WHEN 'mssql-sync-assets-daily'        THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-assets'
    WHEN 'mssql-sync-pm-schedules-daily'  THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-pm-schedules'
    WHEN 'mssql-sync-asset-history-daily' THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-asset-history'
    WHEN 'crm-sync-ad-contracts-daily'    THEN 'https://rmedzljblzngrlsalfsd.supabase.co/functions/v1/sync-ad-contracts'
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
$function$;

SELECT public.set_mssql_cron_schedule('crm-sync-ad-contracts-daily', 21, 30);