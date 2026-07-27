CREATE TABLE public.poi_shares (
  token text PRIMARY KEY,
  payload jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

GRANT SELECT ON public.poi_shares TO anon;
GRANT SELECT, INSERT, DELETE ON public.poi_shares TO authenticated;
GRANT ALL ON public.poi_shares TO service_role;

ALTER TABLE public.poi_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read unexpired shares"
  ON public.poi_shares FOR SELECT TO anon
  USING (expires_at > now());

CREATE POLICY "auth can read unexpired shares"
  ON public.poi_shares FOR SELECT TO authenticated
  USING (expires_at > now());

CREATE POLICY "auth can create own shares"
  ON public.poi_shares FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "auth can delete own shares"
  ON public.poi_shares FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_poi_shares_expires_at ON public.poi_shares (expires_at);