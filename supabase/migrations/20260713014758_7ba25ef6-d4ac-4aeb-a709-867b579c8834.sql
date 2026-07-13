
UPDATE public.assets
SET latitude = split_part(payload->>'LatitudeLongitude', ',', 1)::numeric,
    longitude = split_part(payload->>'LatitudeLongitude', ',', 2)::numeric
WHERE (latitude IS NULL OR longitude IS NULL)
  AND payload ? 'LatitudeLongitude'
  AND payload->>'LatitudeLongitude' ~ '^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$';

CREATE INDEX IF NOT EXISTS assets_lat_lng_idx ON public.assets (latitude, longitude);
