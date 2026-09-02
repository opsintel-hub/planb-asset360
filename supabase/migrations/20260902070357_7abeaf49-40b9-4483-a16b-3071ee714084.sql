DROP POLICY IF EXISTS user_roles_block_non_admin_writes ON public.user_roles;

CREATE POLICY user_roles_block_non_admin_insert ON public.user_roles
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY user_roles_block_non_admin_update ON public.user_roles
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY user_roles_block_non_admin_delete ON public.user_roles
  AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT ON public.user_roles TO authenticated;