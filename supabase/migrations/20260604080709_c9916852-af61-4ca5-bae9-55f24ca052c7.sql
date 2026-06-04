CREATE TABLE public.mssql_asset_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_old_code text,
  ref_number text,
  action_date timestamptz,
  action text,
  status text,
  project text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mssql_asset_history_old_code ON public.mssql_asset_history (asset_old_code);
CREATE INDEX idx_mssql_asset_history_ref ON public.mssql_asset_history (ref_number);
CREATE INDEX idx_mssql_asset_history_action_date ON public.mssql_asset_history (action_date);

GRANT SELECT ON public.mssql_asset_history TO authenticated;
GRANT ALL ON public.mssql_asset_history TO service_role;

ALTER TABLE public.mssql_asset_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY mssql_asset_history_select_authenticated
  ON public.mssql_asset_history FOR SELECT
  TO authenticated USING (true);