CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id) $$;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid) TO authenticated;

ALTER POLICY "ad_contracts_read_authenticated" ON public.ad_contracts USING (public.has_any_role(auth.uid()));
ALTER POLICY "diagram_mappings_select_authenticated" ON public.diagram_mappings USING (public.has_any_role(auth.uid()));
ALTER POLICY "monitoring_select_authenticated" ON public.monitoring_status USING (public.has_any_role(auth.uid()));
ALTER POLICY "assets_select_authenticated" ON public.assets USING (public.has_any_role(auth.uid()));
ALTER POLICY "Authenticated can read next steps" ON public.claim_next_steps USING (public.has_any_role(auth.uid()));
ALTER POLICY "informed_mapping_select_authenticated" ON public.informed_mapping USING (public.has_any_role(auth.uid()));
ALTER POLICY "Authenticated can read risk scores" ON public.asset_risk_scores USING (public.has_any_role(auth.uid()));
ALTER POLICY "claims_select_authenticated" ON public.claims USING (public.has_any_role(auth.uid()));