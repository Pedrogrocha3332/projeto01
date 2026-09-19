CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION private.is_admin_principal(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin_principal'
  )
$$;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin_principal(uuid) TO authenticated;

DROP POLICY IF EXISTS "ig accounts admin or owner" ON public.instagram_accounts;
CREATE POLICY "ig accounts admin or owner"
ON public.instagram_accounts
FOR ALL
TO authenticated
USING ((auth.uid() = user_id) OR private.is_admin_principal(auth.uid()))
WITH CHECK ((auth.uid() = user_id) OR private.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "media admin or owner" ON public.media_assets;
CREATE POLICY "media admin or owner"
ON public.media_assets
FOR ALL
TO authenticated
USING ((auth.uid() = user_id) OR private.is_admin_principal(auth.uid()))
WITH CHECK ((auth.uid() = user_id) OR private.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "pools admin or owner" ON public.media_pools;
CREATE POLICY "pools admin or owner"
ON public.media_pools
FOR ALL
TO authenticated
USING ((auth.uid() = user_id) OR private.is_admin_principal(auth.uid()))
WITH CHECK ((auth.uid() = user_id) OR private.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "posts admin or owner" ON public.scheduled_posts;
CREATE POLICY "posts admin or owner"
ON public.scheduled_posts
FOR ALL
TO authenticated
USING ((auth.uid() = user_id) OR private.is_admin_principal(auth.uid()))
WITH CHECK ((auth.uid() = user_id) OR private.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "pool_videos admin or owner" ON public.pool_videos;
CREATE POLICY "pool_videos admin or owner"
ON public.pool_videos
FOR ALL
TO authenticated
USING (
  private.is_admin_principal(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.media_pools p
    WHERE p.id = pool_videos.pool_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  private.is_admin_principal(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.media_pools p
    WHERE p.id = pool_videos.pool_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "post_media admin or owner" ON public.post_media;
CREATE POLICY "post_media admin or owner"
ON public.post_media
FOR ALL
TO authenticated
USING (
  private.is_admin_principal(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.scheduled_posts p
    WHERE p.id = post_media.post_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  private.is_admin_principal(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.scheduled_posts p
    WHERE p.id = post_media.post_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles"
ON public.user_roles
FOR SELECT
TO public
USING ((auth.uid() = user_id) OR private.has_role(auth.uid(), 'admin_principal'));

DROP POLICY IF EXISTS "Admin principal inserts non-principal roles" ON public.user_roles;
CREATE POLICY "Admin principal inserts non-principal roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (private.has_role(auth.uid(), 'admin_principal') AND (role <> 'admin_principal'));

DROP POLICY IF EXISTS "Admin principal updates non-principal roles" ON public.user_roles;
CREATE POLICY "Admin principal updates non-principal roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (private.has_role(auth.uid(), 'admin_principal') AND (role <> 'admin_principal'))
WITH CHECK (private.has_role(auth.uid(), 'admin_principal') AND (role <> 'admin_principal'));

DROP POLICY IF EXISTS "Admin principal deletes non-principal roles" ON public.user_roles;
CREATE POLICY "Admin principal deletes non-principal roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (private.has_role(auth.uid(), 'admin_principal') AND (role <> 'admin_principal'));

REVOKE EXECUTE ON FUNCTION public.is_admin_principal(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated;