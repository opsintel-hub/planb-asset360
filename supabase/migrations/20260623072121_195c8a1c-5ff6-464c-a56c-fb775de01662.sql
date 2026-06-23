REVOKE EXECUTE ON FUNCTION public.refresh_pm_views() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pm_views() TO service_role;