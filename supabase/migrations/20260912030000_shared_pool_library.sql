BEGIN;

-- Muda apenas a validação de NOVOS vínculos. Não modifica pools, mídias ou posts.
-- SECURITY INVOKER (padrão): as consultas respeitam as políticas RLS existentes.
CREATE OR REPLACE FUNCTION public.check_pool_video_account() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- Preserva o fluxo administrativo já existente de copiar painéis.
  IF current_user = 'service_role' THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.media_pools p
    JOIN public.instagram_accounts a ON a.id = p.ig_account_id
    WHERE p.id = NEW.pool_id
  ) THEN
    RAISE EXCEPTION 'Pool ou conta de publicação não encontrado ou sem acesso';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.media_assets
    WHERE id = NEW.media_asset_id AND media_kind = 'video'
  ) THEN
    RAISE EXCEPTION 'Selecione somente vídeos disponíveis na sua Biblioteca';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
