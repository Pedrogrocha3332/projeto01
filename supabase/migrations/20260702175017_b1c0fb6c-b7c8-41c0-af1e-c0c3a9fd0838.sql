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