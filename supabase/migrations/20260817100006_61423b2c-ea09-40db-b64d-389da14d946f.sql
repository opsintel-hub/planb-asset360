UPDATE public.billboard_mockups SET created_by = created_by WHERE false;
ALTER TABLE public.billboard_mockups ALTER COLUMN created_by SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "auth users can insert mockups" ON public.billboard_mockups;
CREATE POLICY "Users can insert own mockups" ON public.billboard_mockups
FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());