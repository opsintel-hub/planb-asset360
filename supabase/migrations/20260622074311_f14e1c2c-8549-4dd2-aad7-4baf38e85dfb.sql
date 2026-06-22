ALTER TABLE public.mssql_asset_history
  DROP CONSTRAINT IF EXISTS mssql_asset_history_natural_key;

ALTER TABLE public.mssql_asset_history
  ADD CONSTRAINT mssql_asset_history_natural_key
  UNIQUE NULLS NOT DISTINCT (old_code, created_date, updated_date, category, status);