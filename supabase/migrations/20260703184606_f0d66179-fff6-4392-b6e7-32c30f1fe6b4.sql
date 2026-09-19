-- Explicit column-level revocation of sensitive Instagram token columns for the
-- authenticated PostgREST role. The prior migration granted SELECT on only the
-- non-sensitive columns; this makes the revocation of access_token/token_expires_at
-- explicit and idempotent so future audits can confirm it directly.
REVOKE SELECT (access_token) ON public.instagram_accounts FROM authenticated;
REVOKE SELECT (access_token) ON public.instagram_accounts FROM anon;