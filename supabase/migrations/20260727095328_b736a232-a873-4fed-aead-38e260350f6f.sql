-- Remove broad anon SELECT that allowed reading any unexpired row
DROP POLICY IF EXISTS "anon can read unexpired shares" ON public.poi_shares;

-- Dedicated token-scoped lookup, callable by anon, no broad table read
CREATE OR REPLACE FUNCTION public.get_poi_share(_token text)
RETURNS TABLE(payload jsonb, expires_at timestamptz, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT payload, expires_at, created_at
  FROM public.poi_shares
  WHERE token = _token
    AND expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_poi_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_poi_share(text) TO anon, authenticated;
