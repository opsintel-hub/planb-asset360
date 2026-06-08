
-- 1) New snapshot table: 1 ticket = 1 row
CREATE TABLE IF NOT EXISTS public.claim_tickets (
  ref_number       text PRIMARY KEY,
  asset_old_code   text,
  location         text,
  informed_detail  text,
  title            text,
  status           text,
  severity         text,
  opened_at        timestamptz,
  age_hours        numeric,
  sla_status       text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_tickets_asset_old_code ON public.claim_tickets(asset_old_code);
CREATE INDEX IF NOT EXISTS idx_claim_tickets_opened_at ON public.claim_tickets(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_tickets_sla ON public.claim_tickets(sla_status);

GRANT SELECT ON public.claim_tickets TO authenticated;
GRANT ALL ON public.claim_tickets TO service_role;

ALTER TABLE public.claim_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claim_tickets_select_authenticated ON public.claim_tickets;
CREATE POLICY claim_tickets_select_authenticated
  ON public.claim_tickets
  FOR SELECT
  TO authenticated
  USING (true);

-- 2) Convert `claims` into an append-only audit/history log:
--    Drop unique constraints so the same ref_number / asset_old_code can be logged multiple times.
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_ticket_code_key;
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_asset_old_code_key;
