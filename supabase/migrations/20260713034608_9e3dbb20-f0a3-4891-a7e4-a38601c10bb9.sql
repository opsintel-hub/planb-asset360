
CREATE TABLE public.billboard_mockups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_code text NOT NULL,
  storage_path text NOT NULL,
  image_url text NOT NULL,
  title text,
  note text,
  overlay jsonb NOT NULL DEFAULT '{"x":25,"y":30,"w":50,"h":25,"opacity":0.85,"rotation":0}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_billboard_mockups_old_code ON public.billboard_mockups(old_code);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billboard_mockups TO authenticated;
GRANT ALL ON public.billboard_mockups TO service_role;

ALTER TABLE public.billboard_mockups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users can view mockups" ON public.billboard_mockups
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth users can insert mockups" ON public.billboard_mockups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth users can update mockups" ON public.billboard_mockups
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth users can delete mockups" ON public.billboard_mockups
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_billboard_mockups_updated_at
  BEFORE UPDATE ON public.billboard_mockups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
