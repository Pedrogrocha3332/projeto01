DO $$
DECLARE
  canon_uid uuid := '903e360e-cb35-4867-b34a-eb44ce723ac0';
  dup_uid   uuid := '780c1ba3-a073-48ed-ab4c-11d77dcccefb';
  r record;
BEGIN
  FOR r IN
    SELECT dup.id AS dup_id, canon.id AS canon_id
    FROM public.instagram_accounts dup
    JOIN public.instagram_accounts canon
      ON canon.ig_user_id = dup.ig_user_id AND canon.user_id = canon_uid
    WHERE dup.user_id = dup_uid
  LOOP
    UPDATE public.media_pools     SET ig_account_id = r.canon_id WHERE ig_account_id = r.dup_id;
    UPDATE public.scheduled_posts SET ig_account_id = r.canon_id WHERE ig_account_id = r.dup_id;
    DELETE FROM public.instagram_accounts WHERE id = r.dup_id;
  END LOOP;
  UPDATE public.instagram_accounts SET user_id = canon_uid WHERE user_id = dup_uid;
  DELETE FROM public.meta_credentials WHERE user_id = dup_uid;
  UPDATE public.media_assets       SET user_id = canon_uid WHERE user_id = dup_uid;
  UPDATE public.media_pools        SET user_id = canon_uid WHERE user_id = dup_uid;
  UPDATE public.scheduled_posts    SET user_id = canon_uid WHERE user_id = dup_uid;
  UPDATE public.notifications      SET user_id = canon_uid WHERE user_id = dup_uid;
  UPDATE public.caption_templates  SET user_id = canon_uid WHERE user_id = dup_uid;
  UPDATE public.hashtag_groups     SET user_id = canon_uid WHERE user_id = dup_uid;
END $$;

ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS is_restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS restricted_at timestamptz,
  ADD COLUMN IF NOT EXISTS restricted_reason text;

DROP POLICY IF EXISTS "own media" ON public.media_assets;
CREATE POLICY "media admin or owner" ON public.media_assets FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_principal(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "own pools" ON public.media_pools;
CREATE POLICY "pools admin or owner" ON public.media_pools FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_principal(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "own pool videos" ON public.pool_videos;
CREATE POLICY "pool_videos admin or owner" ON public.pool_videos FOR ALL TO authenticated
  USING (public.is_admin_principal(auth.uid()) OR EXISTS (SELECT 1 FROM public.media_pools p WHERE p.id = pool_videos.pool_id AND p.user_id = auth.uid()))
  WITH CHECK (public.is_admin_principal(auth.uid()) OR EXISTS (SELECT 1 FROM public.media_pools p WHERE p.id = pool_videos.pool_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "own posts" ON public.scheduled_posts;
CREATE POLICY "posts admin or owner" ON public.scheduled_posts FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_principal(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "own post media" ON public.post_media;
CREATE POLICY "post_media admin or owner" ON public.post_media FOR ALL TO authenticated
  USING (public.is_admin_principal(auth.uid()) OR EXISTS (SELECT 1 FROM public.scheduled_posts p WHERE p.id = post_media.post_id AND p.user_id = auth.uid()))
  WITH CHECK (public.is_admin_principal(auth.uid()) OR EXISTS (SELECT 1 FROM public.scheduled_posts p WHERE p.id = post_media.post_id AND p.user_id = auth.uid()));

DROP POLICY IF EXISTS "own ig accounts" ON public.instagram_accounts;
CREATE POLICY "ig accounts admin or owner" ON public.instagram_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.is_admin_principal(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR public.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "own caption templates" ON public.caption_templates;
CREATE POLICY "captions admin or owner" ON public.caption_templates FOR ALL TO authenticated
  USING (auth.uid() = user_id OR private.is_admin_principal(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR private.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "own hashtag groups" ON public.hashtag_groups;
CREATE POLICY "hashtags admin or owner" ON public.hashtag_groups FOR ALL TO authenticated
  USING (auth.uid() = user_id OR private.is_admin_principal(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR private.is_admin_principal(auth.uid()));

DROP POLICY IF EXISTS "own notifications" ON public.notifications;
CREATE POLICY "notifications admin or owner" ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id OR private.is_admin_principal(auth.uid()))
  WITH CHECK (auth.uid() = user_id OR private.is_admin_principal(auth.uid()));

ALTER TABLE public.instagram_accounts REPLICA IDENTITY FULL;
ALTER TABLE public.media_assets REPLICA IDENTITY FULL;
ALTER TABLE public.media_pools REPLICA IDENTITY FULL;
ALTER TABLE public.pool_videos REPLICA IDENTITY FULL;
ALTER TABLE public.scheduled_posts REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='instagram_accounts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_accounts; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='media_assets') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.media_assets; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='media_pools') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.media_pools; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='pool_videos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pool_videos; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='scheduled_posts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_posts; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; END IF;
END $$;