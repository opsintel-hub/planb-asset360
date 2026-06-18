
REVOKE EXECUTE ON FUNCTION public.get_mssql_cron_schedules() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, int, int) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mssql_cron_schedules() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, int, int) TO service_role;
