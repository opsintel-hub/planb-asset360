
-- ============================================================
-- mv_pm_history: deduped PM/Claim history joined with assets
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS public.mv_pm_claim_pairs;
DROP MATERIALIZED VIEW IF EXISTS public.mv_pm_history;

CREATE MATERIALIZED VIEW public.mv_pm_history AS
SELECT DISTINCT ON (h.ref_number)
  h.ref_number,
  h.asset_old_code,
  NULLIF(h.payload->>'CreatedDate','')::timestamptz AS created_at,
  NULLIF(h.payload->>'UpdatedDate','')::timestamptz AS updated_at,
  COALESCE(
    NULLIF(h.payload->>'UpdatedDate','')::timestamptz,
    NULLIF(h.payload->>'CreatedDate','')::timestamptz,
    h.action_date
  ) AS event_ts,
  h.payload->>'Category' AS category,
  CASE WHEN h.payload->>'Category' = 'Claim' THEN 'Claim' ELSE 'PM' END AS type,
  COALESCE(NULLIF(h.payload->>'Project',''), h.project) AS project,
  h.payload->>'MediaType' AS media_type,
  h.payload->>'BKKUPC' AS bkk_upc,
  h.payload->>'AssetStatus' AS asset_status,
  COALESCE(NULLIF(h.payload->>'Status',''), h.status) AS status,
  h.payload->>'ProblemCategory' AS problem_category,
  h.payload->>'ProblemDetail' AS problem_detail,
  h.payload->>'ProblemEquipment' AS problem_equipment,
  h.payload->>'SolutionCategory' AS solution_category,
  h.payload->>'SolutionDetail' AS solution_detail,
  COALESCE((h.payload->>'TotalTurnaroundTime')::numeric, 0) AS total_turnaround_time,
  a.department AS asset_department,
  a.payload->>'MediaType' AS asset_media_type
FROM public.mssql_asset_history h
LEFT JOIN public.assets a ON a.old_code = h.asset_old_code
WHERE h.payload->>'Category' IN ('PM (Media)', 'PM (non Media)', 'Claim')
  AND h.ref_number IS NOT NULL AND h.ref_number <> ''
ORDER BY h.ref_number, h.action_date DESC NULLS LAST, h.id DESC;

CREATE UNIQUE INDEX mv_pm_history_ref_idx ON public.mv_pm_history (ref_number);
CREATE INDEX mv_pm_history_asset_idx ON public.mv_pm_history (asset_old_code);
CREATE INDEX mv_pm_history_event_idx ON public.mv_pm_history (event_ts);
CREATE INDEX mv_pm_history_type_idx ON public.mv_pm_history (type);

GRANT SELECT ON public.mv_pm_history TO authenticated;
GRANT ALL ON public.mv_pm_history TO service_role;

-- ============================================================
-- mv_pm_claim_pairs: PM(Pass) -> next Claim per asset
-- ============================================================
CREATE MATERIALIZED VIEW public.mv_pm_claim_pairs AS
WITH pm AS (
  SELECT
    asset_old_code,
    ref_number AS pm_ref,
    category AS pm_category,
    COALESCE(updated_at, created_at, event_ts) AS pm_end_ts,
    media_type AS pm_media_type,
    asset_media_type,
    asset_department,
    bkk_upc AS pm_bkk_upc,
    project AS pm_project
  FROM public.mv_pm_history
  WHERE type = 'PM' AND asset_status = 'Pass'
    AND COALESCE(updated_at, created_at, event_ts) IS NOT NULL
),
claim AS (
  SELECT
    asset_old_code,
    ref_number AS claim_ref,
    COALESCE(created_at, event_ts) AS claim_ts,
    bkk_upc, project,
    problem_category, problem_detail, problem_equipment,
    solution_category, solution_detail
  FROM public.mv_pm_history
  WHERE type = 'Claim'
    AND COALESCE(created_at, event_ts) IS NOT NULL
),
joined AS (
  SELECT
    pm.*,
    c.claim_ref,
    c.claim_ts,
    c.bkk_upc AS claim_bkk_upc,
    c.project AS claim_project,
    c.problem_category, c.problem_detail, c.problem_equipment,
    c.solution_category, c.solution_detail,
    ROW_NUMBER() OVER (
      PARTITION BY pm.asset_old_code, pm.pm_ref
      ORDER BY c.claim_ts ASC
    ) AS rn
  FROM pm
  LEFT JOIN claim c
    ON c.asset_old_code = pm.asset_old_code
   AND c.claim_ts >= pm.pm_end_ts
)
SELECT
  asset_old_code,
  pm_ref, pm_category, pm_end_ts,
  claim_ref, claim_ts,
  CASE WHEN claim_ts IS NOT NULL
       THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (claim_ts - pm_end_ts))/86400.0)::int)
       ELSE NULL END AS days,
  COALESCE(NULLIF(pm_media_type,''), asset_media_type) AS media_type,
  asset_department AS department,
  COALESCE(NULLIF(pm_bkk_upc,''), claim_bkk_upc) AS zone,
  COALESCE(NULLIF(pm_project,''), claim_project) AS project,
  problem_category, problem_detail, problem_equipment,
  solution_category, solution_detail
FROM joined
WHERE rn = 1 OR rn IS NULL;

CREATE INDEX mv_pm_pairs_asset_idx ON public.mv_pm_claim_pairs (asset_old_code);
CREATE INDEX mv_pm_pairs_pm_end_idx ON public.mv_pm_claim_pairs (pm_end_ts);
CREATE INDEX mv_pm_pairs_dept_idx ON public.mv_pm_claim_pairs (department);

GRANT SELECT ON public.mv_pm_claim_pairs TO authenticated;
GRANT ALL ON public.mv_pm_claim_pairs TO service_role;

-- ============================================================
-- refresh function
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_pm_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_pm_history;
  REFRESH MATERIALIZED VIEW public.mv_pm_claim_pairs;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_pm_views() TO authenticated, service_role;
