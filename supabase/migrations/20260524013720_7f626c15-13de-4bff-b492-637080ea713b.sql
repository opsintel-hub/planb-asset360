-- Switch the unique key on claims from ticket_code to asset_old_code so that
-- upserts collapse multiple claim tickets per asset into one row (latest state).
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_ticket_code_key;
-- Deduplicate any existing rows keeping the most recent per asset_old_code
DELETE FROM public.claims c USING public.claims c2
 WHERE c.asset_old_code IS NOT NULL
   AND c.asset_old_code = c2.asset_old_code
   AND c.synced_at < c2.synced_at;
-- Make sure asset_old_code is unique going forward
CREATE UNIQUE INDEX IF NOT EXISTS claims_asset_old_code_key ON public.claims(asset_old_code);
