-- Adiciona caption_2 e caption_3 para suportar rodízio de legendas
ALTER TABLE public.media_pools
  ADD COLUMN IF NOT EXISTS caption_2 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS caption_3 TEXT NOT NULL DEFAULT '';
