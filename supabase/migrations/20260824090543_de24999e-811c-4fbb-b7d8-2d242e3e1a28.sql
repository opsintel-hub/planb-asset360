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
    NULLIF(split_part(a.payload->>'LatitudeLongitude', ',', 1), '')::numeric
  ) AS latitude,
  COALESCE(
    a.longitude,
    NULLIF(split_part(a.payload->>'LatitudeLongitude', ',', 2), '')::numeric
  ) AS longitude
FROM public.assets a;

GRANT SELECT ON public.assets_map TO authenticated;
GRANT SELECT ON public.assets_map TO service_role;

CREATE OR REPLACE FUNCTION public.get_ad_summary_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH cur AS (
  SELECT asset_old_code, ad_contract, brand,
         upper(regexp_replace(COALESCE(asset_old_code, ''), '[^a-zA-Z0-9]', '', 'g')) AS n
  FROM public.ad_contracts
  WHERE status = 'current'
), av AS (
  SELECT old_code,
         upper(regexp_replace(COALESCE(old_code, ''), '[^a-zA-Z0-9]', '', 'g')) AS n
  FROM public.assets
)
SELECT jsonb_build_object(
  'totalAssets', (SELECT count(*) FROM public.assets),
  'currentContracts', (SELECT count(*) FROM cur),
  'expiring30', (SELECT count(*) FROM public.ad_contracts
                 WHERE status = 'current'
                   AND end_date_contract >= current_date
                   AND end_date_contract <= current_date + 30),
  'occupiedAssets', (SELECT count(DISTINCT av.old_code) FROM cur JOIN av ON av.n = cur.n WHERE cur.n <> ''),
  'activeContracts', (SELECT count(DISTINCT ad_contract) FROM cur WHERE ad_contract IS NOT NULL),
  'activeBrands', (SELECT count(DISTINCT brand) FROM cur WHERE brand IS NOT NULL),
  'crmUnmatchedAssets', (SELECT count(*) FROM cur WHERE cur.n <> '' AND NOT EXISTS (SELECT 1 FROM av WHERE av.n = cur.n))
);
$$;

GRANT EXECUTE ON FUNCTION public.get_ad_summary_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ad_summary_stats() TO service_role;