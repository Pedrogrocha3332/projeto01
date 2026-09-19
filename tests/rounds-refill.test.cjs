const {test}=require('node:test');const assert=require('assert/strict');const fs=require('fs');
const {PGlite,id,setup,save,control,tick,claim,release}=require('./helpers/rounds-db.cjs');
const sql=fs.readFileSync('supabase/migrations/20260914090000_rounds_account_cooldown_refill.sql','utf8');
async function ready(n){const db=await setup(n);await db.exec('ALTER TABLE publication_round_accounts ADD COLUMN first_comment text;');for(const f of ['20260914030000_rounds_configurable_concurrency.sql','20260914050000_rounds_auto_stop_failed_accounts.sql','20260914080000_rounds_interval.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));return db;}
async function done(db,p){await db.query("UPDATE scheduled_posts SET status='published',ig_media_id=id::text,published_at=now() WHERE id=$1",[p]);}
async function fail(db,p){await db.query("UPDATE scheduled_posts SET status='failed',last_error='token' WHERE id=$1",[p]);}
async function pending(db){return(await db.query("SELECT * FROM scheduled_posts WHERE status IN ('scheduled','publishing') ORDER BY ig_account_id")).rows;}
test('falhas repõem vagas sem ultrapassar 3 contas, sem interromper parceiro e sem antecipar próxima rodada',{skip:!PGlite},async()=>{const db=await ready(6);try{
const run=await save(db,6,3,2);await db.query('UPDATE publication_rounds SET concurrent_accounts=3 WHERE id=$1',[run]);await control(db,run,'start');const old=await tick(db);const snapshot=(await db.query('SELECT * FROM publication_round_items ORDER BY sequence')).rows;await db.exec(sql);await db.exec(sql);assert.deepEqual((await db.query('SELECT * FROM publication_round_items ORDER BY sequence')).rows,snapshot);
assert.equal((await tick(db)).post_ids.length,3);await fail(db,old.post_ids[0]);await fail(db,old.post_ids[1]);await tick(db);
let posts=await pending(db);assert.deepEqual(posts.map(p=>p.ig_account_id),[id(102),id(103),id(104)]);
for(const p of posts)assert.equal(await claim(db,p.id,id(20)),true);
await done(db,posts[0].id);await release(db,posts[0].id,id(20));await tick(db);posts=await pending(db);assert.equal(posts.length,3);
const partner=posts.find(p=>p.ig_account_id===id(102));await done(db,partner.id);
await fail(db,posts.find(p=>p.ig_account_id===id(103)).id);await tick(db);posts=await pending(db);assert.deepEqual(posts.map(p=>p.ig_account_id),[id(104),id(105)]);
for(let n=0;n<20;n++){const t=await tick(db);if(!t.reserved)break;posts=await pending(db);assert(posts.length<=3);for(const p of posts){await release(db,p.id,id(20));assert.equal(await claim(db,p.id,id(21)),true);await done(db,p.id);await release(db,p.id,id(21));}}
assert.equal((await tick(db)).reserved,false);const totals=(await db.query("SELECT ig_account_id,count(*)::int n FROM scheduled_posts WHERE status='published' GROUP BY ig_account_id")).rows;assert.equal(totals.length,3);assert(totals.every(p=>p.n===3));
}finally{await db.close();}});
test('a hora conta por conta desde o fim do lote, tempo na fila é aproveitado, cron não reinicia espera',{skip:!PGlite},async()=>{const db=await ready(3);try{
await db.exec(sql);const run=await save(db,3,2,1);await db.query('UPDATE publication_rounds SET round_interval_minutes=60 WHERE id=$1',[run]);await control(db,run,'start');for(const p of (await tick(db)).post_ids)await done(db,p);for(const p of (await tick(db)).post_ids)await done(db,p);
await db.query("UPDATE publication_round_items SET confirmed_at=now()-interval '2 hours' WHERE participant_id IN (SELECT id FROM publication_round_accounts WHERE ig_account_id=$1)",[id(100)]);
await tick(db);let posts=await pending(db);assert.equal(posts.length,2);assert.equal(await claim(db,posts[0].id,id(20)),true);assert.equal(await claim(db,posts[1].id,id(21)),false);
const scheduled=posts[1].scheduled_at;await tick(db);assert.equal((await pending(db))[1].scheduled_at.getTime(),scheduled.getTime());
// Nem alteração manual do horário elimina a proteção da hora por conta.
await db.query('UPDATE scheduled_posts SET scheduled_at=now() WHERE id=$1',[posts[1].id]);assert.equal(await claim(db,posts[1].id,id(21)),false);
await control(db,run,'pause');await db.query("UPDATE scheduled_posts SET status='publishing',ig_container_id='existing' WHERE id=$1",[posts[0].id]);await release(db,posts[0].id,id(20));assert.equal(await claim(db,posts[0].id,id(20)),true);assert.equal((await tick(db)).status,'paused');
await done(db,posts[0].id);await release(db,posts[0].id,id(20));await control(db,run,'resume');
await db.query("UPDATE publication_round_items SET confirmed_at=now()-interval '2 hours' WHERE round_number=1");assert.equal(await claim(db,posts[1].id,id(21)),true);
}finally{await db.close();}});
