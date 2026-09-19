BEGIN;
SET LOCAL lock_timeout = '2s';
-- Zero mantém a regra de todas as execuções existentes, inclusive ativas.
ALTER TABLE public.publication_rounds ADD COLUMN IF NOT EXISTS round_interval_minutes integer NOT NULL DEFAULT 0 CHECK(round_interval_minutes BETWEEN 0 AND 10080);
ALTER TABLE public.publication_rounds ADD COLUMN IF NOT EXISTS ready_round integer NOT NULL DEFAULT 1;
ALTER TABLE public.publication_rounds ADD COLUMN IF NOT EXISTS next_round_at timestamptz;
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
 IF current_round>r.ready_round THEN
  SELECT max(CASE WHEN previous.confirmed_at IS NOT NULL AND previous.confirmed_media_id IS NOT NULL THEN previous.confirmed_at ELSE participant.stopped_at END)
   INTO last_at FROM publication_round_items previous JOIN publication_round_accounts participant ON participant.id=previous.participant_id
   WHERE previous.run_id=r.id AND previous.round_number=current_round-1;
  r.next_round_at:=coalesce(last_at,now())+r.round_interval_minutes*interval '1 minute';
  r.ready_round:=current_round;
  UPDATE publication_rounds SET ready_round=r.ready_round,next_round_at=r.next_round_at WHERE id=r.id;
 END IF;
 IF r.round_interval_minutes>0 AND r.next_round_at>now() THEN
  RETURN jsonb_build_object('reserved',true,'run_id',r.id,'concurrent_accounts',r.concurrent_accounts,'status','waiting','next_round_at',r.next_round_at,'post_ids','[]'::jsonb);
 END IF;
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
  IF r.round_interval_minutes>0 AND (current_round>r.ready_round OR r.next_round_at>now()) THEN RETURN false; END IF;
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
CREATE OR REPLACE FUNCTION public.save_publication_round(p_user uuid,p_id uuid,p_config jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; a jsonb; pos integer:=0;
BEGIN
 IF p_id IS NOT NULL THEN
  SELECT id INTO rid FROM publication_rounds WHERE id=p_id AND user_id=p_user AND status='draft' FOR UPDATE;
  IF rid IS NULL THEN RAISE EXCEPTION 'Somente rascunhos próprios podem ser editados'; END IF;
  UPDATE publication_rounds SET round_interval_minutes=coalesce((p_config->>'round_interval_minutes')::int,0),name=p_config->>'name',batch_size=(p_config->>'batch_size')::int,total_per_account=(p_config->>'total_per_account')::int,concurrent_accounts=coalesce((p_config->>'concurrent_accounts')::int,2) WHERE id=rid;
  DELETE FROM publication_round_accounts WHERE run_id=rid;
 ELSE
  INSERT INTO publication_rounds(user_id,name,batch_size,total_per_account,concurrent_accounts,round_interval_minutes) VALUES(p_user,p_config->>'name',(p_config->>'batch_size')::int,(p_config->>'total_per_account')::int,coalesce((p_config->>'concurrent_accounts')::int,2),coalesce((p_config->>'round_interval_minutes')::int,0)) RETURNING id INTO rid;
 END IF;
 IF jsonb_array_length(p_config->'accounts') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Selecione de 1 a 100 contas'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p_config->'accounts') LOOP
  INSERT INTO publication_round_accounts(run_id,ig_account_id,position,video_ids,caption,caption_2,caption_3,spacing_seconds,cover_media_id,first_comment)
  VALUES(rid,(a->>'ig_account_id')::uuid,pos,ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(a->'video_ids')),coalesce(a->>'caption',''),coalesce(a->>'caption_2',''),coalesce(a->>'caption_3',''),(a->>'spacing_seconds')::int,(a->>'cover_media_id')::uuid,nullif(btrim(a->>'first_comment'),''));
  pos:=pos+1;
 END LOOP;
 RETURN rid;
END; $$;

CREATE OR REPLACE FUNCTION public.protect_round_interval() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.status<>'draft' AND NEW.round_interval_minutes IS DISTINCT FROM OLD.round_interval_minutes THEN
  RAISE EXCEPTION 'Defina a espera entre rodadas antes de iniciar. Execuções iniciadas mantêm sua configuração.';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS protect_round_interval ON public.publication_rounds;
CREATE TRIGGER protect_round_interval BEFORE UPDATE ON public.publication_rounds FOR EACH ROW EXECUTE FUNCTION public.protect_round_interval();
REVOKE ALL ON FUNCTION public.protect_round_interval() FROM PUBLIC;
COMMIT;
