
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
