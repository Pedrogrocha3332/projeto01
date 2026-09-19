BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.publication_round_accounts ADD COLUMN IF NOT EXISTS account_label text;
ALTER TABLE public.publication_round_accounts ALTER COLUMN ig_account_id DROP NOT NULL;
ALTER TABLE public.publication_round_accounts DROP CONSTRAINT IF EXISTS publication_round_accounts_ig_account_id_fkey;
ALTER TABLE public.publication_round_accounts ADD CONSTRAINT publication_round_accounts_ig_account_id_fkey FOREIGN KEY(ig_account_id) REFERENCES public.instagram_accounts(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.prepare_round_account_deletion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT pg_try_advisory_xact_lock(14092026) THEN RAISE EXCEPTION 'Publicação em atualização. Aguarde alguns segundos e tente desconectar novamente.'; END IF;
 IF EXISTS(SELECT 1 FROM scheduled_posts WHERE ig_account_id=OLD.id AND status='publishing') OR
 EXISTS(SELECT 1 FROM publication_send_leases l JOIN scheduled_posts p ON p.id=l.post_id WHERE p.ig_account_id=OLD.id AND l.expires_at>now()) THEN
  RAISE EXCEPTION 'Esta conta tem um envio em processamento. Aguarde a conclusão antes de desconectar.';
 END IF;
 UPDATE publication_round_accounts SET account_label='@'||OLD.username,stopped_at=coalesce(stopped_at,now()),stop_reason=coalesce(stop_reason,'Conta desconectada do painel') WHERE ig_account_id=OLD.id;
 RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS prepare_round_account_deletion ON public.instagram_accounts;
CREATE TRIGGER prepare_round_account_deletion BEFORE DELETE ON public.instagram_accounts FOR EACH ROW EXECUTE FUNCTION public.prepare_round_account_deletion();
REVOKE ALL ON FUNCTION public.prepare_round_account_deletion() FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.protect_round_media() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='scheduled_posts' THEN
  IF OLD.status<>'publishing' AND NOT EXISTS(SELECT 1 FROM publication_send_leases WHERE post_id=OLD.id AND expires_at>now())
   AND EXISTS(SELECT 1 FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id WHERE i.post_id=OLD.id AND a.stopped_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id WHERE i.post_id=OLD.id AND a.stopped_at IS NULL) THEN RETURN OLD; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM publication_round_items i JOIN publication_rounds r ON r.id=i.run_id WHERE r.status IN ('active','paused','failed') AND
 ((TG_TABLE_NAME='media_assets' AND i.media_asset_id=OLD.id) OR (TG_TABLE_NAME='scheduled_posts' AND i.post_id=OLD.id))) THEN
 RAISE EXCEPTION 'Este vídeo/post está em uma rodada em andamento. Encerre a execução antes de excluir';
 END IF;
 RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION public.protect_round_media() FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.control_publication_round(p_id uuid,p_user uuid,p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r publication_rounds%ROWTYPE; a publication_round_accounts%ROWTYPE; seq integer:=0; base integer; idx integer;
BEGIN
 PERFORM pg_advisory_xact_lock(14092026);
 SELECT * INTO r FROM publication_rounds WHERE id=p_id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Execução não encontrada'; END IF;
 IF p_action='pause' AND r.status='active' THEN UPDATE publication_rounds SET status='paused' WHERE id=p_id; RETURN; END IF;
 IF p_action='cancel' AND r.status IN ('draft','paused','failed') THEN
  IF EXISTS(SELECT 1 FROM publication_round_items i JOIN scheduled_posts s ON s.id=i.post_id WHERE i.run_id=p_id AND s.status='publishing') OR EXISTS(SELECT 1 FROM publication_send_leases l JOIN scheduled_posts s ON s.id=l.post_id WHERE s.round_run_id=p_id AND l.expires_at>now()) THEN RAISE EXCEPTION 'Aguarde o envio em processamento terminar antes de encerrar'; END IF;
  UPDATE scheduled_posts SET status='draft' WHERE round_run_id=p_id AND status<>'published';
  UPDATE publication_rounds SET status='cancelled' WHERE id=p_id; RETURN;
 END IF;
 IF p_action NOT IN ('start','resume') OR r.status NOT IN ('draft','paused','failed') THEN RAISE EXCEPTION 'Ação indisponível'; END IF;
 IF EXISTS(SELECT 1 FROM publication_rounds WHERE id<>p_id AND status IN ('active','paused','failed')) THEN RAISE EXCEPTION 'Outra execução já reserva a publicação deste painel'; END IF;
 IF EXISTS(SELECT 1 FROM media_pools WHERE status='active') THEN RAISE EXCEPTION 'Pause os pools normais antes de iniciar as rodadas'; END IF;
 IF EXISTS(SELECT 1 FROM scheduled_posts pending WHERE pending.round_run_id IS DISTINCT FROM p_id AND (pending.status='publishing' OR (pending.status IN ('scheduled','failed') AND (pending.round_run_id IS NULL OR EXISTS(SELECT 1 FROM publication_rounds other_run WHERE other_run.id=pending.round_run_id AND other_run.status IN ('active','paused','failed')))))) OR
    EXISTS(SELECT 1 FROM publication_send_leases l JOIN scheduled_posts s ON s.id=l.post_id WHERE s.round_run_id IS DISTINCT FROM p_id AND l.expires_at>now()) THEN RAISE EXCEPTION 'Resolva a fila normal pendente antes de iniciar'; END IF;
 IF NOT EXISTS(SELECT 1 FROM publication_round_accounts WHERE run_id=p_id) THEN RAISE EXCEPTION 'Adicione contas'; END IF;
 FOR a IN SELECT * FROM publication_round_accounts WHERE run_id=p_id AND stopped_at IS NULL LOOP
  IF NOT EXISTS(SELECT 1 FROM instagram_accounts WHERE id=a.ig_account_id AND is_active AND NOT coalesce(is_restricted,false)) THEN RAISE EXCEPTION 'Uma conta está desconectada ou restrita'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(a.video_ids) v WHERE NOT EXISTS(SELECT 1 FROM media_assets m WHERE m.id=v AND m.media_kind='video')) THEN RAISE EXCEPTION 'Um vídeo selecionado foi excluído ou não é vídeo'; END IF;
 END LOOP;
 IF r.status='draft' THEN
  FOR base IN 0..((r.total_per_account-1)/r.batch_size) LOOP
   FOR a IN SELECT * FROM publication_round_accounts WHERE run_id=p_id ORDER BY position LOOP
    FOR idx IN (base*r.batch_size)..least((base+1)*r.batch_size-1,r.total_per_account-1) LOOP
     INSERT INTO publication_round_items(run_id,participant_id,sequence,round_number,account_index,media_asset_id)
     VALUES(p_id,a.id,seq,base+1,idx,a.video_ids[(idx % cardinality(a.video_ids))+1]);
     seq:=seq+1;
    END LOOP;
   END LOOP;
  END LOOP;
 ELSE
  -- Retry usa o MESMO post/container; nunca pula vídeo ou cria outro para a tentativa.
  UPDATE scheduled_posts SET status=CASE WHEN ig_container_id IS NULL THEN 'scheduled' ELSE 'publishing' END,
   scheduled_at=greatest(scheduled_at,now()), last_error=NULL
  WHERE round_run_id=p_id AND status IN ('failed','failed_final','draft') AND EXISTS(SELECT 1 FROM publication_round_accounts eligible WHERE eligible.run_id=p_id AND eligible.ig_account_id=scheduled_posts.ig_account_id AND eligible.stopped_at IS NULL);
 END IF;
 UPDATE publication_rounds SET status='active',last_error=NULL WHERE id=p_id;
END; $$;

COMMIT;
