-- Phase A1: promote key payload fields to real columns for fast filtering

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS bkkupc     text,
  ADD COLUMN IF NOT EXISTS district   text,
  ADD COLUMN IF NOT EXISTS territory  text,
  ADD COLUMN IF NOT EXISTS location   text,
  ADD COLUMN IF NOT EXISTS media_type text;

-- Backfill from existing payload
UPDATE public.assets SET
  bkkupc     = NULLIF(payload->>'BKKUPC', ''),
  district   = NULLIF(payload->>'District', ''),
  territory  = NULLIF(payload->>'Territory', ''),
  location   = NULLIF(payload->>'Location', ''),
  media_type = NULLIF(payload->>'MediaType', '');

-- Indexes for filter columns
CREATE INDEX IF NOT EXISTS assets_bkkupc_idx      ON public.assets (bkkupc);
CREATE INDEX IF NOT EXISTS assets_district_idx    ON public.assets (district);
CREATE INDEX IF NOT EXISTS assets_territory_idx   ON public.assets (territory);
CREATE INDEX IF NOT EXISTS assets_media_type_idx  ON public.assets (media_type);
CREATE INDEX IF NOT EXISTS assets_department_idx  ON public.assets (department);
CREATE INDEX IF NOT EXISTS assets_lat_lng_idx     ON public.assets (latitude, longitude);

-- Trigram index for location typeahead (7k+ unique values)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS assets_location_trgm_idx
  ON public.assets USING gin (location gin_trgm_ops);