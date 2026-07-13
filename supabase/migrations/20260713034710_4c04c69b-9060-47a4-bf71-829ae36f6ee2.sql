
CREATE POLICY "auth read billboard-mockups"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'billboard-mockups');

CREATE POLICY "auth insert billboard-mockups"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'billboard-mockups');

CREATE POLICY "auth update billboard-mockups"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'billboard-mockups');

CREATE POLICY "auth delete billboard-mockups"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'billboard-mockups');
