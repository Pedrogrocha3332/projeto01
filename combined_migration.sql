-- ==========================================
-- MIGRATION: 20260702053318_1c8acfc7-1ddd-444d-9384-f1fe7f93ef7d.sql
-- ==========================================

-- Criar o schema private antes das RLS que dependem dele
CREATE SCHEMA IF NOT EXISTS private;

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  notification_email BOOLEAN NOT NULL DEFAULT true,
  notify_on_failed BOOLEAN NOT NULL DEFAULT true,
  notify_on_token_expiry BOOLEAN NOT NULL DEFAULT true,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Instagram accounts
CREATE TABLE public.instagram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  account_type TEXT,
  profile_picture_url TEXT,
  page_id TEXT,
  page_name TEXT,
  access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  followers_count INT DEFAULT 0,
  media_count INT DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, ig_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instagram_accounts TO authenticated;
GRANT ALL ON public.instagram_accounts TO service_role;
ALTER TABLE public.instagram_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ig accounts" ON public.instagram_accounts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Media assets library
CREATE TABLE public.media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image','video')),
  size_bytes BIGINT NOT NULL DEFAULT 0,
  width INT,
  height INT,
  duration_seconds NUMERIC,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO authenticated;
GRANT ALL ON public.media_assets TO service_role;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own media" ON public.media_assets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Scheduled posts
CREATE TABLE public.scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_account_id UUID NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  post_type TEXT NOT NULL CHECK (post_type IN ('image','carousel','reel')),
  caption TEXT NOT NULL DEFAULT '',
  first_comment TEXT,
  location_name TEXT,
  location_id TEXT,
  user_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly','monthly')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft','scheduled','publishing','published','failed')),
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  ig_media_id TEXT,
  ig_container_id TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scheduled_posts_due ON public.scheduled_posts(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_scheduled_posts_user ON public.scheduled_posts(user_id, scheduled_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_posts TO authenticated;
GRANT ALL ON public.scheduled_posts TO service_role;
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own posts" ON public.scheduled_posts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Post media (ordered list of assets in a post)
CREATE TABLE public.post_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.scheduled_posts(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_media_post ON public.post_media(post_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_media TO authenticated;
GRANT ALL ON public.post_media TO service_role;
ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own post media" ON public.post_media FOR ALL
  USING (EXISTS (SELECT 1 FROM public.scheduled_posts p WHERE p.id = post_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.scheduled_posts p WHERE p.id = post_id AND p.user_id = auth.uid()));

-- Analytics snapshots
CREATE TABLE public.analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_account_id UUID NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('account','media')),
  ig_media_id TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_analytics_lookup ON public.analytics_snapshots(ig_account_id, scope, captured_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.analytics_snapshots TO authenticated;
GRANT ALL ON public.analytics_snapshots TO service_role;
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own analytics" ON public.analytics_snapshots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Hashtag groups
CREATE TABLE public.hashtag_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hashtag_groups TO authenticated;
GRANT ALL ON public.hashtag_groups TO service_role;
ALTER TABLE public.hashtag_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own hashtag groups" ON public.hashtag_groups FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Caption templates
CREATE TABLE public.caption_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caption_templates TO authenticated;
GRANT ALL ON public.caption_templates TO service_role;
ALTER TABLE public.caption_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own caption templates" ON public.caption_templates FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Updated-at helper
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_profiles_upd BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_ig_upd BEFORE UPDATE ON public.instagram_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_posts_upd BEFORE UPDATE ON public.scheduled_posts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_hashtags_upd BEFORE UPDATE ON public.hashtag_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_captions_upd BEFORE UPDATE ON public.caption_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==========================================
-- MIGRATION: 20260702053346_f8f4947e-9a55-4041-9e10-76860a240492.sql
-- ==========================================

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- ==========================================
-- MIGRATION: 20260702053405_a477c68c-48c8-4af5-b35c-ddae7aff3d5f.sql
-- ==========================================

CREATE POLICY "own media read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND name LIKE (auth.uid()::text || '/%'));
CREATE POLICY "own media insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND name LIKE (auth.uid()::text || '/%'));
CREATE POLICY "own media update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND name LIKE (auth.uid()::text || '/%'));
CREATE POLICY "own media delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND name LIKE (auth.uid()::text || '/%'));

-- ==========================================
-- MIGRATION: 20260702090731_3fa9af26-983e-405b-9b5c-81e7e273110f.sql
-- ==========================================

CREATE TABLE public.meta_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id text NOT NULL,
  app_secret text NOT NULL,
  long_lived_token text NOT NULL,
  last_tested_at timestamptz,
  last_test_status text,
  last_test_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_credentials TO authenticated;
GRANT ALL ON public.meta_credentials TO service_role;

ALTER TABLE public.meta_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own meta credentials"
  ON public.meta_credentials FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER meta_credentials_set_updated_at
  BEFORE UPDATE ON public.meta_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==========================================
-- MIGRATION: 20260702091833_67c9f503-3cf0-4435-84c7-c6f125e41df1.sql
-- ==========================================

-- 1. Enum de roles
CREATE TYPE public.app_role AS ENUM ('admin_principal', 'admin');

-- 2. Tabela user_roles (nunca em profiles!)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer helper — usado por RLS sem recursão
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin_principal(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin_principal')
$$;

-- Criar o schema e funções private logo após as tabelas de suporte existirem
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

CREATE POLICY "Users read own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin_principal'));

CREATE POLICY "Admin principal manages roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin_principal'))
  WITH CHECK (public.has_role(auth.uid(), 'admin_principal'));

-- 3. Tabela de convites
CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  email_hint text,
  role public.app_role NOT NULL DEFAULT 'admin',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz
);

CREATE INDEX invites_token_idx ON public.invites(token);
CREATE INDEX invites_created_by_idx ON public.invites(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins veem convites"
  ON public.invites FOR SELECT
  USING (public.has_role(auth.uid(), 'admin_principal') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Somente admin principal cria convites"
  ON public.invites FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin_principal') AND created_by = auth.uid());

CREATE POLICY "Somente admin principal atualiza convites"
  ON public.invites FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin_principal'))
  WITH CHECK (public.has_role(auth.uid(), 'admin_principal'));

CREATE POLICY "Somente admin principal exclui convites"
  ON public.invites FOR DELETE
  USING (public.has_role(auth.uid(), 'admin_principal'));

-- 4. Trigger de cadastro: admin principal automático + validação de convite
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_invite public.invites%ROWTYPE;
  v_email text := lower(coalesce(NEW.email, ''));
BEGIN
  -- Cria perfil
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Admin principal fixo
  IF v_email = 'pedro@admin.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin_principal')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Demais usuários: exigir convite válido
  v_token := NULLIF(NEW.raw_user_meta_data->>'invite_token', '');

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Cadastro somente por convite. Solicite um link de convite ao administrador.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_invite FROM public.invites WHERE token = v_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite inválido.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este convite foi cancelado.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_invite.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este convite já foi utilizado.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Este convite expirou.' USING ERRCODE = 'check_violation';
  END IF;

  -- Consome convite
  UPDATE public.invites
     SET used_at = now(), used_by = NEW.id
   WHERE id = v_invite.id;

  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (NEW.id, v_invite.role, v_invite.created_by)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- Recria trigger (idempotente)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Se o admin principal já existe (login anterior), garante role
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin_principal'::public.app_role
  FROM auth.users u
 WHERE lower(u.email) = 'pedro@admin.com'
ON CONFLICT DO NOTHING;

-- ==========================================
-- MIGRATION: 20260702091852_08b3f408-c774-436e-a94a-98a3835ee581.sql
-- ==========================================

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin_principal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_principal(uuid) TO service_role;

-- ==========================================
-- MIGRATION: 20260702175017_b1c0fb6c-b7c8-41c0-af1e-c0c3a9fd0838.sql
-- ==========================================

CREATE TABLE public.meta_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

GRANT SELECT, INSERT, DELETE ON public.meta_oauth_states TO authenticated;
GRANT ALL ON public.meta_oauth_states TO service_role;

ALTER TABLE public.meta_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own oauth states" ON public.meta_oauth_states
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_meta_oauth_states_expires ON public.meta_oauth_states(expires_at);

-- ==========================================
-- MIGRATION: 20260702185414_18b6f9fa-6d6e-4f47-bf11-40c6815caf65.sql
-- ==========================================

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_offset integer,
  ADD COLUMN IF NOT EXISTS ig_permalink text;

-- ==========================================
-- MIGRATION: 20260702185649_dda4c9d8-3622-4a22-ac21-5b15abc470dc.sql
-- ==========================================

-- [Omitted pg_cron]
-- [Omitted pg_net]

-- Remove existing job if present, then schedule
-- [Removed pg_cron unschedule block]

-- [Removed pg_cron schedule from migration]

-- ==========================================
-- MIGRATION: 20260702185727_1a3483a0-cc18-49be-bca7-4c5c0e9c2ab5.sql
-- ==========================================

-- [Removed pg_cron unschedule block]

-- [Removed pg_cron schedule from migration]

-- ==========================================
-- MIGRATION: 20260702191145_e4d8ee05-6618-43df-b38c-087f3ae3c05c.sql
-- ==========================================

-- Allow 'cover' as a media kind (covers for Reels stored in library)
ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_media_kind_check;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_media_kind_check
  CHECK (media_kind = ANY (ARRAY['image'::text, 'video'::text, 'cover'::text]));

-- Cover chosen from library (nullable, alternative to cover_url)
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS cover_media_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL;

-- Custom recurrence interval in minutes (e.g. 40, 60, 120). NULL = use recurrence enum.
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS interval_minutes integer;

-- ==========================================
-- MIGRATION: 20260702202141_7bf62a89-590e-4485-8fd1-7069545cb1ba.sql
-- ==========================================

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON public.notifications(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications" ON public.notifications FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- ==========================================
-- MIGRATION: 20260702223146_8e5dce93-c1e8-4867-9a80-6ea30254ed5f.sql
-- ==========================================

UPDATE scheduled_posts SET scheduled_at = '2026-07-02 22:46:00+00', updated_at = now() WHERE id = '854b1a30-9bff-4ad6-82d9-8490091573f5';
UPDATE scheduled_posts SET scheduled_at = '2026-07-02 22:49:00+00', updated_at = now() WHERE id = '2ad24cc6-9379-4fe0-8daf-52328f667097';

-- ==========================================
-- MIGRATION: 20260702225918_42cc10ea-19fc-4942-80f7-7bb02138d1d0.sql
-- ==========================================

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS auto_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_lock_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts_log jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_monitor
  ON public.scheduled_posts (status, next_retry_at)
  WHERE status IN ('publishing','failed');

-- ==========================================
-- MIGRATION: 20260703181250_b1781d1d-c319-442e-ae77-811ba158f266.sql
-- ==========================================

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

-- ==========================================
-- MIGRATION: 20260703183956_8c4d09e9-b02b-4a04-980a-8889f478b16a.sql
-- ==========================================

ALTER TABLE public.media_assets ADD COLUMN IF NOT EXISTS thumbnail_path text;
ALTER TABLE public.media_assets ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- ==========================================
-- MIGRATION: 20260703184606_f0d66179-fff6-4392-b6e7-32c30f1fe6b4.sql
-- ==========================================

-- Explicit column-level revocation of sensitive Instagram token columns for the
-- authenticated PostgREST role. The prior migration granted SELECT on only the
-- non-sensitive columns; this makes the revocation of access_token/token_expires_at
-- explicit and idempotent so future audits can confirm it directly.
REVOKE SELECT (access_token) ON public.instagram_accounts FROM authenticated;
REVOKE SELECT (access_token) ON public.instagram_accounts FROM anon;

-- ==========================================
-- MIGRATION: 20260703191857_bbb70ce1-760e-4440-9686-b579cfa9f8a8.sql
-- ==========================================

-- [Removed pg_cron unschedule block]

-- [Removed pg_cron schedule from migration]

-- ==========================================
-- MIGRATION: 20260703222536_a64f2685-de7c-4f67-a11f-ac96f274e2f3.sql
-- ==========================================

-- ============================================================
-- MEDIA POOLS: rotação circular de Reels por conta, em lotes
-- ============================================================

-- 1) Pools
CREATE TABLE public.media_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_account_id UUID NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  batch_size INTEGER NOT NULL DEFAULT 3 CHECK (batch_size >= 1 AND batch_size <= 20),
  interval_minutes INTEGER NOT NULL DEFAULT 40 CHECK (interval_minutes >= 5 AND interval_minutes <= 10080),
  spacing_seconds INTEGER NOT NULL DEFAULT 45 CHECK (spacing_seconds >= 15 AND spacing_seconds <= 600),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  cycle_number INTEGER NOT NULL DEFAULT 1,
  last_batch_at TIMESTAMPTZ,
  next_batch_at TIMESTAMPTZ,
  batches_published INTEGER NOT NULL DEFAULT 0,
  reels_published INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_pools TO authenticated;
GRANT ALL ON public.media_pools TO service_role;
ALTER TABLE public.media_pools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pools" ON public.media_pools
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_media_pools_account ON public.media_pools(ig_account_id);
CREATE INDEX idx_media_pools_due ON public.media_pools(next_batch_at)
  WHERE status = 'active';

CREATE TRIGGER trg_media_pools_upd BEFORE UPDATE ON public.media_pools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Vídeos do pool (rotação circular)
CREATE TABLE public.pool_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.media_pools(id) ON DELETE CASCADE,
  media_asset_id UUID NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  posted_in_current_cycle BOOLEAN NOT NULL DEFAULT FALSE,
  times_posted INTEGER NOT NULL DEFAULT 0,
  last_posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pool_id, media_asset_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_videos TO authenticated;
GRANT ALL ON public.pool_videos TO service_role;
ALTER TABLE public.pool_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pool videos" ON public.pool_videos
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.media_pools p WHERE p.id = pool_videos.pool_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.media_pools p WHERE p.id = pool_videos.pool_id AND p.user_id = auth.uid()));

CREATE INDEX idx_pool_videos_pool ON public.pool_videos(pool_id, position);
CREATE INDEX idx_pool_videos_pending ON public.pool_videos(pool_id) WHERE posted_in_current_cycle = FALSE;

-- 3) Log de execução (por lote / por reel)
CREATE TABLE public.pool_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.media_pools(id) ON DELETE CASCADE,
  ig_account_id UUID NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  media_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
  scheduled_post_id UUID REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
  batch_number INTEGER NOT NULL,
  batch_index INTEGER NOT NULL,
  cycle_number INTEGER NOT NULL DEFAULT 1,
  scheduled_at TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  success BOOLEAN,
  error TEXT,
  ig_media_id TEXT,
  ig_permalink TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_execution_log TO authenticated;
GRANT ALL ON public.pool_execution_log TO service_role;
ALTER TABLE public.pool_execution_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pool logs" ON public.pool_execution_log
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.media_pools p WHERE p.id = pool_execution_log.pool_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.media_pools p WHERE p.id = pool_execution_log.pool_id AND p.user_id = auth.uid()));

CREATE INDEX idx_pool_log_pool ON public.pool_execution_log(pool_id, batch_number DESC, batch_index);
CREATE INDEX idx_pool_log_scheduled_post ON public.pool_execution_log(scheduled_post_id);

-- 4) Link do scheduled_post de volta ao pool (para o publish cron/UI diferenciar)
ALTER TABLE public.scheduled_posts
  ADD COLUMN source_pool_id UUID REFERENCES public.media_pools(id) ON DELETE SET NULL;

CREATE INDEX idx_scheduled_posts_source_pool ON public.scheduled_posts(source_pool_id)
  WHERE source_pool_id IS NOT NULL;

-- 5) Agenda o cron de processamento de pools (a cada 1 minuto)
-- [Removed pg_cron schedule from migration]

-- ==========================================
-- MIGRATION: 20260703224349_8e0ef889-a044-49d3-881d-1cab5c9aa37f.sql
-- ==========================================

ALTER TABLE public.media_pools ADD COLUMN IF NOT EXISTS cover_media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL;

-- ==========================================
-- MIGRATION: 20260704030446_694c633b-4c87-420f-9c57-c14a5c724a95.sql
-- ==========================================

CREATE POLICY "admin principal reads all media"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'media' AND public.has_role(auth.uid(), 'admin_principal'));

-- ==========================================
-- MIGRATION: 20260704130023_4a7a671b-a9f0-4003-bc14-6208803d35c4.sql
-- ==========================================

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

-- ==========================================
-- MIGRATION: 20260704131500_de53f1f3-37c0-41d4-9b29-7c78215014d1.sql
-- ==========================================

GRANT SELECT ON public.instagram_accounts TO authenticated;
GRANT ALL ON public.instagram_accounts TO service_role;

-- ==========================================
-- MIGRATION: 20260704132125_6607be6a-0882-4182-ad88-30ac6068c761.sql
-- ==========================================

GRANT EXECUTE ON FUNCTION public.is_admin_principal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- ==========================================
-- MIGRATION: 20260704132208_991ad5d3-4299-440c-a2f7-c9b92091a625.sql
-- ==========================================

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

-- ==========================================
-- MIGRATION: 20260704132712_f994c9c8-316f-4984-a4c5-55ab4f3b4abf.sql
-- ==========================================

DO $$
DECLARE
  base_time timestamptz := now() + interval '90 minutes';
BEGIN
  -- Posts agendados próximos demais são reagendados em sequência global de 2 minutos,
  -- preservando a ordem atual e evitando rajada de contas diferentes no mesmo minuto.
  WITH candidates AS (
    SELECT
      id,
      row_number() OVER (ORDER BY scheduled_at, created_at, id) - 1 AS rn
    FROM public.scheduled_posts
    WHERE status = 'scheduled'
      AND scheduled_at < base_time
  )
  UPDATE public.scheduled_posts p
     SET scheduled_at = base_time + (c.rn * interval '2 minutes'),
         updated_at = now(),
         processing_lock_at = NULL
    FROM candidates c
   WHERE p.id = c.id;

  -- Falhas por "too many actions" não devem tentar de novo agora.
  -- Mantemos visíveis como failed, mas empurramos o retry para depois do cooldown,
  -- também espaçado globalmente.
  WITH failed_rate AS (
    SELECT
      id,
      row_number() OVER (ORDER BY coalesce(next_retry_at, scheduled_at), created_at, id) - 1 AS rn
    FROM public.scheduled_posts
    WHERE status = 'failed'
      AND last_error ILIKE '%too many actions%'
  )
  UPDATE public.scheduled_posts p
     SET next_retry_at = base_time + (f.rn * interval '2 minutes'),
         processing_lock_at = NULL,
         updated_at = now()
    FROM failed_rate f
   WHERE p.id = f.id;

  -- Pools ativos cujo próximo lote está vencido ou perto demais também esperam o cooldown.
  -- Isso impede que o processador crie novo lote imediatamente enquanto a conta está quente.
  WITH due_pools AS (
    SELECT
      id,
      row_number() OVER (ORDER BY coalesce(next_batch_at, now()), id) - 1 AS rn
    FROM public.media_pools
    WHERE status = 'active'
      AND (next_batch_at IS NULL OR next_batch_at < base_time)
  )
  UPDATE public.media_pools p
     SET next_batch_at = base_time + (d.rn * interval '2 minutes'),
         updated_at = now()
    FROM due_pools d
   WHERE p.id = d.id;
END $$;

-- ==========================================
-- MIGRATION: 20260704151118_ab57de3f-6da2-43fe-958e-85c52dfd936b.sql
-- ==========================================

-- Rebalanceia posts scheduled/failed usando o novo espaçamento (60min/conta).
-- Preserva a ordem original por scheduled_at dentro de cada conta.
DO $$
DECLARE
  r RECORD;
  v_last_by_acct JSONB := '{}'::jsonb;
  v_global_ts TIMESTAMPTZ := now();
  v_next_ts TIMESTAMPTZ;
  v_last_acct_ts TIMESTAMPTZ;
  v_acct_key TEXT;
BEGIN
  -- Para cada conta, pega o último published_at ou publishing scheduled_at como base.
  FOR r IN
    SELECT sp.id, sp.ig_account_id, sp.scheduled_at, sp.status
    FROM public.scheduled_posts sp
    WHERE sp.status IN ('scheduled','failed')
      AND sp.ig_account_id IS NOT NULL
    ORDER BY sp.ig_account_id, sp.scheduled_at ASC
  LOOP
    v_acct_key := r.ig_account_id::text;

    -- Última referência dessa conta: publicado mais recente OU último slot já alocado.
    IF v_last_by_acct ? v_acct_key THEN
      v_last_acct_ts := (v_last_by_acct ->> v_acct_key)::timestamptz;
    ELSE
      SELECT COALESCE(MAX(published_at), MAX(scheduled_at) FILTER (WHERE status='publishing'))
      INTO v_last_acct_ts
      FROM public.scheduled_posts
      WHERE ig_account_id = r.ig_account_id
        AND status IN ('published','publishing');
    END IF;

    -- Próximo slot: max(agora, último_conta + 60min, global + 30s)
    v_next_ts := GREATEST(
      now() + interval '30 seconds',
      COALESCE(v_last_acct_ts + interval '60 minutes', now()),
      v_global_ts + interval '30 seconds'
    );

    UPDATE public.scheduled_posts
    SET scheduled_at = v_next_ts,
        status = 'scheduled',
        processing_lock_at = NULL,
        next_retry_at = NULL,
        last_error = NULL,
        updated_at = now()
    WHERE id = r.id;

    v_last_by_acct := jsonb_set(v_last_by_acct, ARRAY[v_acct_key], to_jsonb(v_next_ts::text));
    v_global_ts := v_next_ts;
  END LOOP;
END $$;

-- Reajusta próximo batch dos pools ativos para começar em 60min a partir de agora.
UPDATE public.media_pools
SET next_batch_at = now() + interval '5 minutes',
    updated_at = now()
WHERE status = 'active'
  AND (next_batch_at IS NULL OR next_batch_at < now());

-- ==========================================
-- MIGRATION: 20260704151448_90587acd-f96a-499f-825e-5037b9fc48c1.sql
-- ==========================================

DO $$
DECLARE
  acct RECORD;
  post RECORD;
  v_offset_seconds INT := 0;
  v_stagger_seconds INT := 180; -- 3 minutos entre contas
  v_base TIMESTAMPTZ := date_trunc('minute', now()) + interval '2 minutes';
  v_account_start TIMESTAMPTZ;
  v_last_published TIMESTAMPTZ;
  v_slot TIMESTAMPTZ;
  v_i INT;
BEGIN
  -- Para cada conta ativa com posts pendentes, na ordem original,
  -- atribui slot = (base + offset_conta) + i*60min, respeitando 60min desde o último published.
  FOR acct IN
    SELECT DISTINCT sp.ig_account_id
    FROM public.scheduled_posts sp
    JOIN public.instagram_accounts ia ON ia.id = sp.ig_account_id
    WHERE sp.status IN ('scheduled','failed','publishing')
      AND ia.is_active = true
      AND COALESCE(ia.is_restricted, false) = false
    ORDER BY sp.ig_account_id
  LOOP
    -- Último published dessa conta (para respeitar 60min desde a última publicação real).
    SELECT MAX(published_at) INTO v_last_published
    FROM public.scheduled_posts
    WHERE ig_account_id = acct.ig_account_id AND status = 'published';

    v_account_start := GREATEST(
      v_base + make_interval(secs => v_offset_seconds),
      COALESCE(v_last_published + interval '60 minutes', v_base)
    );

    v_i := 0;
    FOR post IN
      SELECT id FROM public.scheduled_posts
      WHERE ig_account_id = acct.ig_account_id
        AND status IN ('scheduled','failed','publishing')
      ORDER BY scheduled_at ASC, created_at ASC
    LOOP
      v_slot := v_account_start + make_interval(mins => 60 * v_i);
      UPDATE public.scheduled_posts
      SET scheduled_at = v_slot,
          status = 'scheduled',
          processing_lock_at = NULL,
          next_retry_at = NULL,
          last_error = NULL,
          ig_container_id = NULL,
          auto_retry_count = 0,
          updated_at = now()
      WHERE id = post.id;
      v_i := v_i + 1;
    END LOOP;

    v_offset_seconds := v_offset_seconds + v_stagger_seconds;
  END LOOP;
END $$;

-- Pools ativos: próximo batch dali a 60min para respeitar o ciclo.
UPDATE public.media_pools
SET next_batch_at = now() + interval '60 minutes',
    updated_at = now()
WHERE status = 'active';

-- ==========================================
-- MIGRATION: 20260704151640_a9440383-6511-46eb-aa03-59858df96c15.sql
-- ==========================================

DO $$
DECLARE
  acct RECORD;
  post RECORD;
  v_offset_seconds INT := 0;
  v_stagger_seconds INT := 240; -- 4 minutos entre contas
  v_base TIMESTAMPTZ := date_trunc('minute', now()) + interval '3 minutes';
  v_account_start TIMESTAMPTZ;
  v_last_published TIMESTAMPTZ;
  v_slot TIMESTAMPTZ;
  v_i INT;
  v_group INT;
  v_within INT;
  v_group_size INT := 3;
  v_within_gap_secs INT := 20; -- 20s entre os 3 do mesmo grupo
BEGIN
  FOR acct IN
    SELECT DISTINCT sp.ig_account_id
    FROM public.scheduled_posts sp
    JOIN public.instagram_accounts ia ON ia.id = sp.ig_account_id
    WHERE sp.status IN ('scheduled','failed','publishing')
      AND ia.is_active = true
      AND COALESCE(ia.is_restricted, false) = false
    ORDER BY sp.ig_account_id
  LOOP
    SELECT MAX(published_at) INTO v_last_published
    FROM public.scheduled_posts
    WHERE ig_account_id = acct.ig_account_id AND status = 'published';

    v_account_start := GREATEST(
      v_base + make_interval(secs => v_offset_seconds),
      COALESCE(v_last_published + interval '60 minutes', v_base)
    );

    v_i := 0;
    FOR post IN
      SELECT id FROM public.scheduled_posts
      WHERE ig_account_id = acct.ig_account_id
        AND status IN ('scheduled','failed','publishing')
      ORDER BY scheduled_at ASC, created_at ASC
    LOOP
      v_group  := v_i / v_group_size;               -- 0,0,0, 1,1,1, 2,2,2 ...
      v_within := v_i % v_group_size;               -- 0,1,2, 0,1,2, 0,1,2 ...
      v_slot := v_account_start
              + make_interval(mins => 60 * v_group)
              + make_interval(secs => v_within_gap_secs * v_within);

      UPDATE public.scheduled_posts
      SET scheduled_at = v_slot,
          status = 'scheduled',
          processing_lock_at = NULL,
          next_retry_at = NULL,
          last_error = NULL,
          ig_container_id = NULL,
          auto_retry_count = 0,
          updated_at = now()
      WHERE id = post.id;

      v_i := v_i + 1;
    END LOOP;

    v_offset_seconds := v_offset_seconds + v_stagger_seconds;
  END LOOP;
END $$;

UPDATE public.media_pools
SET next_batch_at = now() + interval '60 minutes',
    updated_at = now()
WHERE status = 'active';

-- ==========================================
-- MIGRATION: 20260704153815_34082c40-2a1e-4ba5-97e2-a832e4a5a3fe.sql
-- ==========================================

DO $$
DECLARE
  v_base timestamptz := date_trunc('minute', now()) + interval '3 minutes';
  v_stagger_seconds int := 90;
  v_gap_minutes int := 20;
  v_acct record;
  v_post record;
  v_i int;
  v_acct_idx int := 0;
  v_account_start timestamptz;
BEGIN
  FOR v_acct IN
    SELECT DISTINCT ig_account_id
    FROM public.scheduled_posts
    WHERE status IN ('scheduled','failed','publishing')
      AND ig_account_id IS NOT NULL
    ORDER BY ig_account_id
  LOOP
    v_account_start := v_base + make_interval(secs => v_acct_idx * v_stagger_seconds);
    v_i := 0;
    FOR v_post IN
      SELECT id
      FROM public.scheduled_posts
      WHERE ig_account_id = v_acct.ig_account_id
        AND status IN ('scheduled','failed','publishing')
      ORDER BY scheduled_at ASC, created_at ASC
    LOOP
      UPDATE public.scheduled_posts
      SET scheduled_at = v_account_start + make_interval(mins => v_gap_minutes * v_i),
          status = CASE WHEN status = 'failed' THEN 'scheduled' ELSE status END,
          processing_lock_at = NULL,
          updated_at = now()
      WHERE id = v_post.id;
      v_i := v_i + 1;
    END LOOP;
    v_acct_idx := v_acct_idx + 1;
  END LOOP;
END $$;

UPDATE public.media_pools
SET next_batch_at = now() + interval '20 minutes',
    interval_minutes = 20,
    batch_size = 1,
    updated_at = now()
WHERE status = 'active';

-- ==========================================
-- MIGRATION: 20260704154809_c436b0e1-4de4-4a5d-8da5-14d95186c9fa.sql
-- ==========================================

-- 1) Log de correções automáticas aplicadas pelo self-healing agent
CREATE TABLE IF NOT EXISTS public.auto_healing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_account_id UUID REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  post_id UUID REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  category TEXT,
  reason TEXT,
  original_scheduled_at TIMESTAMPTZ,
  new_scheduled_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.auto_healing_log TO authenticated;
GRANT ALL ON public.auto_healing_log TO service_role;

ALTER TABLE public.auto_healing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "healing log admin or owner"
ON public.auto_healing_log FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR private.is_admin_principal(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_healing_log_account_time
  ON public.auto_healing_log (ig_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_healing_log_user_time
  ON public.auto_healing_log (user_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.auto_healing_log;

-- 2) Marcação de revisão manual em contas
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_review_reason TEXT,
  ADD COLUMN IF NOT EXISTS manual_review_at TIMESTAMPTZ;

-- 3) Acelerar cron do monitor de 3min para 1min
-- [Removed pg_cron unschedule block]

-- [Removed pg_cron schedule from migration]

-- ==========================================
-- MIGRATION: 20260808133500_add_caption_rotation.sql
-- ==========================================

-- Adiciona caption_2 e caption_3 para suportar rodízio de legendas
ALTER TABLE public.media_pools
  ADD COLUMN IF NOT EXISTS caption_2 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS caption_3 TEXT NOT NULL DEFAULT '';

-- 1. Garante que o bucket 'media' existe e é privado
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Limpa políticas antigas
DROP POLICY IF EXISTS "own media read" ON storage.objects;
DROP POLICY IF EXISTS "own media insert" ON storage.objects;
DROP POLICY IF EXISTS "own media update" ON storage.objects;
DROP POLICY IF EXISTS "own media delete" ON storage.objects;

-- 3. Cria políticas blindadas para o bucket usando owner_id em formato texto
CREATE POLICY "own media insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND auth.uid()::text = (string_to_array(name, '/'))[1]);

CREATE POLICY "own media read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND (owner_id = auth.uid()::text OR auth.uid()::text = (string_to_array(name, '/'))[1]));

CREATE POLICY "own media update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND (owner_id = auth.uid()::text OR auth.uid()::text = (string_to_array(name, '/'))[1]));

CREATE POLICY "own media delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND (owner_id = auth.uid()::text OR auth.uid()::text = (string_to_array(name, '/'))[1]));

-- 4. Correção para a tabela Notifications (Evita o erro 401)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

DROP POLICY IF EXISTS "notifications admin or owner" ON public.notifications;
DROP POLICY IF EXISTS "own notifications" ON public.notifications;

CREATE POLICY "notifications admin or owner" ON public.notifications FOR ALL TO authenticated
  USING (user_id = auth.uid() OR private.is_admin_principal(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR private.is_admin_principal(auth.uid()));

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
