
DROP POLICY IF EXISTS "Authenticated can update next steps" ON public.claim_next_steps;
DROP POLICY IF EXISTS "Authenticated can delete next steps" ON public.claim_next_steps;

CREATE POLICY "Users can update own next steps"
  ON public.claim_next_steps
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = updated_by OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = updated_by OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can delete own next steps"
  ON public.claim_next_steps
  FOR DELETE
  TO authenticated
  USING (auth.uid() = updated_by OR public.has_role(auth.uid(), 'admin'));
