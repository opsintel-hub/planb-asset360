-- Dedupe existing rows first so unique index can be created
DELETE FROM public.mssql_asset_history a USING public.mssql_asset_history b
WHERE a.ctid < b.ctid
  AND COALESCE(a.asset_old_code,'') = COALESCE(b.asset_old_code,'')
  AND COALESCE(a.action_date,'epoch'::timestamptz) = COALESCE(b.action_date,'epoch'::timestamptz)
  AND COALESCE(a.status,'') = COALESCE(b.status,'');

CREATE UNIQUE INDEX IF NOT EXISTS mssql_asset_history_natural_key
ON public.mssql_asset_history (
  (COALESCE(asset_old_code, '')),
  (COALESCE(action_date, 'epoch'::timestamptz)),
  (COALESCE(status, ''))
);