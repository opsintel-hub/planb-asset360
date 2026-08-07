CREATE TABLE public.asset_risk_scores (
  asset_old_code text PRIMARY KEY,
  risk_level text NOT NULL DEFAULT 'low',
  score integer NOT NULL DEFAULT 0,
  claims_30d integer NOT NULL DEFAULT 0,
  claims_90d integer NOT NULL DEFAULT 0,
  claims_365d integer NOT NULL DEFAULT 0,
  open_claims integer NOT NULL DEFAULT 0,
  last_claim_at timestamptz,
  last_pm_at timestamptz,
  days_since_pm integer,
  top_problem text,
  department text,
  media_type text,
  district text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.asset_risk_scores TO authenticated;
GRANT ALL ON public.asset_risk_scores TO service_role;

ALTER TABLE public.asset_risk_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read risk scores"
  ON public.asset_risk_scores FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_asset_risk_scores_level ON public.asset_risk_scores (risk_level);
CREATE INDEX idx_asset_risk_scores_score ON public.asset_risk_scores (score DESC);

CREATE TRIGGER trg_asset_risk_scores_updated_at
  BEFORE UPDATE ON public.asset_risk_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.recompute_asset_risk_scores()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  WITH claim_hist AS (
    SELECT
      h.old_code,
      count(*) FILTER (WHERE h.created_date > now() - interval '30 days')  AS c30,
      count(*) FILTER (WHERE h.created_date > now() - interval '90 days')  AS c90,
      count(*) FILTER (WHERE h.created_date > now() - interval '365 days') AS c365,
      max(h.created_date) AS last_claim_at
    FROM public.mssql_asset_history h
    WHERE h.category = 'Claim' AND h.old_code IS NOT NULL
    GROUP BY h.old_code
  ),
  top_prob AS (
    SELECT DISTINCT ON (h.old_code)
      h.old_code,
      NULLIF(h.problem_category, '') AS top_problem
    FROM public.mssql_asset_history h
    WHERE h.category = 'Claim'
      AND h.old_code IS NOT NULL
      AND NULLIF(h.problem_category, '') IS NOT NULL
      AND h.created_date > now() - interval '365 days'
    GROUP BY h.old_code, NULLIF(h.problem_category, '')
    ORDER BY h.old_code, count(*) DESC
  ),
  open_cl AS (
    SELECT t.asset_old_code AS old_code, count(*) AS open_claims
    FROM public.claim_tickets t
    WHERE t.asset_old_code IS NOT NULL
    GROUP BY t.asset_old_code
  ),
  pm AS (
    SELECT p.asset_old_code AS old_code, max(p.event_ts) AS last_pm_at
    FROM public.mv_pm_history p
    WHERE p.type = 'PM' AND p.asset_old_code IS NOT NULL
    GROUP BY p.asset_old_code
  ),
  calc AS (
    SELECT
      a.old_code,
      COALESCE(ch.c30, 0)::int    AS claims_30d,
      COALESCE(ch.c90, 0)::int    AS claims_90d,
      COALESCE(ch.c365, 0)::int   AS claims_365d,
      COALESCE(oc.open_claims, 0)::int AS open_claims,
      ch.last_claim_at,
      pm.last_pm_at,
      CASE WHEN pm.last_pm_at IS NULL THEN NULL
           ELSE GREATEST(0, (EXTRACT(epoch FROM (now() - pm.last_pm_at)) / 86400)::int)
      END AS days_since_pm,
      tp.top_problem,
      a.department,
      a.media_type,
      a.district
    FROM public.assets a
    LEFT JOIN claim_hist ch ON ch.old_code = a.old_code
    LEFT JOIN top_prob  tp ON tp.old_code = a.old_code
    LEFT JOIN open_cl   oc ON oc.old_code = a.old_code
    LEFT JOIN pm            ON pm.old_code = a.old_code
    WHERE a.old_code IS NOT NULL
  ),
  scored AS (
    SELECT c.*,
      LEAST(100, ROUND(
          40 * (CASE WHEN c.open_claims > 0 THEN 1 ELSE 0 END)
        + 25 * (LEAST(c.claims_30d, 2)::numeric / 2)
        + 15 * (LEAST(c.claims_90d, 4)::numeric / 4)
        + 10 * (LEAST(c.claims_365d, 8)::numeric / 8)
        + 10 * (LEAST(COALESCE(c.days_since_pm, 0), 180)::numeric / 180)
      ))::int AS score
    FROM calc c
  )
  INSERT INTO public.asset_risk_scores AS t (
    asset_old_code, risk_level, score, claims_30d, claims_90d, claims_365d,
    open_claims, last_claim_at, last_pm_at, days_since_pm, top_problem,
    department, media_type, district, computed_at, updated_at
  )
  SELECT
    s.old_code,
    CASE WHEN s.score >= 60 THEN 'high' WHEN s.score >= 25 THEN 'medium' ELSE 'low' END,
    s.score, s.claims_30d, s.claims_90d, s.claims_365d, s.open_claims,
    s.last_claim_at, s.last_pm_at, s.days_since_pm, s.top_problem,
    s.department, s.media_type, s.district, now(), now()
  FROM scored s
  ON CONFLICT (asset_old_code) DO UPDATE SET
    risk_level    = EXCLUDED.risk_level,
    score         = EXCLUDED.score,
    claims_30d    = EXCLUDED.claims_30d,
    claims_90d    = EXCLUDED.claims_90d,
    claims_365d   = EXCLUDED.claims_365d,
    open_claims   = EXCLUDED.open_claims,
    last_claim_at = EXCLUDED.last_claim_at,
    last_pm_at    = EXCLUDED.last_pm_at,
    days_since_pm = EXCLUDED.days_since_pm,
    top_problem   = EXCLUDED.top_problem,
    department    = EXCLUDED.department,
    media_type    = EXCLUDED.media_type,
    district      = EXCLUDED.district,
    computed_at   = now(),
    updated_at    = now();

  SELECT count(*) INTO v_rows FROM public.asset_risk_scores;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_asset_risk_scores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_asset_risk_scores() TO service_role;

SELECT public.recompute_asset_risk_scores();