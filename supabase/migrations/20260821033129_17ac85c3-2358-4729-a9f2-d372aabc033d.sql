ALTER TABLE public.ad_contracts
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS brand_eng text,
  ADD COLUMN IF NOT EXISTS package_name text,
  ADD COLUMN IF NOT EXISTS package_code text;

UPDATE public.ad_contracts SET
  brand = NULLIF(btrim(payload->>'brand'), ''),
  brand_eng = NULLIF(btrim(payload->>'brand_eng'), ''),
  package_name = NULLIF(btrim(payload->>'package_name'), ''),
  package_code = NULLIF(btrim(payload->>'package_code'), '')
WHERE brand IS NULL AND brand_eng IS NULL AND package_name IS NULL AND package_code IS NULL;

CREATE INDEX IF NOT EXISTS ad_contracts_brand_idx ON public.ad_contracts (brand);
CREATE INDEX IF NOT EXISTS ad_contracts_brand_eng_idx ON public.ad_contracts (brand_eng);

DROP VIEW IF EXISTS public.ad_current_by_asset;
CREATE VIEW public.ad_current_by_asset
WITH (security_invoker = true) AS
  SELECT DISTINCT ON (asset_old_code) asset_old_code,
     product_name,
     brand,
     brand_eng,
     package_name,
     package_code,
     ad_contract,
     equipment_id,
     start_date_contract,
     end_date_contract,
     favor_start_date_contract,
     favor_end_date_contract,
     status,
     end_date_contract - CURRENT_DATE AS days_to_end
    FROM public.ad_contracts c
   WHERE status = 'current'::text AND asset_old_code IS NOT NULL AND (end_date_contract IS NULL OR end_date_contract >= CURRENT_DATE)
   ORDER BY asset_old_code, end_date_contract DESC NULLS LAST, start_date_contract DESC NULLS LAST;

GRANT SELECT ON public.ad_current_by_asset TO authenticated;