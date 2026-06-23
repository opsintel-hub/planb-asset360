DROP MATERIALIZED VIEW IF EXISTS public.mv_pm_claim_pairs;
DROP MATERIALIZED VIEW IF EXISTS public.mv_pm_history;
DROP TABLE IF EXISTS public.mv_pm_claim_pairs;
DROP TABLE IF EXISTS public.mv_pm_history;

CREATE TABLE public.mv_pm_history AS
SELECT DISTINCT ON (COALESCE(NULLIF(h.ref_number, ''), h.id::text))
  NULLIF(h.ref_number, '')                              AS ref_number,
  h.old_code                                            AS asset_old_code,
  h.created_date                                        AS created_at,
  h.updated_date                                        AS updated_at,
  COALESCE(h.updated_date, h.created_date)              AS event_ts,
  h.category,
  CASE
    WHEN h.category = 'Claim' THEN 'Claim'
    WHEN h.category LIKE 'PM%' THEN 'PM'
    ELSE 'Other'
  END                                                   AS type,
  h.project,
  h.media_type,
  h.bkk_upc,
  h.asset_status,
  h.status,
  h.problem_category,
  h.problem_detail,
  h.problem_equipment,
  h.solution_category,
  h.solution_detail,
  COALESCE(h.total_turnaround_time, 0)                  AS total_turnaround_time,
  a.department                                          AS asset_department,
  a.payload->>'MediaType'                               AS asset_media_type
FROM public.mssql_asset_history h
LEFT JOIN public.assets a ON a.old_code = h.old_code
WHERE (h.category LIKE 'PM%' OR h.category = 'Claim')
  AND h.old_code IS NOT NULL
  AND h.created_date IS NOT NULL
ORDER BY COALESCE(NULLIF(h.ref_number, ''), h.id::text),
         h.updated_date DESC NULLS LAST,
         h.id DESC;

GRANT ALL ON public.mv_pm_history TO service_role;
ALTER TABLE public.mv_pm_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_mv_pm_hist_code ON public.mv_pm_history (asset_old_code);
CREATE INDEX idx_mv_pm_hist_type ON public.mv_pm_history (type, created_at);
CREATE INDEX idx_mv_pm_hist_ref ON public.mv_pm_history (ref_number);
CREATE INDEX idx_mv_pm_hist_event ON public.mv_pm_history (event_ts);

CREATE TABLE public.mv_pm_claim_pairs AS
WITH pm AS (
  SELECT asset_old_code, ref_number AS pm_ref, category AS pm_category,
         COALESCE(updated_at, created_at, event_ts) AS pm_end_ts,
         media_type AS pm_media_type, asset_media_type, asset_department,
         bkk_upc AS pm_bkk_upc, project AS pm_project
  FROM public.mv_pm_history
  WHERE type = 'PM' AND asset_status = 'Pass'
    AND COALESCE(updated_at, created_at, event_ts) IS NOT NULL
), claim AS (
  SELECT asset_old_code, ref_number AS claim_ref,
         COALESCE(created_at, event_ts) AS claim_ts,
         bkk_upc, project,
         problem_category, problem_detail, problem_equipment,
         solution_category, solution_detail
  FROM public.mv_pm_history
  WHERE type = 'Claim' AND COALESCE(created_at, event_ts) IS NOT NULL
), joined AS (
  SELECT pm.asset_old_code, pm.pm_ref, pm.pm_category, pm.pm_end_ts,
         pm.pm_media_type, pm.asset_media_type, pm.asset_department,
         pm.pm_bkk_upc, pm.pm_project,
         c.claim_ref, c.claim_ts,
         c.bkk_upc AS claim_bkk_upc, c.project AS claim_project,
         c.problem_category, c.problem_detail, c.problem_equipment,
         c.solution_category, c.solution_detail,
         row_number() OVER (
           PARTITION BY pm.asset_old_code, COALESCE(pm.pm_ref, pm.pm_end_ts::text)
           ORDER BY c.claim_ts
         ) AS rn
  FROM pm
  LEFT JOIN claim c
    ON c.asset_old_code = pm.asset_old_code
   AND c.claim_ts >= pm.pm_end_ts
)
SELECT asset_old_code, pm_ref, pm_category, pm_end_ts,
       claim_ref, claim_ts,
       CASE WHEN claim_ts IS NOT NULL
            THEN GREATEST(1, ceil(EXTRACT(epoch FROM (claim_ts - pm_end_ts)) / 86400.0)::int)
            ELSE NULL END                                   AS days,
       COALESCE(NULLIF(pm_media_type,''), asset_media_type) AS media_type,
       asset_department                                     AS department,
       COALESCE(NULLIF(pm_bkk_upc,''), claim_bkk_upc)       AS zone,
       COALESCE(NULLIF(pm_project,''), claim_project)       AS project,
       problem_category, problem_detail, problem_equipment,
       solution_category, solution_detail
FROM joined
WHERE rn = 1;

GRANT ALL ON public.mv_pm_claim_pairs TO service_role;
ALTER TABLE public.mv_pm_claim_pairs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_mv_pm_pairs_code ON public.mv_pm_claim_pairs (asset_old_code);
CREATE INDEX idx_mv_pm_pairs_pm_end ON public.mv_pm_claim_pairs (pm_end_ts);
CREATE INDEX idx_mv_pm_pairs_dept ON public.mv_pm_claim_pairs (department);

CREATE OR REPLACE FUNCTION public.refresh_pm_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE TABLE public.mv_pm_claim_pairs;
  TRUNCATE TABLE public.mv_pm_history;

  INSERT INTO public.mv_pm_history
  SELECT DISTINCT ON (COALESCE(NULLIF(h.ref_number, ''), h.id::text))
    NULLIF(h.ref_number, '')                              AS ref_number,
    h.old_code                                            AS asset_old_code,
    h.created_date                                        AS created_at,
    h.updated_date                                        AS updated_at,
    COALESCE(h.updated_date, h.created_date)              AS event_ts,
    h.category,
    CASE
      WHEN h.category = 'Claim' THEN 'Claim'
      WHEN h.category LIKE 'PM%' THEN 'PM'
      ELSE 'Other'
    END                                                   AS type,
    h.project,
    h.media_type,
    h.bkk_upc,
    h.asset_status,
    h.status,
    h.problem_category,
    h.problem_detail,
    h.problem_equipment,
    h.solution_category,
    h.solution_detail,
    COALESCE(h.total_turnaround_time, 0)                  AS total_turnaround_time,
    a.department                                          AS asset_department,
    a.payload->>'MediaType'                               AS asset_media_type
  FROM public.mssql_asset_history h
  LEFT JOIN public.assets a ON a.old_code = h.old_code
  WHERE (h.category LIKE 'PM%' OR h.category = 'Claim')
    AND h.old_code IS NOT NULL
    AND h.created_date IS NOT NULL
  ORDER BY COALESCE(NULLIF(h.ref_number, ''), h.id::text),
           h.updated_date DESC NULLS LAST,
           h.id DESC;

  INSERT INTO public.mv_pm_claim_pairs
  WITH pm AS (
    SELECT asset_old_code, ref_number AS pm_ref, category AS pm_category,
           COALESCE(updated_at, created_at, event_ts) AS pm_end_ts,
           media_type AS pm_media_type, asset_media_type, asset_department,
           bkk_upc AS pm_bkk_upc, project AS pm_project
    FROM public.mv_pm_history
    WHERE type = 'PM' AND asset_status = 'Pass'
      AND COALESCE(updated_at, created_at, event_ts) IS NOT NULL
  ), claim AS (
    SELECT asset_old_code, ref_number AS claim_ref,
           COALESCE(created_at, event_ts) AS claim_ts,
           bkk_upc, project,
           problem_category, problem_detail, problem_equipment,
           solution_category, solution_detail
    FROM public.mv_pm_history
    WHERE type = 'Claim' AND COALESCE(created_at, event_ts) IS NOT NULL
  ), joined AS (
    SELECT pm.asset_old_code, pm.pm_ref, pm.pm_category, pm.pm_end_ts,
           pm.pm_media_type, pm.asset_media_type, pm.asset_department,
           pm.pm_bkk_upc, pm.pm_project,
           c.claim_ref, c.claim_ts,
           c.bkk_upc AS claim_bkk_upc, c.project AS claim_project,
           c.problem_category, c.problem_detail, c.problem_equipment,
           c.solution_category, c.solution_detail,
           row_number() OVER (
             PARTITION BY pm.asset_old_code, COALESCE(pm.pm_ref, pm.pm_end_ts::text)
             ORDER BY c.claim_ts
           ) AS rn
    FROM pm
    LEFT JOIN claim c
      ON c.asset_old_code = pm.asset_old_code
     AND c.claim_ts >= pm.pm_end_ts
  )
  SELECT asset_old_code, pm_ref, pm_category, pm_end_ts,
         claim_ref, claim_ts,
         CASE WHEN claim_ts IS NOT NULL
              THEN GREATEST(1, ceil(EXTRACT(epoch FROM (claim_ts - pm_end_ts)) / 86400.0)::int)
              ELSE NULL END,
         COALESCE(NULLIF(pm_media_type,''), asset_media_type),
         asset_department,
         COALESCE(NULLIF(pm_bkk_upc,''), claim_bkk_upc),
         COALESCE(NULLIF(pm_project,''), claim_project),
         problem_category, problem_detail, problem_equipment,
         solution_category, solution_detail
  FROM joined
  WHERE rn = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_pm_views() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pm_views() TO service_role;