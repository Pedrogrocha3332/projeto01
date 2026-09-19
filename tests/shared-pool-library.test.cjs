const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const PGlite=process.env.PGLITE_PATH ? require(process.env.PGLITE_PATH).PGlite : null;
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const library={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/pool-library.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,library);
test('abas filtram origem e busca sem alterar os dados da biblioteca',()=>{
 const videos=[{id:'1',folder_id:'a',file_name:'Primeiro.mp4'},{id:'2',folder_id:'b',file_name:'Segundo.mp4'},{id:'3',folder_id:null,file_name:'Antigo.mp4'}];
 const before=JSON.stringify(videos);
 assert.deepEqual(Array.from(library.exports.filterPoolVideos(videos,'a',''),v=>v.id),['1']);
 assert.deepEqual(Array.from(library.exports.filterPoolVideos(videos,'b',''),v=>v.id),['2']);
 assert.deepEqual(Array.from(library.exports.filterPoolVideos(videos,'unassigned',''),v=>v.id),['3']);
 assert.deepEqual(Array.from(library.exports.filterPoolVideos(videos,'all',' SEGUNDO '),v=>v.id),['2']);
 assert.equal(library.exports.filterPoolVideos(videos,'all','').length,3);
 assert.equal(JSON.stringify(videos),before);
});
test('biblioteca compartilhada carrega páginas adicionais sem truncar vídeos',async()=>{
 const rows=Array.from({length:1201},(_,i)=>({id:String(i)}));
 const offsets=[];const q={select(){return q},eq(){return q},order(){return q},range:async(a,b)=>{offsets.push(a);return {data:rows.slice(a,b+1),error:null}}};
 const result=await library.exports.loadPoolLibrary({from:()=>q});
 assert.equal(result.length,1201);assert.deepEqual(offsets,[0,500,1000]);
});
test('dois bancos com cinco pools ativos: migração preserva dados e compartilhamento respeita RLS', {skip:!PGlite},async()=>{
 for(let panel=1;panel<=2;panel++){
  const db=new PGlite();
  try {
   await db.exec(`
    CREATE ROLE authenticated;
    CREATE TABLE instagram_accounts(id uuid PRIMARY KEY,user_id text);
    CREATE TABLE media_assets(id uuid PRIMARY KEY,user_id text,media_kind text);
    CREATE TABLE media_pools(id uuid PRIMARY KEY,user_id text,ig_account_id uuid,status text,next_batch_at timestamptz,batch_size int);
    CREATE TABLE pool_videos(id uuid PRIMARY KEY,pool_id uuid,media_asset_id uuid,position int,posted_in_current_cycle boolean,UNIQUE(pool_id,media_asset_id));
    CREATE TABLE scheduled_posts(id uuid PRIMARY KEY,ig_account_id uuid,status text,scheduled_at timestamptz);
    INSERT INTO instagram_accounts SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'owner' FROM generate_series(1,5) n;
    INSERT INTO media_assets SELECT ('00000000-0000-0000-0000-'||lpad((n+10)::text,12,'0'))::uuid,'owner','video' FROM generate_series(1,5) n;
    INSERT INTO media_pools SELECT ('00000000-0000-0000-0000-'||lpad((n+20)::text,12,'0'))::uuid,'owner',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'active','2026-09-12 20:00Z',3 FROM generate_series(1,5) n;
    INSERT INTO pool_videos SELECT ('00000000-0000-0000-0000-'||lpad((n+30)::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((n+20)::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((n+10)::text,12,'0'))::uuid,0,true FROM generate_series(1,5) n;
    INSERT INTO scheduled_posts SELECT ('00000000-0000-0000-0000-'||lpad((n+40)::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'scheduled','2026-09-12 20:00Z' FROM generate_series(1,5) n;
    INSERT INTO instagram_accounts VALUES ('${id(99)}','other');
    INSERT INTO media_assets VALUES ('${id(98)}','other','video'),('${id(97)}','owner','image');
    INSERT INTO media_pools VALUES ('${id(96)}','other','${id(99)}','active','2026-09-12 20:00Z',3);
    ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own ON instagram_accounts USING(user_id=current_setting('app.user_id',true));
    ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own ON media_assets USING(user_id=current_setting('app.user_id',true));
    ALTER TABLE media_pools ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own ON media_pools USING(user_id=current_setting('app.user_id',true));
    ALTER TABLE pool_videos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own ON pool_videos USING(EXISTS(SELECT 1 FROM media_pools WHERE id=pool_id));
    GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
   `);
   await db.exec(fs.readFileSync('supabase/migrations/20260912020000_media_account_library.sql','utf8').replace(/^\uFEFF/,''));
   await db.exec(`UPDATE media_assets SET ig_account_id='${id(1)}' WHERE id='${id(11)}'; UPDATE media_pools SET manual_order=true WHERE id='${id(21)}';`);
   const snapshot=async()=>Promise.all(['instagram_accounts','media_assets','media_pools','pool_videos','scheduled_posts'].map(async t=>(await db.query(`SELECT * FROM ${t} ORDER BY id`)).rows));
   const before=await snapshot();
   const migration=fs.readFileSync('supabase/migrations/20260912030000_shared_pool_library.sql','utf8').replace(/^\uFEFF/,'');
   await db.exec(migration);await db.exec(migration);
   assert.deepEqual(await snapshot(),before,`painel ${panel}: nenhum dado existente alterado`);
   await db.exec("SET ROLE authenticated;SET app.user_id='owner';");
   await db.exec(`INSERT INTO pool_videos VALUES ('${id(51)}','${id(22)}','${id(11)}',1,false);`);
   assert.deepEqual((await db.query(`SELECT * FROM pool_videos WHERE pool_id='${id(21)}'`)).rows,before[3].filter(row=>row.pool_id===id(21)));
   assert.equal((await db.query(`SELECT ig_account_id FROM media_pools WHERE id='${id(22)}'`)).rows[0].ig_account_id,id(2));
   assert.equal((await db.query(`SELECT ig_account_id FROM media_assets WHERE id='${id(11)}'`)).rows[0].ig_account_id,id(1));
   for(const [pool,asset] of [[22,98],[22,97],[96,11]])await assert.rejects(()=>db.exec(`INSERT INTO pool_videos VALUES ('${id(52)}','${id(pool)}','${id(asset)}',2,false);`),/disponíveis|sem acesso/);
   await assert.rejects(()=>db.exec(`INSERT INTO pool_videos VALUES ('${id(52)}','${id(22)}','${id(11)}',2,false);`),/unique/);
   await db.exec('RESET ROLE');
   assert.deepEqual((await db.query('SELECT * FROM scheduled_posts ORDER BY id')).rows,before[4]);
  }finally{await db.close()}
 }
});

