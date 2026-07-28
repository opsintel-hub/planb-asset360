
REVOKE EXECUTE ON FUNCTION public.get_poi_share(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_poi_share(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_public_schema_info() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_schema_info() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_mssql_cron_schedules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mssql_cron_schedules() TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refresh_pm_views() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pm_views() TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
