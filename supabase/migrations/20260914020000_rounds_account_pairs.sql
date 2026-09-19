BEGIN;
-- Dois participantes por grupo. Não altera plano, legendas, limites ou progresso existentes.
CREATE OR REPLACE FUNCTION public.tick_publication_rounds() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r publication_rounds%ROWTYPE; i publication_round_items%ROWTYPE; a publication_round_accounts%ROWTYPE; s scheduled_posts%ROWTYPE;
 current_round integer; current_group integer; pid uuid; ids uuid[] := '{}'; last_at timestamptz; cap text;
BEGIN
 PERFORM pg_advisory_xact_lock(14092026);
 SELECT * INTO r FROM publication_rounds WHERE status IN ('active','paused','failed') FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('reserved',false); END IF;
 IF r.status<>'active' THEN RETURN jsonb_build_object('reserved',true,'run_id',r.id,'status',r.status); END IF;
 SELECT items.round_number, accounts.position/2 INTO current_round,current_group
 FROM publication_round_items items JOIN publication_round_accounts accounts ON accounts.id=items.participant_id
 WHERE items.run_id=r.id AND (items.confirmed_at IS NULL OR items.confirmed_media_id IS NULL) ORDER BY items.sequence LIMIT 1;
 IF NOT FOUND THEN UPDATE publication_rounds SET status='completed' WHERE id=r.id; RETURN jsonb_build_object('reserved',false,'status','completed'); END IF;
 FOR a IN SELECT * FROM publication_round_accounts WHERE run_id=r.id AND position/2=current_group ORDER BY position LOOP
  SELECT * INTO i FROM publication_round_items WHERE run_id=r.id AND participant_id=a.id AND round_number=current_round
   AND (confirmed_at IS NULL OR confirmed_media_id IS NULL) ORDER BY sequence LIMIT 1;
  IF NOT FOUND THEN CONTINUE; END IF;
  IF i.post_id IS NOT NULL THEN
   SELECT * INTO s FROM scheduled_posts WHERE id=i.post_id;
   IF NOT FOUND OR s.status NOT IN ('scheduled','publishing') THEN
    UPDATE publication_rounds SET status='failed',last_error=coalesce(s.last_error,'Publicação sem confirmação. Confira a fila antes de continuar.') WHERE id=r.id;
    RETURN jsonb_build_object('reserved',true,'run_id',r.id,'status','failed');
   END IF;
   ids:=array_append(ids,i.post_id);
   CONTINUE;
  END IF;
  IF i.media_asset_id IS NULL THEN UPDATE publication_rounds SET status='failed',last_error='Vídeo da rodada foi excluído' WHERE id=r.id; RETURN jsonb_build_object('reserved',true,'run_id',r.id,'status','failed'); END IF;
  SELECT max(confirmed_at) INTO last_at FROM publication_round_items WHERE run_id=r.id AND participant_id=a.id;
  cap:=CASE (i.account_index/6)%3 WHEN 1 THEN coalesce(nullif(a.caption_2,''),a.caption) WHEN 2 THEN coalesce(nullif(a.caption_3,''),a.caption) ELSE a.caption END;
  INSERT INTO scheduled_posts(user_id,ig_account_id,post_type,caption,scheduled_at,status,cover_media_id,round_run_id)
  VALUES(r.user_id,a.ig_account_id,'reel',cap,greatest(now(),coalesce(last_at,now())+CASE WHEN last_at IS NULL THEN interval '0 seconds' ELSE a.spacing_seconds*interval '1 second' END),'scheduled',a.cover_media_id,r.id) RETURNING id INTO pid;
  INSERT INTO post_media(post_id,media_asset_id,position) VALUES(pid,i.media_asset_id,0);
  UPDATE publication_round_items SET post_id=pid WHERE id=i.id;
  ids:=array_append(ids,pid);
 END LOOP;
 RETURN jsonb_build_object('reserved',true,'run_id',r.id,'post_id',ids[1],'post_ids',ids,'group',current_group+1,'round',current_round);
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
  SELECT i.round_number,a.position/2 INTO current_round,current_group
  FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id
  WHERE i.run_id=r.id AND (i.confirmed_at IS NULL OR i.confirmed_media_id IS NULL) ORDER BY i.sequence LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT i.participant_id INTO participant FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id
   JOIN post_media m ON m.post_id=i.post_id AND m.media_asset_id=i.media_asset_id
   WHERE i.post_id=p_post AND i.run_id=r.id AND a.ig_account_id=s.ig_account_id AND i.round_number=current_round AND a.position/2=current_group;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Permite o parceiro, mas nunca dois envios da mesma conta ou de outro grupo.
  IF EXISTS(SELECT 1 FROM publication_send_leases l JOIN scheduled_posts p ON p.id=l.post_id
   LEFT JOIN publication_round_items i ON i.post_id=p.id LEFT JOIN publication_round_accounts a ON a.id=i.participant_id
   WHERE l.post_id<>p_post AND l.expires_at>now() AND (p.ig_account_id=s.ig_account_id OR p.round_run_id IS DISTINCT FROM r.id
    OR i.round_number IS DISTINCT FROM current_round OR a.position/2 IS DISTINCT FROM current_group)) THEN RETURN false; END IF;
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
COMMIT;
