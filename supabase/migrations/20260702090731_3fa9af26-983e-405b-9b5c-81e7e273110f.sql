
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
