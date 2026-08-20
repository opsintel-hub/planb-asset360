REVOKE EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, integer, integer) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.get_mssql_cron_schedules() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_mssql_cron_schedules() TO service_role;