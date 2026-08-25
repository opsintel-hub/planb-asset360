CREATE POLICY "auth can update own shares"
ON public.poi_shares
FOR UPDATE
TO authenticated
USING ((auth.uid() = created_by) OR public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((auth.uid() = created_by) OR public.has_role(auth.uid(), 'admin'::app_role));