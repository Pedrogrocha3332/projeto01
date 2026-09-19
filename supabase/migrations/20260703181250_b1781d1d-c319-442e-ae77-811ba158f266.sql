
REVOKE SELECT ON public.instagram_accounts FROM authenticated;
GRANT SELECT (
  id, user_id, ig_user_id, username, account_type, profile_picture_url,
  page_id, page_name, token_expires_at, followers_count, media_count,
  is_active, created_at, updated_at
) ON public.instagram_accounts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.instagram_accounts TO authenticated;
GRANT ALL ON public.instagram_accounts TO service_role;

REVOKE ALL ON public.meta_credentials FROM anon, authenticated;
GRANT ALL ON public.meta_credentials TO service_role;
DROP POLICY IF EXISTS "Users manage their own meta credentials" ON public.meta_credentials;

DROP POLICY IF EXISTS "Admin principal manages roles" ON public.user_roles;

CREATE POLICY "Admin principal inserts non-principal roles"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin_principal'::public.app_role)
    AND role <> 'admin_principal'::public.app_role
  );

CREATE POLICY "Admin principal updates non-principal roles"
  ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin_principal'::public.app_role)
    AND role <> 'admin_principal'::public.app_role
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin_principal'::public.app_role)
    AND role <> 'admin_principal'::public.app_role
  );

CREATE POLICY "Admin principal deletes non-principal roles"
  ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin_principal'::public.app_role)
    AND role <> 'admin_principal'::public.app_role
  );

DROP POLICY IF EXISTS "Somente admin principal cria convites" ON public.invites;
CREATE POLICY "Somente admin principal cria convites"
  ON public.invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin_principal'::public.app_role)
    AND created_by = auth.uid()
    AND role <> 'admin_principal'::public.app_role
  );
