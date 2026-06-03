CREATE TABLE public.informed_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  informed text NOT NULL,
  impact_level text NOT NULL,
  informed_group text,
  team text,
  informed_detail text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_informed_mapping_informed ON public.informed_mapping (informed);
CREATE INDEX idx_informed_mapping_impact ON public.informed_mapping (impact_level);
CREATE INDEX idx_informed_mapping_group ON public.informed_mapping (informed_group);

GRANT SELECT ON public.informed_mapping TO authenticated;
GRANT ALL ON public.informed_mapping TO service_role;

ALTER TABLE public.informed_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "informed_mapping_select_authenticated"
ON public.informed_mapping FOR SELECT TO authenticated USING (true);

CREATE POLICY "informed_mapping_admin_all"
ON public.informed_mapping FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_informed_mapping_updated_at
BEFORE UPDATE ON public.informed_mapping
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();