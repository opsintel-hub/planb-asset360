TRUNCATE TABLE public.mssql_asset_history;
UPDATE public.sync_logs SET status='error', message=COALESCE(message,'')||' [aborted: cursor stuck loop]', finished_at=now()
WHERE source='mssql_asset_history' AND status='running';