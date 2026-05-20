
-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin','manager','technician','viewer');

-- update_updated_at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "user_roles_select_self_or_admin" ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Assets
CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_code TEXT NOT NULL UNIQUE,
  name TEXT,
  department TEXT,
  area TEXT,
  status TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  installed_at DATE,
  last_pm_at TIMESTAMPTZ,
  last_claim_at TIMESTAMPTZ,
  last_monitor_ok_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets_select_authenticated" ON public.assets FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_assets_dept ON public.assets(department);
CREATE INDEX idx_assets_status ON public.assets(status);
CREATE TRIGGER trg_assets_updated_at BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Asset history
CREATE TABLE public.asset_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE,
  asset_old_code TEXT,
  ticket_code TEXT,
  type TEXT NOT NULL CHECK (type IN ('PM','Claim','Monitor','AssetHealth')),
  title TEXT,
  status TEXT,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  sla_hours NUMERIC,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticket_code, type)
);
ALTER TABLE public.asset_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asset_history_select_authenticated" ON public.asset_history FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_history_asset ON public.asset_history(asset_id);
CREATE INDEX idx_history_type_time ON public.asset_history(type, opened_at DESC);

-- Claims
CREATE TABLE public.claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code TEXT NOT NULL UNIQUE,
  asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  asset_old_code TEXT,
  title TEXT,
  opened_at TIMESTAMPTZ,
  age_hours NUMERIC,
  sla_status TEXT,
  severity TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claims_select_authenticated" ON public.claims FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_claims_sla ON public.claims(sla_status);

-- Monitoring status
CREATE TABLE public.monitoring_status (
  asset_id UUID PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  asset_old_code TEXT,
  online BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  uptime_7d NUMERIC,
  error_code TEXT,
  message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.monitoring_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "monitoring_select_authenticated" ON public.monitoring_status FOR SELECT TO authenticated USING (true);

-- Airtable connections (8 slots)
CREATE TABLE public.airtable_connections (
  id SMALLINT PRIMARY KEY CHECK (id BETWEEN 1 AND 8),
  name TEXT,
  base_id TEXT,
  table_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.airtable_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "airtable_admin_all" ON public.airtable_connections FOR ALL
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_airtable_updated_at BEFORE UPDATE ON public.airtable_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.airtable_connections (id, name) 
SELECT g, NULL FROM generate_series(1,8) g;

-- Sync logs
CREATE TABLE public.sync_logs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','warning','error','running')),
  message TEXT,
  rows_affected INT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_logs_select_authenticated" ON public.sync_logs FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_sync_logs_time ON public.sync_logs(started_at DESC);

-- App settings (key/value)
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_select_authenticated" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_admin_write" ON public.app_settings FOR ALL
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_settings (key, value) VALUES
  ('asset_api_url', '"https://uat-magicticket.magicsigncloud.com/planb_api/api/Ticket/AssetHistory?oldCode={id}"'::jsonb),
  ('claim_api_url', '"https://magicticket.magicsigncloud.com/planb_api/api/Ticket/RemainingClaimTickets"'::jsonb),
  ('asset_db_config', '{"server":"magicticket.magicsigncloud.com","database":"planb","user":"planb_viewer","table":"Asset"}'::jsonb),
  ('asset_sync_days', '[1,15]'::jsonb),
  ('claim_auto_sync', 'true'::jsonb);
