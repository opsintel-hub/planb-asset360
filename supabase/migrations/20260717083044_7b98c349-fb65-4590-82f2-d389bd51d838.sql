
CREATE TABLE public.claim_next_steps (
  ticket_code TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_next_steps TO authenticated;
GRANT ALL ON public.claim_next_steps TO service_role;
ALTER TABLE public.claim_next_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read next steps" ON public.claim_next_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert next steps" ON public.claim_next_steps FOR INSERT TO authenticated WITH CHECK (auth.uid() = updated_by);
CREATE POLICY "Authenticated can update next steps" ON public.claim_next_steps FOR UPDATE TO authenticated USING (true) WITH CHECK (auth.uid() = updated_by);
CREATE POLICY "Authenticated can delete next steps" ON public.claim_next_steps FOR DELETE TO authenticated USING (true);
CREATE TRIGGER update_claim_next_steps_updated_at BEFORE UPDATE ON public.claim_next_steps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
