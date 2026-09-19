CREATE POLICY "admin principal reads all media"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin_principal'));