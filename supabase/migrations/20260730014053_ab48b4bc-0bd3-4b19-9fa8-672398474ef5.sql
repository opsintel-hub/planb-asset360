DROP POLICY IF EXISTS "auth users can view mockups" ON public.billboard_mockups;
CREATE POLICY "Owner or admin can view mockups"
ON public.billboard_mockups
FOR SELECT
TO authenticated
USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "auth can read unexpired shares" ON public.poi_shares;
CREATE POLICY "Owner or admin can read own unexpired shares"
ON public.poi_shares
FOR SELECT
TO authenticated
USING ((expires_at > now()) AND ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role)));