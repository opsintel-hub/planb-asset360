ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_asset_old_code_key;
ALTER TABLE public.claims ADD CONSTRAINT claims_ticket_code_key UNIQUE (ticket_code);
CREATE INDEX IF NOT EXISTS idx_claims_asset_old_code ON public.claims (asset_old_code);
CREATE INDEX IF NOT EXISTS idx_claims_opened_at ON public.claims (opened_at DESC);