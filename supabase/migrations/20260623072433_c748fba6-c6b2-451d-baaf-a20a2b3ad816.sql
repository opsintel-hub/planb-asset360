CREATE POLICY mv_pm_history_no_direct_client_access
  ON public.mv_pm_history
  FOR SELECT
  TO authenticated
  USING (false);

CREATE POLICY mv_pm_claim_pairs_no_direct_client_access
  ON public.mv_pm_claim_pairs
  FOR SELECT
  TO authenticated
  USING (false);