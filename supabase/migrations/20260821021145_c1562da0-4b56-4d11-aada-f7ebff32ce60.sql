DROP POLICY IF EXISTS app_settings_select_authenticated ON public.app_settings;
CREATE POLICY app_settings_select_non_sensitive ON public.app_settings
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR key NOT IN (
    'asset_db_config',
    'asset_db_connection',
    'asset_api_url',
    'asset_gateway_url',
    'asset_history_endpoint',
    'claim_api_url'
  )
);

DROP POLICY IF EXISTS "Authenticated can insert next steps" ON public.claim_next_steps;
CREATE POLICY "Authenticated can insert own next steps" ON public.claim_next_steps
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = updated_by OR has_role(auth.uid(), 'admin'::app_role));