
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
SELECT cron.schedule(
  'elite-process-pools',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--7cc17ba5-0136-4079-90d7-e62a71f62980.lovable.app/api/public/cron/process-pools',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey', current_setting('app.settings.supabase_publishable_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
