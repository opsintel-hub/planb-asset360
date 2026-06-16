REVOKE ALL ON public.mv_pm_history FROM anon, authenticated;
REVOKE ALL ON public.mv_pm_claim_pairs FROM anon, authenticated;
GRANT SELECT ON public.mv_pm_history TO service_role;
GRANT SELECT ON public.mv_pm_claim_pairs TO service_role;