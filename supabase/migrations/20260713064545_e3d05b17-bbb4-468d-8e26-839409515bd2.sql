
-- Tighten public.billboard_mockups UPDATE/DELETE to owner or admin
DROP POLICY IF EXISTS "auth users can update mockups" ON public.billboard_mockups;
DROP POLICY IF EXISTS "auth users can delete mockups" ON public.billboard_mockups;

CREATE POLICY "Owner or admin can update mockups"
ON public.billboard_mockups
FOR UPDATE
TO authenticated
USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner or admin can delete mockups"
ON public.billboard_mockups
FOR DELETE
TO authenticated
USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'));

-- Tighten storage.objects policies for billboard-mockups bucket:
-- require the first path segment to equal the uploader's uid.
DROP POLICY IF EXISTS "auth read billboard-mockups" ON storage.objects;
DROP POLICY IF EXISTS "auth insert billboard-mockups" ON storage.objects;
DROP POLICY IF EXISTS "auth update billboard-mockups" ON storage.objects;
DROP POLICY IF EXISTS "auth delete billboard-mockups" ON storage.objects;

CREATE POLICY "Owner or admin can read billboard-mockups"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'billboard-mockups'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "Owner can insert billboard-mockups"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'billboard-mockups'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Owner or admin can update billboard-mockups"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'billboard-mockups'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
  )
)
WITH CHECK (
  bucket_id = 'billboard-mockups'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "Owner or admin can delete billboard-mockups"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'billboard-mockups'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
  )
);
