CREATE OR REPLACE FUNCTION public.get_asset_history_counts_360()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH grouped AS (
    SELECT
      h.asset_old_code,
      count(*) FILTER (WHERE h.type = 'Claim')::integer AS claim_count,
      count(*) FILTER (WHERE h.type = 'PM')::integer AS pm_count
    FROM public.mv_pm_history h
    WHERE auth.uid() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
      )
      AND h.asset_old_code IS NOT NULL
      AND h.event_ts >= now() - interval '360 days'
      AND h.type IN ('Claim', 'PM')
    GROUP BY h.asset_old_code
  )
  SELECT COALESCE(
    jsonb_object_agg(
      grouped.asset_old_code,
      jsonb_build_object(
        'claims', grouped.claim_count,
        'pm', grouped.pm_count
      )
    ),
    '{}'::jsonb
  )
  FROM grouped;
$function$;

REVOKE ALL ON FUNCTION public.get_asset_history_counts_360() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_asset_history_counts_360() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_asset_history_counts_360() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_asset_history_counts_360() TO service_role;