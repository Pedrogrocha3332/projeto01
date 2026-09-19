-- Permite lotes definidos pelo usuário e espaçamento zero.
ALTER TABLE public.media_pools DROP CONSTRAINT IF EXISTS media_pools_batch_size_check;
ALTER TABLE public.media_pools ADD CONSTRAINT media_pools_batch_size_check CHECK (batch_size >= 1);
ALTER TABLE public.media_pools DROP CONSTRAINT IF EXISTS media_pools_spacing_seconds_check;
ALTER TABLE public.media_pools ADD CONSTRAINT media_pools_spacing_seconds_check CHECK (spacing_seconds >= 0 AND spacing_seconds <= 1800);
