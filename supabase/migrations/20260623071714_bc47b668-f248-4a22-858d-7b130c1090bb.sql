REVOKE SELECT ON public.mv_pm_history FROM authenticated;
REVOKE SELECT ON public.mv_pm_claim_pairs FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_pm_views() FROM authenticated;

GRANT ALL ON public.mv_pm_history TO service_role;
GRANT ALL ON public.mv_pm_claim_pairs TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_pm_views() TO service_role;