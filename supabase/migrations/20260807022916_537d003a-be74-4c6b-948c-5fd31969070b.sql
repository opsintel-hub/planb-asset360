REVOKE ALL ON FUNCTION public.recompute_asset_risk_scores() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_asset_risk_scores() TO service_role;