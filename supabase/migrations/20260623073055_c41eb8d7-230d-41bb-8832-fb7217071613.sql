
ALTER TABLE public.mssql_asset_history
  DROP CONSTRAINT IF EXISTS mssql_asset_history_natural_key;

ALTER TABLE public.mssql_asset_history
  ADD CONSTRAINT mssql_asset_history_natural_key
  UNIQUE NULLS NOT DISTINCT (ref_number, old_code);
