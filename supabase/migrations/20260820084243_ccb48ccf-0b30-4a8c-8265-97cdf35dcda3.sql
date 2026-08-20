CREATE TABLE public.route_deferred_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_old_code text NOT NULL,
  plan_name text,
  inspector_index integer,
  inspector_name text,
  day_index integer,
  reason text,
  risk_level text,
  deferred_at timestamp with time zone NOT NULL DEFAULT now(),
  cleared_at timestamp with time zone,
  created_by uuid NOT NULL DEFAULT auth.uid()
);

CREATE INDEX route_deferred_assets_open_idx ON public.route_deferred_assets (created_by, cleared_at);
CREATE INDEX route_deferred_assets_code_idx ON public.route_deferred_assets (asset_old_code);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_deferred_assets TO authenticated;
GRANT ALL ON public.route_deferred_assets TO service_role;

ALTER TABLE public.route_deferred_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deferred_select_own_or_admin" ON public.route_deferred_assets
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "deferred_insert_own" ON public.route_deferred_assets
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "deferred_update_own_or_admin" ON public.route_deferred_assets
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "deferred_delete_own_or_admin" ON public.route_deferred_assets
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));