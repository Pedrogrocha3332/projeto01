
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
