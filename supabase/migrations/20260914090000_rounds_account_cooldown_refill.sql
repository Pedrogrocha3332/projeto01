BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE public.publication_rounds ADD COLUMN IF NOT EXISTS active_participant_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.publication_rounds ADD COLUMN IF NOT EXISTS active_round_number integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.tick_publication_rounds() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r publication_rounds%ROWTYPE; a publication_round_accounts%ROWTYPE; item publication_round_items%ROWTYPE; post scheduled_posts%ROWTYPE;
 round_no integer; members uuid[]; candidate uuid; ids uuid[]:='{}'; pid uuid; last_at timestamptz; previous_at timestamptz;
 due_at timestamptz; cap text; earliest_due timestamptz; any_ready boolean:=false;
BEGIN
 PERFORM pg_advisory_xact_lock(14092026);
 SELECT * INTO r FROM publication_rounds WHERE status IN ('active','paused','failed') FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('reserved',false); END IF;
 UPDATE publication_round_accounts failed_account SET stopped_at=now(),stop_reason=coalesce(failed_post.last_error,'Falha na publicação')
 FROM publication_round_items failed_item JOIN scheduled_posts failed_post ON failed_post.id=failed_item.post_id
 WHERE failed_account.id=failed_item.participant_id AND failed_account.run_id=r.id AND failed_account.stopped_at IS NULL
 AND failed_post.status IN ('failed','failed_final','draft') AND (failed_item.confirmed_at IS NULL OR failed_item.confirmed_media_id IS NULL);
 IF r.status='failed' AND EXISTS(SELECT 1 FROM publication_round_accounts WHERE run_id=r.id AND stopped_at IS NOT NULL) THEN
  UPDATE publication_rounds SET status='active',last_error=NULL WHERE id=r.id; r.status:='active';
 END IF;

 SELECT min(i.round_number) INTO round_no FROM publication_round_items i JOIN publication_round_accounts participants ON participants.id=i.participant_id
 WHERE i.run_id=r.id AND participants.stopped_at IS NULL AND participants.ig_account_id IS NOT NULL
 AND (i.confirmed_at IS NULL OR i.confirmed_media_id IS NULL);
 IF round_no IS NULL THEN
 IF r.status<>'active' THEN RETURN jsonb_build_object('reserved',true,'run_id',r.id,'concurrent_accounts',r.concurrent_accounts,'status',r.status); END IF;
  UPDATE publication_rounds SET status='completed',active_participant_ids='{}',next_round_at=NULL WHERE id=r.id;
  RETURN jsonb_build_object('reserved',false,'status','completed');
 END IF;
 -- Contas que terminaram permanecem no grupo até suas parceiras terminarem.
 -- Somente falhas/desconexões liberam vagas antes disso.
 SELECT coalesce(array_agg(participants.id ORDER BY participants.position),'{}') INTO members
 FROM publication_round_accounts participants WHERE participants.run_id=r.id AND participants.id=ANY(r.active_participant_ids)
 AND participants.stopped_at IS NULL AND participants.ig_account_id IS NOT NULL;
 IF r.active_round_number<>round_no OR NOT EXISTS(SELECT 1 FROM publication_round_items i WHERE i.run_id=r.id
  AND i.participant_id=ANY(members) AND i.round_number=round_no AND (i.confirmed_at IS NULL OR i.confirmed_media_id IS NULL)) THEN members:='{}'; END IF;
 WHILE cardinality(members)<r.concurrent_accounts LOOP
  SELECT participants.id INTO candidate FROM publication_round_accounts participants WHERE participants.run_id=r.id
   AND participants.stopped_at IS NULL AND participants.ig_account_id IS NOT NULL AND NOT(participants.id=ANY(members))
   AND EXISTS(SELECT 1 FROM publication_round_items i WHERE i.participant_id=participants.id AND i.round_number=round_no AND (i.confirmed_at IS NULL OR i.confirmed_media_id IS NULL))
   ORDER BY EXISTS(SELECT 1 FROM publication_round_items i JOIN scheduled_posts p ON p.id=i.post_id WHERE i.participant_id=participants.id
     AND i.round_number=round_no AND p.status IN ('scheduled','publishing') AND (i.confirmed_at IS NULL OR i.confirmed_media_id IS NULL)) DESC,participants.position LIMIT 1;
  EXIT WHEN NOT FOUND;
  members:=array_append(members,candidate);
 END LOOP;
 UPDATE publication_rounds SET active_participant_ids=members,active_round_number=round_no,next_round_at=NULL WHERE id=r.id;
 IF r.status<>'active' THEN RETURN jsonb_build_object('reserved',true,'run_id',r.id,'concurrent_accounts',r.concurrent_accounts,'status',r.status); END IF;
 FOR a IN SELECT * FROM publication_round_accounts WHERE id=ANY(members) ORDER BY position LOOP
  SELECT * INTO item FROM publication_round_items WHERE run_id=r.id AND participant_id=a.id AND round_number=round_no
   AND (confirmed_at IS NULL OR confirmed_media_id IS NULL) ORDER BY sequence LIMIT 1;
  IF NOT FOUND THEN CONTINUE; END IF;
  IF item.post_id IS NOT NULL THEN
   SELECT * INTO post FROM scheduled_posts WHERE id=item.post_id;
   IF NOT FOUND OR post.status NOT IN ('scheduled','publishing') THEN
    UPDATE publication_round_accounts SET stopped_at=now(),stop_reason=coalesce(post.last_error,'Publicação sem confirmação') WHERE id=a.id;
    CONTINUE;
   END IF;
   ids:=array_append(ids,post.id);
   any_ready:=any_ready OR post.status='publishing' OR post.scheduled_at<=now();
   earliest_due:=least(earliest_due,post.scheduled_at);
   CONTINUE;
  END IF;
  IF item.media_asset_id IS NULL THEN UPDATE publication_round_accounts SET stopped_at=now(),stop_reason='Vídeo da rodada foi excluído' WHERE id=a.id; CONTINUE; END IF;
  SELECT max(confirmed_at) INTO last_at FROM publication_round_items WHERE run_id=r.id AND participant_id=a.id;
  SELECT max(confirmed_at) INTO previous_at FROM publication_round_items WHERE run_id=r.id AND participant_id=a.id AND round_number=round_no-1 AND confirmed_media_id IS NOT NULL;
  due_at:=greatest(now(),last_at+a.spacing_seconds*interval '1 second',previous_at+r.round_interval_minutes*interval '1 minute');
  cap:=CASE (item.account_index/6)%3 WHEN 1 THEN coalesce(nullif(a.caption_2,''),a.caption) WHEN 2 THEN coalesce(nullif(a.caption_3,''),a.caption) ELSE a.caption END;
  INSERT INTO scheduled_posts(user_id,ig_account_id,post_type,caption,scheduled_at,status,cover_media_id,round_run_id)
  VALUES(r.user_id,a.ig_account_id,'reel',cap,due_at,'scheduled',a.cover_media_id,r.id) RETURNING id INTO pid;
  INSERT INTO post_media(post_id,media_asset_id,position) VALUES(pid,item.media_asset_id,0);
  UPDATE publication_round_items SET post_id=pid WHERE id=item.id;
  ids:=array_append(ids,pid); any_ready:=any_ready OR due_at<=now(); earliest_due:=least(earliest_due,due_at);
 END LOOP;
 UPDATE publication_rounds SET next_round_at=CASE WHEN NOT any_ready AND earliest_due>now() THEN earliest_due ELSE NULL END WHERE id=r.id;
 RETURN jsonb_build_object('reserved',true,'run_id',r.id,'post_id',ids[1],'post_ids',ids,'concurrent_accounts',r.concurrent_accounts,
  'round',round_no,'status',CASE WHEN NOT any_ready AND earliest_due>now() THEN 'waiting' ELSE 'active' END,'next_round_at',CASE WHEN NOT any_ready THEN earliest_due ELSE NULL END);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_publication_send(p_post uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r publication_rounds%ROWTYPE; s scheduled_posts%ROWTYPE; item publication_round_items%ROWTYPE; expected uuid; previous_at timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(14092026);
 SELECT * INTO s FROM scheduled_posts WHERE id=p_post;
 IF NOT FOUND OR s.status='published' THEN RETURN false; END IF;
 SELECT * INTO r FROM publication_rounds WHERE status IN ('active','paused','failed');
 IF FOUND THEN
  IF s.round_run_id IS DISTINCT FROM r.id THEN RETURN false; END IF;
  IF r.status<>'active' AND NOT(r.status IN ('paused','failed') AND s.status='publishing' AND s.ig_container_id IS NOT NULL) THEN RETURN false; END IF;
  SELECT i.* INTO item FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id
   JOIN post_media m ON m.post_id=i.post_id AND m.media_asset_id=i.media_asset_id
   WHERE i.post_id=p_post AND i.run_id=r.id AND a.stopped_at IS NULL AND a.ig_account_id=s.ig_account_id
    AND i.round_number=r.active_round_number AND i.participant_id=ANY(r.active_participant_ids);
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT post_id INTO expected FROM publication_round_items WHERE run_id=r.id AND participant_id=item.participant_id AND round_number=item.round_number
   AND (confirmed_at IS NULL OR confirmed_media_id IS NULL) ORDER BY sequence LIMIT 1;
  IF p_post IS DISTINCT FROM expected OR s.scheduled_at>now() OR s.status NOT IN ('scheduled','publishing') THEN RETURN false; END IF;
  SELECT max(confirmed_at) INTO previous_at FROM publication_round_items WHERE run_id=r.id AND participant_id=item.participant_id
   AND round_number=item.round_number-1 AND confirmed_media_id IS NOT NULL;
  -- Um envio iniciado antes da atualização pode concluir. Novos envios respeitam a espera da própria conta.
  IF s.status<>'publishing' AND previous_at+r.round_interval_minutes*interval '1 minute'>now() THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM publication_send_leases l JOIN scheduled_posts p ON p.id=l.post_id
   LEFT JOIN publication_round_items i ON i.post_id=p.id LEFT JOIN publication_round_accounts a ON a.id=i.participant_id
   WHERE l.post_id<>p_post AND l.expires_at>now() AND a.stopped_at IS NULL
   AND (p.ig_account_id=s.ig_account_id OR p.round_run_id IS DISTINCT FROM r.id OR i.round_number IS DISTINCT FROM r.active_round_number
    OR NOT(i.participant_id=ANY(r.active_participant_ids)))) THEN RETURN false; END IF;
 ELSIF s.round_run_id IS NOT NULL THEN RETURN false;
 END IF;
 INSERT INTO publication_send_leases(post_id,token,expires_at) VALUES(p_post,p_token,now()+interval '15 minutes')
 ON CONFLICT(post_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE publication_send_leases.expires_at<now();
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.tick_publication_rounds(),public.claim_publication_send(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tick_publication_rounds(),public.claim_publication_send(uuid,uuid) TO service_role;
COMMIT;
