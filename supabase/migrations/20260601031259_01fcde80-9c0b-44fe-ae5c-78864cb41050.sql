CREATE TABLE public.asset_pm_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project text,
  asset_old_code text,
  ref_number text,
  schedule_date timestamptz,
  status text,
  inform_position text,
  asset_status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_pm_schedules_old_code ON public.asset_pm_schedules(asset_old_code);
CREATE INDEX idx_asset_pm_schedules_schedule_date ON public.asset_pm_schedules(schedule_date);
CREATE UNIQUE INDEX uniq_asset_pm_schedules_natkey
  ON public.asset_pm_schedules(COALESCE(ref_number,''), COALESCE(asset_old_code,''), COALESCE(schedule_date, 'epoch'::timestamptz));

GRANT SELECT ON public.asset_pm_schedules TO authenticated;
GRANT ALL ON public.asset_pm_schedules TO service_role;

ALTER TABLE public.asset_pm_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asset_pm_schedules_select_authenticated"
  ON public.asset_pm_schedules
  FOR SELECT
  TO authenticated
  USING (true);
