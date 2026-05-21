ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS last_history_synced_at timestamptz;
CREATE INDEX IF NOT EXISTS assets_last_history_synced_at_idx ON public.assets (last_history_synced_at NULLS FIRST);

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;