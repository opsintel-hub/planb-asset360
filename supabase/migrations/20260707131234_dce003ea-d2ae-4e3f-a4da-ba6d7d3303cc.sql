
-- Revoke public/anon EXECUTE on SECURITY DEFINER functions to prevent anonymous callers
-- from invoking privileged functions via the Data API.

-- Trigger functions: no direct callers needed
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- has_role: used inside RLS policies (executed via SECURITY DEFINER context automatically).
-- Keep authenticated so app RLS checks work; block anon and PUBLIC.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Admin-only maintenance / cron management: only service_role
REVOKE EXECUTE ON FUNCTION public.refresh_pm_views() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pm_views() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_mssql_cron_schedules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mssql_cron_schedules() TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_mssql_cron_schedule(text, integer, integer) TO service_role;

-- Schema introspection: called by authenticated server function
REVOKE EXECUTE ON FUNCTION public.get_public_schema_info() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_schema_info() TO authenticated, service_role;
