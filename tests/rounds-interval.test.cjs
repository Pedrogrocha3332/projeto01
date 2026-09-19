const {test}=require('node:test');const assert=require('assert/strict');const fs=require('fs');
const {PGlite,id,setup,save,control,tick,claim}=require('./helpers/rounds-db.cjs');
const sql=fs.readFileSync('supabase/migrations/20260914080000_rounds_interval.sql','utf8');
async function ready(){const db=await setup(3);for(const f of ['20260914030000_rounds_configurable_concurrency.sql','20260914050000_rounds_auto_stop_failed_accounts.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));await db.exec('ALTER TABLE publication_round_accounts ADD COLUMN first_comment text');return db;}
async function finish(db,post){await db.query("UPDATE scheduled_posts SET status='published',ig_media_id=id::text,published_at=now() WHERE id=$1",[post]);}
test('espera só após todas terminarem, prazo estável, pausa e retomada, sem ultrapassar total',{skip:!PGlite},async()=>{const db=await ready();try{
await db.exec(sql);const run=await save(db,3,2,1);
const cfg=(await db.query("SELECT to_jsonb(r)||jsonb_build_object('round_interval_minutes',60,'accounts',(SELECT jsonb_agg(a ORDER BY position) FROM publication_round_accounts a WHERE run_id=r.id)) config FROM publication_rounds r WHERE id=$1",[run])).rows[0].config;
await db.query('SELECT save_publication_round($1,$2,$3::jsonb)',[id(1),run,JSON.stringify(cfg)]);await control(db,run,'start');
const first=(await tick(db)).post_ids;await finish(db,first[0]);await finish(db,first[1]);const last=(await tick(db)).post_ids;assert.equal(last.length,1);await finish(db,last[0]);
const wait=await tick(db);assert.equal(wait.status,'waiting');assert.deepEqual(wait.post_ids,[]);
const delta=new Date(wait.next_round_at)-Date.now();assert(delta>3590000&&delta<=3600000);
await db.exec(sql);assert.equal((await tick(db)).next_round_at,wait.next_round_at);
await control(db,run,'pause');assert.equal((await tick(db)).status,'paused');await control(db,run,'resume');assert.equal((await tick(db)).next_round_at,wait.next_round_at);
await assert.rejects(db.query('UPDATE publication_rounds SET round_interval_minutes=0 WHERE id=$1',[run]),/antes de iniciar/);
assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,3);
await db.query("UPDATE publication_rounds SET next_round_at=now()-interval '1 second' WHERE id=$1",[run]);
const second=(await tick(db)).post_ids;assert.equal(second.length,2);assert.equal(await claim(db,second[0],id(20)),true);
for(const p of second)await finish(db,p);const tail=(await tick(db)).post_ids;for(const p of tail)await finish(db,p);
assert.equal((await tick(db)).status,'completed');assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,6);
}finally{await db.close();}});
test('migração preserva execução já ativa sem espera; falha de conta não impede intervalo das demais',{skip:!PGlite},async()=>{const db=await ready();try{
const run=await save(db,3,2,1);await control(db,run,'start');await tick(db);const before=(await db.query('SELECT * FROM publication_round_items ORDER BY sequence')).rows;await db.exec(sql);assert.deepEqual((await db.query('SELECT * FROM publication_round_items ORDER BY sequence')).rows,before);
assert.equal((await db.query('SELECT round_interval_minutes FROM publication_rounds WHERE id=$1',[run])).rows[0].round_interval_minutes,0);
for(let n=0;n<5;n++){const t=await tick(db);assert.notEqual(t.status,'waiting');for(const p of t.post_ids??[])await finish(db,p);}assert.equal((await tick(db)).reserved,false);
const next=await save(db,3,2,1);await db.query('UPDATE publication_rounds SET round_interval_minutes=60 WHERE id=$1',[next]);await control(db,next,'start');
const posts=(await tick(db)).post_ids;await db.query("UPDATE scheduled_posts SET status='failed' WHERE id=$1",[posts[0]]);await finish(db,posts[1]);for(const p of (await tick(db)).post_ids)await finish(db,p);assert.equal((await tick(db)).status,'waiting');
}finally{await db.close();}});
