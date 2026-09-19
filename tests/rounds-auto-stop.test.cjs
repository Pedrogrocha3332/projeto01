const {test}=require('node:test');const assert=require('assert/strict');const fs=require('fs');
const {PGlite,id,setup,save,control,tick,claim,release}=require('./helpers/rounds-db.cjs');
const config=fs.readFileSync('supabase/migrations/20260914030000_rounds_configurable_concurrency.sql','utf8');
const sql=fs.readFileSync('supabase/migrations/20260914050000_rounds_auto_stop_failed_accounts.sql','utf8');
const fail=(db,p)=>db.query("UPDATE scheduled_posts SET status='failed',last_error='token suspenso' WHERE id=$1",[p]);
test('erro para só uma conta, bloqueia retry e as demais completam todas as rodadas',{skip:!PGlite},async()=>{
 const db=await setup(5);try{await db.exec(config);await db.exec(sql);await db.exec(sql);const run=await save(db,5,3,2);await control(db,run,'start');
 const posts=(await tick(db)).post_ids;assert.equal(await claim(db,posts[0],id(20)),true);await fail(db,posts[0]);
 assert.equal((await db.query('SELECT status FROM publication_rounds WHERE id=$1',[run])).rows[0].status,'active');
 assert.equal(await claim(db,posts[0],id(21)),false);assert.equal(await claim(db,posts[1],id(21)),true);await release(db,posts[1],id(21));
 for(let n=0;n<30;n++){const t=await tick(db);if(!t.reserved)break;for(const p of t.post_ids??[]){assert.equal(await claim(db,p,id(21)),true);await db.query("UPDATE scheduled_posts SET status='published',ig_media_id=id::text,published_at=now() WHERE id=$1",[p]);await release(db,p,id(21));}}
 assert.equal((await tick(db)).reserved,false);
 const totals=(await db.query("SELECT ig_account_id,count(*)::int n FROM scheduled_posts WHERE status='published' GROUP BY ig_account_id")).rows;
 assert.equal(totals.length,4);assert(totals.every(r=>r.n===3));
 assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts WHERE ig_account_id=$1',[id(100)])).rows[0].n,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM publication_round_items WHERE confirmed_at IS NOT NULL')).rows[0].n,12);
 }finally{await db.close();}
});
test('falha antiga retoma sozinha; pausa manual permanece; todas com erro encerram sem publicação falsa',{skip:!PGlite},async()=>{
 const db=await setup(3);try{await db.exec(config);const run=await save(db);await control(db,run,'start');const posts=(await tick(db)).post_ids;await fail(db,posts[0]);
 assert.equal((await tick(db)).status,'failed');await db.exec(sql);await tick(db);
 assert.equal((await db.query('SELECT status FROM publication_rounds WHERE id=$1',[run])).rows[0].status,'active');
 await control(db,run,'pause');await fail(db,posts[1]);assert.equal((await tick(db)).status,'paused');
 await db.query('UPDATE instagram_accounts SET is_active=false WHERE id IN ($1,$2)',[id(100),id(101)]);
 await control(db,run,'resume');const last=(await tick(db)).post_ids;assert.equal(last.length,1);await fail(db,last[0]);
 assert.equal((await tick(db)).status,'completed');
 assert.equal((await db.query('SELECT count(*)::int n FROM publication_round_items WHERE confirmed_at IS NOT NULL')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM publication_round_accounts WHERE stopped_at IS NOT NULL')).rows[0].n,3);
 }finally{await db.close();}
});
