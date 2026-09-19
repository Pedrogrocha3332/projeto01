BEGIN;

-- Organização da biblioteca. Nenhum arquivo ou vínculo existente de pool é movido.
ALTER TABLE public.media_assets ADD COLUMN IF NOT EXISTS ig_account_id uuid
  REFERENCES public.instagram_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS media_assets_account_idx ON public.media_assets(ig_account_id);
ALTER TABLE public.media_pools ADD COLUMN IF NOT EXISTS manual_order boolean NOT NULL DEFAULT false;

-- Executa com as permissões do chamador e respeita as políticas RLS existentes.
CREATE OR REPLACE FUNCTION public.check_media_library_account() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.ig_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.instagram_accounts WHERE id = NEW.ig_account_id
  ) THEN
    RAISE EXCEPTION 'Conta não encontrada ou sem acesso';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS check_media_library_account ON public.media_assets;
CREATE TRIGGER check_media_library_account BEFORE INSERT OR UPDATE OF ig_account_id
ON public.media_assets FOR EACH ROW EXECUTE FUNCTION public.check_media_library_account();

-- Valida apenas novos vínculos. Rotação e pools antigos continuam funcionando.
CREATE OR REPLACE FUNCTION public.check_pool_video_account() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE account_id uuid;
BEGIN
  -- A cópia administrativa de painéis preserva vínculos legados (inclusive compartilhados).
  -- Novos vínculos da interface usam authenticated e passam pela validação abaixo.
  IF current_user = 'service_role' THEN RETURN NEW; END IF;
  SELECT ig_account_id INTO account_id FROM public.media_pools WHERE id = NEW.pool_id;
  IF account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.media_assets
    WHERE id = NEW.media_asset_id AND media_kind = 'video' AND ig_account_id = account_id
  ) THEN
    RAISE EXCEPTION 'Vincule o vídeo à conta deste pool na Biblioteca antes de adicioná-lo';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS check_pool_video_account ON public.pool_videos;
CREATE TRIGGER check_pool_video_account BEFORE INSERT OR UPDATE OF pool_id, media_asset_id
ON public.pool_videos FOR EACH ROW EXECUTE FUNCTION public.check_pool_video_account();

-- Salva toda a ordem numa transação. Não altera consumo do ciclo nem posts agendados.
CREATE OR REPLACE FUNCTION public.save_pool_video_order(p_pool_id uuid, p_video_ids uuid[], p_manual boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE pool_status text; total integer;
BEGIN
  SELECT status INTO pool_status FROM public.media_pools WHERE id = p_pool_id FOR UPDATE;
  IF pool_status IS NULL THEN RAISE EXCEPTION 'Pool não encontrado ou sem acesso'; END IF;
  IF pool_status <> 'paused' THEN RAISE EXCEPTION 'Pause o pool antes de salvar a ordem'; END IF;
  IF p_video_ids IS NULL OR p_manual IS NULL THEN RAISE EXCEPTION 'Ordem inválida'; END IF;
  PERFORM id FROM public.pool_videos WHERE pool_id = p_pool_id FOR UPDATE;
  SELECT count(*) INTO total FROM public.pool_videos WHERE pool_id = p_pool_id;
  IF cardinality(p_video_ids) <> total OR
     (SELECT count(DISTINCT id) FROM unnest(p_video_ids) AS u(id)) <> total OR
     EXISTS (SELECT 1 FROM unnest(p_video_ids) AS u(id) WHERE NOT EXISTS (
       SELECT 1 FROM public.pool_videos v WHERE v.id = u.id AND v.pool_id = p_pool_id
     )) THEN
    RAISE EXCEPTION 'Os vídeos do pool mudaram. Atualize a página e tente novamente';
  END IF;
  UPDATE public.pool_videos v SET position = u.pos - 1
  FROM unnest(p_video_ids) WITH ORDINALITY AS u(id, pos)
  WHERE v.id = u.id AND v.pool_id = p_pool_id;
  UPDATE public.media_pools SET manual_order = p_manual WHERE id = p_pool_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_pool_video_order(uuid, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_pool_video_order(uuid, uuid[], boolean) TO authenticated;

COMMIT;
