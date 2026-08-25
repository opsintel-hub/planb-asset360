CREATE OR REPLACE VIEW public.assets_map
WITH (security_invoker = true) AS
SELECT
  a.id,
  a.old_code,
  COALESCE(NULLIF(a.name, ''), NULLIF(a.payload->>'Description', '')) AS name,
  a.department,
  a.district,
  a.status,
  COALESCE(NULLIF(a.media_type, ''), NULLIF(a.payload->>'MediaType', '')) AS media_type,
  COALESCE(NULLIF(a.location, ''), NULLIF(a.payload->>'Location', '')) AS location,
  COALESCE(
    a.latitude,
    CASE WHEN a.payload->>'LatitudeLongitude' ~ '^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$'
      THEN btrim(split_part(a.payload->>'LatitudeLongitude', ',', 1))::numeric END
  ) AS latitude,
  COALESCE(
    a.longitude,
    CASE WHEN a.payload->>'LatitudeLongitude' ~ '^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$'
      THEN btrim(split_part(a.payload->>'LatitudeLongitude', ',', 2))::numeric END
  ) AS longitude
FROM public.assets a;

GRANT SELECT ON public.assets_map TO authenticated;
GRANT SELECT ON public.assets_map TO service_role;

GRANT EXECUTE ON FUNCTION public.get_public_schema_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_schema_info() TO service_role;