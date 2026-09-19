BEGIN;
-- Seção independente: não cria nem modifica media_pools.
CREATE TABLE IF NOT EXISTS public.publication_rounds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 batch_size integer NOT NULL DEFAULT 10 CHECK(batch_size BETWEEN 1 AND 100),
 total_per_account integer NOT NULL DEFAULT 20 CHECK(total_per_account BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','failed','completed','cancelled')),
 last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_reserved_round ON public.publication_rounds ((true)) WHERE status IN ('active','paused','failed');
CREATE TABLE IF NOT EXISTS public.publication_round_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES public.publication_rounds(id) ON DELETE CASCADE,
 ig_account_id uuid NOT NULL REFERENCES public.instagram_accounts(id), position integer NOT NULL,
 video_ids uuid[] NOT NULL CHECK(cardinality(video_ids)>0), caption text NOT NULL DEFAULT '',
 caption_2 text NOT NULL DEFAULT '', caption_3 text NOT NULL DEFAULT '',
 spacing_seconds integer NOT NULL DEFAULT 60 CHECK(spacing_seconds BETWEEN 0 AND 1800),
 cover_media_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
 UNIQUE(run_id,ig_account_id), UNIQUE(run_id,position)
);
CREATE TABLE IF NOT EXISTS public.publication_round_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES public.publication_rounds(id) ON DELETE CASCADE,
 participant_id uuid NOT NULL REFERENCES public.publication_round_accounts(id) ON DELETE CASCADE,
 sequence integer NOT NULL, round_number integer NOT NULL, account_index integer NOT NULL,
 media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
 post_id uuid UNIQUE REFERENCES public.scheduled_posts(id) ON DELETE SET NULL, confirmed_at timestamptz, confirmed_media_id text, UNIQUE(run_id,sequence)
);
ALTER TABLE public.scheduled_posts ADD COLUMN IF NOT EXISTS round_run_id uuid REFERENCES public.publication_rounds(id);
CREATE TABLE IF NOT EXISTS public.publication_send_leases (
 post_id uuid PRIMARY KEY REFERENCES public.scheduled_posts(id) ON DELETE CASCADE,
 token uuid NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE public.publication_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_round_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_round_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_send_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_round ON public.publication_rounds;
CREATE POLICY own_round ON public.publication_rounds FOR SELECT USING(user_id=auth.uid());
DROP POLICY IF EXISTS own_round_account ON public.publication_round_accounts;
CREATE POLICY own_round_account ON public.publication_round_accounts FOR SELECT USING(EXISTS(SELECT 1 FROM public.publication_rounds r WHERE r.id=run_id AND r.user_id=auth.uid()));
DROP POLICY IF EXISTS own_round_item ON public.publication_round_items;
CREATE POLICY own_round_item ON public.publication_round_items FOR SELECT USING(EXISTS(SELECT 1 FROM public.publication_rounds r WHERE r.id=run_id AND r.user_id=auth.uid()));
GRANT SELECT ON public.publication_rounds,public.publication_round_accounts,public.publication_round_items TO authenticated;
GRANT ALL ON public.publication_rounds,public.publication_round_accounts,public.publication_round_items,public.publication_send_leases TO service_role;

-- Chamadas administrativas abaixo somente pelo servidor após validar acesso.
CREATE OR REPLACE FUNCTION public.save_publication_round(p_user uuid,p_id uuid,p_config jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; a jsonb; pos integer:=0;
BEGIN
 IF p_id IS NOT NULL THEN
  SELECT id INTO rid FROM publication_rounds WHERE id=p_id AND user_id=p_user AND status='draft' FOR UPDATE;
  IF rid IS NULL THEN RAISE EXCEPTION 'Somente rascunhos próprios podem ser editados'; END IF;
  UPDATE publication_rounds SET name=p_config->>'name',batch_size=(p_config->>'batch_size')::int,total_per_account=(p_config->>'total_per_account')::int WHERE id=rid;
  DELETE FROM publication_round_accounts WHERE run_id=rid;
 ELSE
  INSERT INTO publication_rounds(user_id,name,batch_size,total_per_account) VALUES(p_user,p_config->>'name',(p_config->>'batch_size')::int,(p_config->>'total_per_account')::int) RETURNING id INTO rid;
 END IF;
 IF jsonb_array_length(p_config->'accounts') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Selecione de 1 a 100 contas'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p_config->'accounts') LOOP
  INSERT INTO publication_round_accounts(run_id,ig_account_id,position,video_ids,caption,caption_2,caption_3,spacing_seconds,cover_media_id)
  VALUES(rid,(a->>'ig_account_id')::uuid,pos,ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(a->'video_ids')),coalesce(a->>'caption',''),coalesce(a->>'caption_2',''),coalesce(a->>'caption_3',''),(a->>'spacing_seconds')::int,(a->>'cover_media_id')::uuid);
  pos:=pos+1;
 END LOOP;
 RETURN rid;
END; $$;

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
 FOR a IN SELECT * FROM publication_round_accounts WHERE run_id=p_id LOOP
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
  WHERE round_run_id=p_id AND status IN ('failed','failed_final','draft');
 END IF;
 UPDATE publication_rounds SET status='active',last_error=NULL WHERE id=p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.tick_publication_rounds() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r publication_rounds%ROWTYPE; i publication_round_items%ROWTYPE; a publication_round_accounts%ROWTYPE; s scheduled_posts%ROWTYPE; pid uuid; last_at timestamptz; cap text;
BEGIN
 PERFORM pg_advisory_xact_lock(14092026);
 SELECT * INTO r FROM publication_rounds WHERE status IN ('active','paused','failed') FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('reserved',false); END IF;
 IF r.status<>'active' THEN RETURN jsonb_build_object('reserved',true,'run_id',r.id,'status',r.status); END IF;
 SELECT items.* INTO i FROM publication_round_items items LEFT JOIN scheduled_posts posts ON posts.id=items.post_id
 WHERE items.run_id=r.id AND (items.confirmed_at IS NULL OR items.confirmed_media_id IS NULL) ORDER BY items.sequence LIMIT 1;
 IF NOT FOUND THEN UPDATE publication_rounds SET status='completed' WHERE id=r.id; RETURN jsonb_build_object('reserved',false,'status','completed'); END IF;
 IF i.post_id IS NOT NULL THEN
  SELECT * INTO s FROM scheduled_posts WHERE id=i.post_id;
  IF NOT FOUND OR s.status NOT IN ('scheduled','publishing') THEN
   UPDATE publication_rounds SET status='failed',last_error=coalesce(s.last_error,'Publicação sem confirmação. Confira a fila antes de continuar.') WHERE id=r.id;
  END IF;
  RETURN jsonb_build_object('reserved',true,'run_id',r.id,'post_id',i.post_id);
 END IF;
 IF i.media_asset_id IS NULL THEN UPDATE publication_rounds SET status='failed',last_error='Vídeo da rodada foi excluído' WHERE id=r.id; RETURN jsonb_build_object('reserved',true,'run_id',r.id,'status','failed'); END IF;
 SELECT * INTO a FROM publication_round_accounts WHERE id=i.participant_id;
 SELECT max(confirmed_at) INTO last_at FROM publication_round_items WHERE run_id=r.id;
 cap:=CASE (i.account_index/6)%3 WHEN 1 THEN coalesce(nullif(a.caption_2,''),a.caption) WHEN 2 THEN coalesce(nullif(a.caption_3,''),a.caption) ELSE a.caption END;
 INSERT INTO scheduled_posts(user_id,ig_account_id,post_type,caption,scheduled_at,status,cover_media_id,round_run_id)
 VALUES(r.user_id,a.ig_account_id,'reel',cap,greatest(now(),coalesce(last_at,now())+CASE WHEN last_at IS NULL THEN interval '0 seconds' ELSE a.spacing_seconds*interval '1 second' END),'scheduled',a.cover_media_id,r.id) RETURNING id INTO pid;
 INSERT INTO post_media(post_id,media_asset_id,position) VALUES(pid,i.media_asset_id,0);
 UPDATE publication_round_items SET post_id=pid WHERE id=i.id;
 RETURN jsonb_build_object('reserved',true,'run_id',r.id,'post_id',pid);
END; $$;

-- Todos os caminhos que chamam a Meta usam esta mesma porta, inclusive publicação manual e recuperação.
CREATE OR REPLACE FUNCTION public.claim_publication_send(p_post uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r publication_rounds%ROWTYPE; s scheduled_posts%ROWTYPE; expected uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(14092026);
 SELECT * INTO s FROM scheduled_posts WHERE id=p_post;
 IF NOT FOUND OR s.status='published' THEN RETURN false; END IF;
 SELECT * INTO r FROM publication_rounds WHERE status IN ('active','paused','failed');
 IF FOUND THEN
  IF s.round_run_id IS DISTINCT FROM r.id THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM publication_send_leases WHERE post_id<>p_post AND expires_at>now()) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id JOIN post_media m ON m.post_id=i.post_id AND m.media_asset_id=i.media_asset_id WHERE i.post_id=p_post AND a.ig_account_id=s.ig_account_id) THEN RETURN false; END IF;
  IF r.status<>'active' AND NOT(r.status='paused' AND s.status='publishing' AND s.ig_container_id IS NOT NULL) THEN RETURN false; END IF;
  SELECT i.post_id INTO expected FROM publication_round_items i LEFT JOIN scheduled_posts p ON p.id=i.post_id WHERE i.run_id=r.id AND (i.confirmed_at IS NULL OR i.confirmed_media_id IS NULL) ORDER BY i.sequence LIMIT 1;
  IF p_post IS DISTINCT FROM expected OR s.scheduled_at>now() OR s.status NOT IN ('scheduled','publishing') THEN RETURN false; END IF;
 ELSIF s.round_run_id IS NOT NULL THEN RETURN false;
 END IF;
 INSERT INTO publication_send_leases(post_id,token,expires_at) VALUES(p_post,p_token,now()+interval '15 minutes')
 ON CONFLICT(post_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE publication_send_leases.expires_at<now();
 RETURN FOUND;
END; $$;
CREATE OR REPLACE FUNCTION public.release_publication_send(p_post uuid,p_token uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ DELETE FROM publication_send_leases WHERE post_id=p_post AND token=p_token; $$;

-- Falha da rodada não entra no sistema de retry automático dos pools normais.
CREATE OR REPLACE FUNCTION public.round_post_failed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.round_run_id IS NOT NULL AND NEW.status='published' AND NEW.ig_media_id IS NOT NULL THEN
  UPDATE publication_round_items SET confirmed_at=coalesce(NEW.published_at,now()),confirmed_media_id=NEW.ig_media_id WHERE post_id=NEW.id;
 END IF;
 IF NEW.round_run_id IS NOT NULL AND NEW.status IN ('failed','failed_final','draft') THEN
  UPDATE publication_rounds SET status='failed',last_error=coalesce(NEW.last_error,'Publicação interrompida; confira antes de continuar') WHERE id=NEW.round_run_id AND status='active';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS round_post_failed ON public.scheduled_posts;
CREATE TRIGGER round_post_failed AFTER UPDATE OF status ON public.scheduled_posts FOR EACH ROW EXECUTE FUNCTION public.round_post_failed();

REVOKE ALL ON FUNCTION public.save_publication_round(uuid,uuid,jsonb),public.control_publication_round(uuid,uuid,text),public.tick_publication_rounds(),public.claim_publication_send(uuid,uuid),public.release_publication_send(uuid,uuid),public.round_post_failed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_publication_round(uuid,uuid,jsonb),public.control_publication_round(uuid,uuid,text),public.tick_publication_rounds(),public.claim_publication_send(uuid,uuid),public.release_publication_send(uuid,uuid) TO service_role;
-- Protege somente execuções reservadas; limpar histórico concluído continua possível.
CREATE OR REPLACE FUNCTION public.protect_round_media() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM publication_round_items i JOIN publication_rounds r ON r.id=i.run_id WHERE r.status IN ('active','paused','failed') AND
   ((TG_TABLE_NAME='media_assets' AND i.media_asset_id=OLD.id) OR (TG_TABLE_NAME='scheduled_posts' AND i.post_id=OLD.id))) THEN
  RAISE EXCEPTION 'Este vídeo/post está em uma rodada em andamento. Encerre a execução antes de excluir';
 END IF;
 RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS protect_round_media ON public.media_assets;
CREATE TRIGGER protect_round_media BEFORE DELETE ON public.media_assets FOR EACH ROW EXECUTE FUNCTION public.protect_round_media();
DROP TRIGGER IF EXISTS protect_round_post ON public.scheduled_posts;
CREATE TRIGGER protect_round_post BEFORE DELETE ON public.scheduled_posts FOR EACH ROW EXECUTE FUNCTION public.protect_round_media();
REVOKE ALL ON FUNCTION public.protect_round_media() FROM PUBLIC;
COMMIT;
