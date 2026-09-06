-- 1) Scope broad operational reads to users who actually have a role assigned
DROP POLICY IF EXISTS asset_pm_schedules_select_authenticated ON public.asset_pm_schedules;
CREATE POLICY asset_pm_schedules_select_roled ON public.asset_pm_schedules
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

DROP POLICY IF EXISTS claim_tickets_select_authenticated ON public.claim_tickets;
CREATE POLICY claim_tickets_select_roled ON public.claim_tickets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

DROP POLICY IF EXISTS mssql_asset_history_select_authenticated ON public.mssql_asset_history;
CREATE POLICY mssql_asset_history_select_roled ON public.mssql_asset_history
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

-- 2) Sync logs: admins and managers only
DROP POLICY IF EXISTS sync_logs_select_authenticated ON public.sync_logs;
CREATE POLICY sync_logs_select_admin ON public.sync_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- 3) internal_config: explicit admin-only read (writes stay service_role only)
DROP POLICY IF EXISTS internal_config_select_admin ON public.internal_config;
CREATE POLICY internal_config_select_admin ON public.internal_config
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) Usage analytics functions must not be callable anonymously
REVOKE EXECUTE ON FUNCTION public.get_usage_analytics(timestamptz, timestamptz, uuid, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_usage_detail(uuid, timestamptz, timestamptz) FROM anon;