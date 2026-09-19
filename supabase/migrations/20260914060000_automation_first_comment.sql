BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.media_pools ADD COLUMN IF NOT EXISTS first_comment text CHECK (length(first_comment)<=2200);
ALTER TABLE public.publication_round_accounts ADD COLUMN IF NOT EXISTS first_comment text CHECK (length(first_comment)<=2200);
-- Apenas posts novos recebem o comentário. Não altera fila, contadores nem horários existentes.
CREATE OR REPLACE FUNCTION public.set_automation_first_comment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF nullif(btrim(NEW.first_comment),'') IS NOT NULL THEN RETURN NEW; END IF;
 IF NEW.round_run_id IS NOT NULL THEN
  SELECT nullif(btrim(a.first_comment),'') INTO NEW.first_comment FROM publication_round_accounts a
   WHERE a.run_id=NEW.round_run_id AND a.ig_account_id=NEW.ig_account_id;
 ELSIF NEW.source_pool_id IS NOT NULL THEN
  SELECT nullif(btrim(p.first_comment),'') INTO NEW.first_comment FROM media_pools p WHERE p.id=NEW.source_pool_id;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS set_automation_first_comment ON public.scheduled_posts;
CREATE TRIGGER set_automation_first_comment BEFORE INSERT ON public.scheduled_posts FOR EACH ROW EXECUTE FUNCTION public.set_automation_first_comment();
REVOKE ALL ON FUNCTION public.set_automation_first_comment() FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.save_publication_round(p_user uuid,p_id uuid,p_config jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; a jsonb; pos integer:=0;
BEGIN
 IF p_id IS NOT NULL THEN
  SELECT id INTO rid FROM publication_rounds WHERE id=p_id AND user_id=p_user AND status='draft' FOR UPDATE;
  IF rid IS NULL THEN RAISE EXCEPTION 'Somente rascunhos próprios podem ser editados'; END IF;
  UPDATE publication_rounds SET name=p_config->>'name',batch_size=(p_config->>'batch_size')::int,total_per_account=(p_config->>'total_per_account')::int,concurrent_accounts=coalesce((p_config->>'concurrent_accounts')::int,2) WHERE id=rid;
  DELETE FROM publication_round_accounts WHERE run_id=rid;
 ELSE
  INSERT INTO publication_rounds(user_id,name,batch_size,total_per_account,concurrent_accounts) VALUES(p_user,p_config->>'name',(p_config->>'batch_size')::int,(p_config->>'total_per_account')::int,coalesce((p_config->>'concurrent_accounts')::int,2)) RETURNING id INTO rid;
 END IF;
 IF jsonb_array_length(p_config->'accounts') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Selecione de 1 a 100 contas'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p_config->'accounts') LOOP
  INSERT INTO publication_round_accounts(run_id,ig_account_id,position,video_ids,caption,caption_2,caption_3,spacing_seconds,cover_media_id,first_comment)
  VALUES(rid,(a->>'ig_account_id')::uuid,pos,ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(a->'video_ids')),coalesce(a->>'caption',''),coalesce(a->>'caption_2',''),coalesce(a->>'caption_3',''),(a->>'spacing_seconds')::int,(a->>'cover_media_id')::uuid,nullif(btrim(a->>'first_comment'),''));
  pos:=pos+1;
 END LOOP;
 RETURN rid;
END; $$;

COMMIT;
