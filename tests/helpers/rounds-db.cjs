const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const PGlite=process.env.PGLITE_PATH?require(process.env.PGLITE_PATH).PGlite:null;
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const sql=fs.readFileSync('supabase/migrations/20260914010000_publication_rounds.sql','utf8');
async function setup(n=3){
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE instagram_accounts(id uuid PRIMARY KEY,is_active boolean DEFAULT true,is_restricted boolean DEFAULT false);
 CREATE TABLE media_assets(id uuid PRIMARY KEY,media_kind text);
 CREATE TABLE media_pools(id uuid PRIMARY KEY,status text);
 CREATE TABLE scheduled_posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,ig_account_id uuid,post_type text,caption text,scheduled_at timestamptz,status text,cover_media_id uuid,ig_media_id text,ig_container_id text,published_at timestamptz,last_error text);
 CREATE TABLE post_media(post_id uuid,media_asset_id uuid,position int);
 INSERT INTO auth.users VALUES('${id(1)}'),('${id(2)}');
 INSERT INTO media_pools VALUES('${id(3)}','paused');
 INSERT INTO media_assets VALUES('${id(4)}','video'),('${id(5)}','video');`);
 for(let i=0;i<n;i++)await db.query('INSERT INTO instagram_accounts(id) VALUES($1)',[id(100+i)]);
 await db.exec(sql);await db.exec(sql);
 return db;
}
async function save(db,n=3,total=20,batch=10,user=id(1)){
 const config={name:'Teste',batch_size:batch,total_per_account:total,accounts:Array.from({length:n},(_,i)=>({ig_account_id:id(100+i),video_ids:[id(4),id(5)],caption:'primeira',caption_2:'segunda',caption_3:'terceira',spacing_seconds:0,cover_media_id:null}))};
 return (await db.query('SELECT save_publication_round($1,NULL,$2::jsonb) id',[user,JSON.stringify(config)])).rows[0].id;
}
const control=(db,run,action)=>db.query('SELECT control_publication_round($1,$2,$3)',[run,id(1),action]);
const tick=async db=>(await db.query('SELECT tick_publication_rounds() result')).rows[0].result;
const claim=async(db,post,token)=>(await db.query('SELECT claim_publication_send($1,$2) ok',[post,token])).rows[0].ok;
const release=(db,post,token)=>db.query('SELECT release_publication_send($1,$2)',[post,token]);


module.exports={PGlite,id,setup,save,control,tick,claim,release};
