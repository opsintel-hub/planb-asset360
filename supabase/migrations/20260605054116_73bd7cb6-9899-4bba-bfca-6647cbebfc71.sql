
REVOKE ALL ON public.mv_pm_history FROM authenticated, anon, PUBLIC;
REVOKE ALL ON public.mv_pm_claim_pairs FROM authenticated, anon, PUBLIC;
GRANT ALL ON public.mv_pm_history TO service_role;
GRANT ALL ON public.mv_pm_claim_pairs TO service_role;

REVOKE EXECUTE ON FUNCTION public.refresh_pm_views() FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_pm_views() TO service_role;
