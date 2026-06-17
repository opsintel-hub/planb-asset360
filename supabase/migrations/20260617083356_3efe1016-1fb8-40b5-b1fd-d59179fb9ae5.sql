-- Replace expression-based unique index with a plain unique constraint so
-- PostgREST upsert(onConflict: "asset_old_code,action_date,status") works.
-- Postgres 15+ NULLS NOT DISTINCT preserves the original null-safe semantics.

DROP INDEX IF EXISTS public.mssql_asset_history_natural_key;

-- Deduplicate any existing rows that would violate the new constraint
-- (keep the latest synced_at per natural key).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY asset_old_code, action_date, status
           ORDER BY synced_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.mssql_asset_history
)
DELETE FROM public.mssql_asset_history h
USING ranked r
WHERE h.id = r.id AND r.rn > 1;

ALTER TABLE public.mssql_asset_history
  ADD CONSTRAINT mssql_asset_history_natural_key
  UNIQUE NULLS NOT DISTINCT (asset_old_code, action_date, status);