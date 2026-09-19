ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_offset integer,
  ADD COLUMN IF NOT EXISTS ig_permalink text;