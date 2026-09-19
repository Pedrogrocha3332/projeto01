BEGIN;
SET LOCAL lock_timeout = '2s';
CREATE TABLE IF NOT EXISTS public.media_folders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_folders ON public.media_folders;
CREATE POLICY own_folders ON public.media_folders FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.media_folders TO authenticated;
GRANT ALL ON public.media_folders TO service_role;
-- A existência da coluna marca a migração inicial: reaplicar não reorganiza vídeos.
DO $$
DECLARE bucket record; folder uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='media_assets' AND column_name='folder_id') THEN
  ALTER TABLE public.media_assets ADD COLUMN folder_id uuid REFERENCES public.media_folders(id) ON DELETE SET NULL;
  CREATE TEMP TABLE initial_video_folders ON COMMIT DROP AS
   SELECT id,user_id,((row_number() OVER(PARTITION BY user_id ORDER BY created_at,id)-1)/15)::int AS batch
   FROM public.media_assets WHERE media_kind='video';
  FOR bucket IN SELECT DISTINCT user_id,batch FROM initial_video_folders ORDER BY user_id,batch LOOP
   INSERT INTO public.media_folders(user_id,name) VALUES(bucket.user_id,'Pasta '||(bucket.batch+1)) RETURNING id INTO folder;
   UPDATE public.media_assets SET folder_id=folder WHERE id IN(SELECT id FROM initial_video_folders WHERE user_id=bucket.user_id AND batch=bucket.batch);
  END LOOP;
 END IF;
END; $$;
CREATE INDEX IF NOT EXISTS media_assets_folder_idx ON public.media_assets(folder_id);
CREATE OR REPLACE FUNCTION public.check_video_folder() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_folders WHERE id=NEW.folder_id AND user_id=NEW.user_id) THEN
  RAISE EXCEPTION 'Pasta não encontrada ou pertence a outro usuário';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS check_video_folder ON public.media_assets;
CREATE TRIGGER check_video_folder BEFORE INSERT OR UPDATE OF folder_id,user_id ON public.media_assets FOR EACH ROW EXECUTE FUNCTION public.check_video_folder();
CREATE OR REPLACE FUNCTION public.move_videos_to_folder(p_ids uuid[],p_folder uuid) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE moved integer;
BEGIN
 IF cardinality(p_ids) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Selecione de 1 a 500 vídeos'; END IF;
 IF NOT EXISTS(SELECT 1 FROM media_folders WHERE id=p_folder AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Pasta não encontrada'; END IF;
 IF (SELECT count(DISTINCT id) FROM media_assets WHERE id=ANY(p_ids) AND user_id=auth.uid() AND media_kind='video')<>cardinality(p_ids) THEN RAISE EXCEPTION 'Vídeos indisponíveis ou sem permissão'; END IF;
 UPDATE media_assets SET folder_id=p_folder WHERE id=ANY(p_ids) AND user_id=auth.uid() AND media_kind='video';
 GET DIAGNOSTICS moved=ROW_COUNT; RETURN moved;
END; $$;
REVOKE ALL ON FUNCTION public.move_videos_to_folder(uuid[],uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_videos_to_folder(uuid[],uuid) TO authenticated;
COMMIT;
