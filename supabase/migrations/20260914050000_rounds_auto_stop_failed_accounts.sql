BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.publication_round_accounts ADD COLUMN IF NOT EXISTS stopped_at timestamptz;
ALTER TABLE public.publication_round_accounts ADD COLUMN IF NOT EXISTS stop_reason text;
CREATE OR REPLACE FUNCTION public.tick_publication_rounds() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r publication_rounds%ROWTYPE; i publication_round_items%ROWTYPE; a publication_round_accounts%ROWTYPE; s scheduled_posts%ROWTYPE;
 current_round integer; current_group integer; pid uuid; ids uuid[] := '{}'; last_at timestamptz; cap text;
BEGIN
 PERFORM pg_advisory_xact_lock(14092026);
 SELECT * INTO r FROM publication_rounds WHERE status IN ('active','paused','failed') FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('reserved',false); END IF;
 -- Recupera automaticamente falhas de conta anteriores a esta atualização.
 UPDATE publication_round_accounts failed_account SET stopped_at=now(),stop_reason=coalesce(failed_post.last_error,'Falha na publicação')
 FROM publication_round_items failed_item JOIN scheduled_posts failed_post ON failed_post.id=failed_item.post_id
 WHERE failed_account.id=failed_item.participant_id AND failed_account.run_id=r.id AND failed_account.stopped_at IS NULL
 AND failed_post.status IN ('failed','failed_final','draft') AND (failed_item.confirmed_at IS NULL OR failed_item.confirmed_media_id IS NULL);
 IF r.status='failed' AND EXISTS(SELECT 1 FROM publication_round_accounts WHERE run_id=r.id AND stopped_at IS NOT NULL) THEN
  UPDATE publication_rounds SET status='active',last_error=NULL WHERE id=r.id;
  r.status:='active';
 END IF;
 IF r.status<>'active' THEN RETURN jsonb_build_object('reserved',true,'run_id',r.id,'concurrent_accounts',r.concurrent_accounts,'status',r.status); END IF;
 SELECT items.round_number, accounts.position/r.concurrent_accounts INTO current_round,current_group
 FROM publication_round_items items JOIN publication_round_accounts accounts ON accounts.id=items.participant_id
 WHERE items.run_id=r.id AND accounts.stopped_at IS NULL AND (items.confirmed_at IS NULL OR items.confirmed_media_id IS NULL) ORDER BY items.sequence LIMIT 1;
 IF NOT FOUND THEN UPDATE publication_rounds SET status='completed' WHERE id=r.id; RETURN jsonb_build_object('reserved',false,'status','completed'); END IF;
 FOR a IN SELECT * FROM publication_round_accounts WHERE run_id=r.id AND stopped_at IS NULL AND position/r.concurrent_accounts=current_group ORDER BY position LOOP
  SELECT * INTO i FROM publication_round_items WHERE run_id=r.id AND participant_id=a.id AND round_number=current_round
   AND (confirmed_at IS NULL OR confirmed_media_id IS NULL) ORDER BY sequence LIMIT 1;
  IF NOT FOUND THEN CONTINUE; END IF;
  IF i.post_id IS NOT NULL THEN
   SELECT * INTO s FROM scheduled_posts WHERE id=i.post_id;
   IF NOT FOUND OR s.status NOT IN ('scheduled','publishing') THEN
    UPDATE publication_round_accounts SET stopped_at=now(),stop_reason=coalesce(s.last_error,'Publicação sem confirmação') WHERE id=a.id;
    CONTINUE;
   END IF;
   ids:=array_append(ids,i.post_id);
   CONTINUE;
  END IF;
  IF i.media_asset_id IS NULL THEN UPDATE publication_round_accounts SET stopped_at=now(),stop_reason='Vídeo da rodada foi excluído' WHERE id=a.id; CONTINUE; END IF;
  SELECT max(confirmed_at) INTO last_at FROM publication_round_items WHERE run_id=r.id AND participant_id=a.id;
  cap:=CASE (i.account_index/6)%3 WHEN 1 THEN coalesce(nullif(a.caption_2,''),a.caption) WHEN 2 THEN coalesce(nullif(a.caption_3,''),a.caption) ELSE a.caption END;
  INSERT INTO scheduled_posts(user_id,ig_account_id,post_type,caption,scheduled_at,status,cover_media_id,round_run_id)
  VALUES(r.user_id,a.ig_account_id,'reel',cap,greatest(now(),coalesce(last_at,now())+CASE WHEN last_at IS NULL THEN interval '0 seconds' ELSE a.spacing_seconds*interval '1 second' END),'scheduled',a.cover_media_id,r.id) RETURNING id INTO pid;
  INSERT INTO post_media(post_id,media_asset_id,position) VALUES(pid,i.media_asset_id,0);
  UPDATE publication_round_items SET post_id=pid WHERE id=i.id;
  ids:=array_append(ids,pid);
 END LOOP;
 RETURN jsonb_build_object('reserved',true,'run_id',r.id,'post_id',ids[1],'post_ids',ids,'concurrent_accounts',r.concurrent_accounts,'group',current_group+1,'round',current_round);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_publication_send(p_post uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r publication_rounds%ROWTYPE; s scheduled_posts%ROWTYPE; expected uuid; current_round integer; current_group integer; participant uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(14092026);
 SELECT * INTO s FROM scheduled_posts WHERE id=p_post;
 IF NOT FOUND OR s.status='published' THEN RETURN false; END IF;
 SELECT * INTO r FROM publication_rounds WHERE status IN ('active','paused','failed');
 IF FOUND THEN
  IF s.round_run_id IS DISTINCT FROM r.id THEN RETURN false; END IF;
  IF r.status<>'active' AND NOT(r.status IN ('paused','failed') AND s.status='publishing' AND s.ig_container_id IS NOT NULL) THEN RETURN false; END IF;
  SELECT i.round_number,a.position/r.concurrent_accounts INTO current_round,current_group
  FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id
  WHERE i.run_id=r.id AND a.stopped_at IS NULL AND (i.confirmed_at IS NULL OR i.confirmed_media_id IS NULL) ORDER BY i.sequence LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT i.participant_id INTO participant FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id
   JOIN post_media m ON m.post_id=i.post_id AND m.media_asset_id=i.media_asset_id
   WHERE i.post_id=p_post AND i.run_id=r.id AND a.stopped_at IS NULL AND a.ig_account_id=s.ig_account_id AND i.round_number=current_round AND a.position/r.concurrent_accounts=current_group;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Permite o parceiro, mas nunca dois envios da mesma conta ou de outro grupo.
  IF EXISTS(SELECT 1 FROM publication_send_leases l JOIN scheduled_posts p ON p.id=l.post_id
   LEFT JOIN publication_round_items i ON i.post_id=p.id LEFT JOIN publication_round_accounts a ON a.id=i.participant_id
   WHERE l.post_id<>p_post AND l.expires_at>now() AND a.stopped_at IS NULL AND (p.ig_account_id=s.ig_account_id OR p.round_run_id IS DISTINCT FROM r.id
    OR i.round_number IS DISTINCT FROM current_round OR a.position/r.concurrent_accounts IS DISTINCT FROM current_group)) THEN RETURN false; END IF;
  SELECT post_id INTO expected FROM publication_round_items WHERE run_id=r.id AND participant_id=participant AND round_number=current_round
   AND (confirmed_at IS NULL OR confirmed_media_id IS NULL) ORDER BY sequence LIMIT 1;
  IF p_post IS DISTINCT FROM expected OR s.scheduled_at>now() OR s.status NOT IN ('scheduled','publishing') THEN RETURN false; END IF;
 ELSIF s.round_run_id IS NOT NULL THEN RETURN false;
 END IF;
 INSERT INTO publication_send_leases(post_id,token,expires_at) VALUES(p_post,p_token,now()+interval '15 minutes')
 ON CONFLICT(post_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE publication_send_leases.expires_at<now();
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.tick_publication_rounds(),public.claim_publication_send(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tick_publication_rounds(),public.claim_publication_send(uuid,uuid) TO service_role;
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
 IF EXISTS(SELECT 1 FROM scheduled_posts WHERE round_run_id IS DISTINCT FROM p_id AND status IN ('scheduled','publishing','failed')) OR
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

CREATE OR REPLACE FUNCTION public.round_post_failed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.round_run_id IS NOT NULL AND NEW.status='published' AND NEW.ig_media_id IS NOT NULL THEN
  UPDATE publication_round_items SET confirmed_at=coalesce(NEW.published_at,now()),confirmed_media_id=NEW.ig_media_id WHERE post_id=NEW.id;
 END IF;
 IF NEW.round_run_id IS NOT NULL AND NEW.status IN ('failed','failed_final','draft') THEN
  UPDATE publication_round_accounts a SET stopped_at=now(),stop_reason=coalesce(NEW.last_error,'Publicação interrompida')
  WHERE a.run_id=NEW.round_run_id AND a.ig_account_id=NEW.ig_account_id AND a.stopped_at IS NULL
   AND EXISTS(SELECT 1 FROM publication_rounds r WHERE r.id=a.run_id AND r.status IN ('active','paused','failed'));
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.round_post_failed() FROM PUBLIC;
COMMIT;
