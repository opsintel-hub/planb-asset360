CREATE OR REPLACE FUNCTION public.get_asset_history_360(_asset_code text)
RETURNS TABLE (
  ref_number text,
  event_type text,
  event_ts timestamptz,
  status text,
  problem_category text,
  problem_equipment text,
  solution_detail text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.ref_number, h.type, h.event_ts, h.status, h.problem_category, h.problem_equipment, h.solution_detail
  FROM public.mv_pm_history h
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid())
    AND h.asset_old_code = btrim(_asset_code)
    AND h.type IN ('Claim', 'PM')
    AND h.event_ts >= now() - interval '360 days'
  ORDER BY h.event_ts DESC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.get_asset_history_360(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_asset_history_360(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_asset_history_360(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_asset_history_360(text) TO service_role;