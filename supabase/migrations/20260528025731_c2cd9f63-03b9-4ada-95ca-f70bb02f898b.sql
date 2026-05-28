
-- Diagram Mappings: ใช้จำแนกหมวดปัญหาใน Interactive Asset Diagram
CREATE TABLE public.diagram_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL UNIQUE,
  label text NOT NULL,
  icon text,
  keywords text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.diagram_mappings TO authenticated;
GRANT ALL ON public.diagram_mappings TO service_role;

ALTER TABLE public.diagram_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY diagram_mappings_select_authenticated
  ON public.diagram_mappings FOR SELECT TO authenticated USING (true);

CREATE POLICY diagram_mappings_admin_all
  ON public.diagram_mappings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_diagram_mappings_updated_at
  BEFORE UPDATE ON public.diagram_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default mappings
INSERT INTO public.diagram_mappings (category, label, icon, keywords, sort_order) VALUES
  ('display',   'Display / Screen',       'Monitor',  ARRAY['display','screen','จอ','led','pixel','panel','ภาพ'], 1),
  ('power',     'Power / Electrical',     'Zap',      ARRAY['power','ไฟฟ้า','การไฟฟ้า','electric','breaker','ไฟดับ','ไฟตก','voltage'], 2),
  ('structure', 'Structure',              'Building', ARRAY['โครงสร้าง','structure','เสา','frame','ป้ายล้ม','โครง','bolt'], 3),
  ('system',    'System / Media Player',  'Cpu',      ARRAY['media player','system','reset','software','ระบบ','firmware','reboot','network','signal'], 4);
