
CREATE TABLE public.map_saved_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_saved_locations TO authenticated;
GRANT ALL ON public.map_saved_locations TO service_role;
ALTER TABLE public.map_saved_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own or shared locations" ON public.map_saved_locations
  FOR SELECT TO authenticated
  USING (is_shared = true OR auth.uid() = user_id);
CREATE POLICY "insert own locations" ON public.map_saved_locations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (is_shared = false OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "update own locations, shared only by admin" ON public.map_saved_locations
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR (is_shared = true AND public.has_role(auth.uid(), 'admin')))
  WITH CHECK (auth.uid() = user_id OR (is_shared = true AND public.has_role(auth.uid(), 'admin')));
CREATE POLICY "delete own locations, shared only by admin" ON public.map_saved_locations
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR (is_shared = true AND public.has_role(auth.uid(), 'admin')));

CREATE TRIGGER update_map_saved_locations_updated_at
  BEFORE UPDATE ON public.map_saved_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.map_saved_routes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'corridor',
  origin JSONB,
  waypoints JSONB NOT NULL DEFAULT '[]'::jsonb,
  road_polyline JSONB,
  radius_m INTEGER NOT NULL DEFAULT 200,
  notes TEXT,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_saved_routes TO authenticated;
GRANT ALL ON public.map_saved_routes TO service_role;
ALTER TABLE public.map_saved_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own or shared routes" ON public.map_saved_routes
  FOR SELECT TO authenticated
  USING (is_shared = true OR auth.uid() = user_id);
CREATE POLICY "insert own routes" ON public.map_saved_routes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own routes" ON public.map_saved_routes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own routes" ON public.map_saved_routes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_map_saved_routes_updated_at
  BEFORE UPDATE ON public.map_saved_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
