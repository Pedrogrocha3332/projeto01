BEGIN;
ALTER TABLE public.media_pools ADD COLUMN IF NOT EXISTS reel_limit integer NOT NULL DEFAULT 40 CHECK (reel_limit >= 1);
ALTER TABLE public.media_pools ADD COLUMN IF NOT EXISTS reels_reserved integer NOT NULL DEFAULT 0;
-- Preserva o histórico: excluir posts da fila não devolve vagas.
UPDATE public.media_pools p SET reels_reserved = GREATEST(p.reels_reserved, p.reels_published,
 (SELECT count(*)::integer FROM public.scheduled_posts s WHERE s.source_pool_id=p.id),
 (SELECT count(*)::integer FROM public.pool_execution_log l WHERE l.pool_id=p.id));
UPDATE public.media_pools SET status='paused', next_batch_at=NULL WHERE reels_reserved >= reel_limit;
CREATE OR REPLACE FUNCTION public.reserve_pool_reel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.source_pool_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' THEN
   IF NEW.source_pool_id IS NOT DISTINCT FROM OLD.source_pool_id THEN RETURN NEW; END IF;
 END IF;
 UPDATE public.media_pools SET reels_reserved=reels_reserved+1,
   status=CASE WHEN reels_reserved+1 >= reel_limit THEN 'paused' ELSE status END,
   next_batch_at=CASE WHEN reels_reserved+1 >= reel_limit THEN NULL ELSE next_batch_at END
 WHERE id=NEW.source_pool_id AND reels_reserved < reel_limit;
 IF NOT FOUND THEN RAISE EXCEPTION 'Limite total de reels atingido neste pool'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_pool_reel() FROM PUBLIC;
DROP TRIGGER IF EXISTS reserve_pool_reel ON public.scheduled_posts;
CREATE TRIGGER reserve_pool_reel BEFORE INSERT OR UPDATE OF source_pool_id ON public.scheduled_posts
FOR EACH ROW EXECUTE FUNCTION public.reserve_pool_reel();
CREATE OR REPLACE FUNCTION public.pause_pool_at_limit() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF GREATEST(NEW.reels_reserved, NEW.reels_published) >= NEW.reel_limit THEN
   NEW.status='paused'; NEW.next_batch_at=NULL;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pause_pool_at_limit ON public.media_pools;
CREATE TRIGGER pause_pool_at_limit BEFORE UPDATE ON public.media_pools
FOR EACH ROW EXECUTE FUNCTION public.pause_pool_at_limit();
COMMIT;
