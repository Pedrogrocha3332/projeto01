-- Adiciona colunas para armazenamento de métricas de engajamento e views em tempo real
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS view_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS like_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reach_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_updated_at TIMESTAMPTZ;

-- Índice para consultas de posts com métricas recentes
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_metrics
  ON public.scheduled_posts(status, metrics_updated_at DESC)
  WHERE status = 'published';
