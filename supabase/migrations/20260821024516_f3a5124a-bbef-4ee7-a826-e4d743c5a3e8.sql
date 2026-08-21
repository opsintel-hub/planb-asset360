
DELETE FROM public.ad_contracts a USING public.ad_contracts b
WHERE a.id > b.id
  AND coalesce(a.ad_contract,'') = coalesce(b.ad_contract,'')
  AND coalesce(a.asset_old_code,'') = coalesce(b.asset_old_code,'')
  AND coalesce(a.product_name,'') = coalesce(b.product_name,'')
  AND coalesce(a.start_date_contract,'1900-01-01'::date) = coalesce(b.start_date_contract,'1900-01-01'::date);

DROP INDEX IF EXISTS public.ad_contracts_natural_key;

ALTER TABLE public.ad_contracts
  ADD CONSTRAINT ad_contracts_natural_key
  UNIQUE NULLS NOT DISTINCT (ad_contract, asset_old_code, product_name, start_date_contract);
