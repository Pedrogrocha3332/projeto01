const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const {PGlite,id,setup,save,control,tick,claim,release}=require('./helpers/rounds-db.cjs');
const sql=fs.readFileSync('supabase/migrations/20260914030000_rounds_configurable_concurrency.sql','utf8');
for(const size of [1,3,5])test(`${size} contas simultâneas: ordem, limite, grupo lento e rodada final parcial`,{skip:!PGlite},async()=>{
 const db=await setup(7);try{
 await db.exec(sql);const run=await save(db,7,3,2);
 const config=(await db.query("SELECT to_jsonb(r)||jsonb_build_object('accounts',(SELECT jsonb_agg(a ORDER BY position) FROM publication_round_accounts a WHERE run_id=r.id),'concurrent_accounts',$2::int) config FROM publication_rounds r WHERE id=$1",[run,size])).rows[0].config;
 await db.query('SELECT save_publication_round($1,$2,$3::jsonb)',[id(1),run,JSON.stringify(config)]);
 assert.equal((await db.query('SELECT concurrent_accounts FROM publication_rounds WHERE id=$1',[run])).rows[0].concurrent_accounts,size);
 await control(db,run,'start');
 await assert.rejects(db.query('UPDATE publication_rounds SET concurrent_accounts=$1 WHERE id=$2',[size===1?2:1,run]),/rascunho/);
 for(let round=1;round<=2;round++)for(let start=0;start<7;start+=size){
  const count=Math.min(size,7-start);await tick(db);await tick(db);
  let posts=(await db.query("SELECT * FROM scheduled_posts WHERE status<>'published' ORDER BY ig_account_id")).rows;
  assert.deepEqual(posts.map(p=>p.ig_account_id),Array.from({length:count},(_,n)=>id(100+start+n)));
  for(const p of posts)assert.equal(await claim(db,p.id,id(20+start)),true);
  assert.equal(await claim(db,posts[0].id,id(90)),false);
  // Termina uma conta de cada vez; as demais seguram o próximo grupo.
  for(let account=0;account<count;account++)for(let n=0;n<(round===1?2:1);n++){
   posts=(await db.query("SELECT * FROM scheduled_posts WHERE status<>'published' ORDER BY ig_account_id")).rows;
   assert(posts.length<=count);assert(posts.every(p=>Number(p.ig_account_id.slice(-12))>=100+start&&Number(p.ig_account_id.slice(-12))<100+start+count));
   const p=posts.find(p=>p.ig_account_id===id(100+start+account));assert(p);
   await db.query("UPDATE scheduled_posts SET status='published',ig_media_id=id::text,published_at=now() WHERE id=$1",[p.id]);await release(db,p.id,id(20+start));
   if(account<count-1||n<(round===1?1:0))await tick(db);
  }
 }
 assert.equal((await tick(db)).status,'completed');
 assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,21);
 const rows=(await db.query('SELECT i.account_index,m.media_asset_id,s.caption FROM publication_round_items i JOIN scheduled_posts s ON s.id=i.post_id JOIN post_media m ON m.post_id=s.id')).rows;
 for(const row of rows){assert.equal(row.media_asset_id,id(4+row.account_index%2));assert.equal(row.caption,'primeira');}
 }finally{await db.close();}
});
test('migração repetida preserva execução ativa, padrão 2 e progresso; limites rejeitados',{skip:!PGlite},async()=>{
 const db=await setup(3);try{
 const run=await save(db);await control(db,run,'start');await tick(db);
 const before=(await db.query('SELECT * FROM publication_round_items ORDER BY sequence')).rows;
 await db.exec(sql);await db.exec(sql);
 assert.deepEqual((await db.query('SELECT * FROM publication_round_items ORDER BY sequence')).rows,before);
 assert.equal((await tick(db)).post_ids.length,2);
 const draft=await save(db);
 for(const value of [0,6])await assert.rejects(db.query('UPDATE publication_rounds SET concurrent_accounts=$1 WHERE id=$2',[value,draft]),/check constraint/);
 }finally{await db.close();}
});
