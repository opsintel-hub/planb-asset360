CREATE INDEX IF NOT EXISTS idx_mssql_ah_cat_created_id_cover
ON public.mssql_asset_history (category, created_date, id)
INCLUDE (old_code, updated_date, status, asset_status, inform_detail, problem_category, problem_detail);

CREATE INDEX IF NOT EXISTS idx_mssql_ah_code_cat_created_id_cover
ON public.mssql_asset_history (old_code, category, created_date, id)
INCLUDE (updated_date, status, asset_status, inform_detail, problem_category, problem_detail);