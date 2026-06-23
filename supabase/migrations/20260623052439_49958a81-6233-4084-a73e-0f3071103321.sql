ALTER TABLE public.mssql_asset_history ADD COLUMN IF NOT EXISTS ref_number text;
CREATE INDEX IF NOT EXISTS idx_mssql_ah_ref_number ON public.mssql_asset_history (ref_number);