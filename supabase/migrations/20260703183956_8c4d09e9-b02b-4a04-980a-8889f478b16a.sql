ALTER TABLE public.media_assets ADD COLUMN IF NOT EXISTS thumbnail_path text;
ALTER TABLE public.media_assets ADD COLUMN IF NOT EXISTS thumbnail_url text;