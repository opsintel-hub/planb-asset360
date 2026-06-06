-- Lock down refresh_pm_views: only service_role/postgres can call it
REVOKE EXECUTE ON FUNCTION public.refresh_pm_views() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pm_views() TO service_role;

-- Harden user_roles: explicit restrictive policy preventing non-admin self-promotion.
-- The existing user_roles_admin_all policy gates writes via has_role(auth.uid(), 'admin').
-- Add a RESTRICTIVE policy as defense-in-depth so a future permissive policy can't open a hole.
CREATE POLICY user_roles_block_non_admin_writes
  ON public.user_roles
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));