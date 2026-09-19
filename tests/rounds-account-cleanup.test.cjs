const {test}=require('node:test');const assert=require('assert/strict');const fs=require('fs');
const {PGlite,id,setup,save,control,tick,claim,release}=require('./helpers/rounds-db.cjs');
async function ready(){const db=await setup(3);await db.exec("ALTER TABLE instagram_accounts ADD COLUMN username text DEFAULT 'teste'; ALTER TABLE scheduled_posts ADD FOREIGN KEY (ig_account_id) REFERENCES instagram_accounts(id) ON DELETE CASCADE;");for(const file of ['20260914030000_rounds_configurable_concurrency.sql','20260914050000_rounds_auto_stop_failed_accounts.sql','20260914070000_rounds_history_account_cleanup.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));return db;}
test('falhas de rodadas concluídas não bloqueiam início; pendência normal ainda bloqueia',{skip:!PGlite},async()=>{const db=await ready();try{
const run=await save(db);await control(db,run,'start');for(let n=0;n<4;n++){const t=await tick(db);for(const p of t.post_ids??[])await db.query("UPDATE scheduled_posts SET status='failed' WHERE id=$1",[p]);}assert.equal((await tick(db)).reserved,false);
const next=await save(db);const normal=(await db.query("INSERT INTO scheduled_posts(status) VALUES('scheduled') RETURNING id")).rows[0].id;
await assert.rejects(control(db,next,'start'),/fila normal/);await db.query('DELETE FROM scheduled_posts WHERE id=$1',[normal]);await control(db,next,'start');assert.equal((await tick(db)).post_ids.length,2);
}finally{await db.close();}});
test('desconectar preserva histórico e parceiros; envio e lease impedem exclusão',{skip:!PGlite},async()=>{const db=await ready();try{
const run=await save(db);await control(db,run,'start');const posts=(await tick(db)).post_ids;
assert.equal(await claim(db,posts[0],id(20)),true);await assert.rejects(db.query('DELETE FROM instagram_accounts WHERE id=$1',[id(100)]),/processamento/);await release(db,posts[0],id(20));
await db.query("UPDATE scheduled_posts SET status='publishing' WHERE id=$1",[posts[0]]);await assert.rejects(db.query('DELETE FROM instagram_accounts WHERE id=$1',[id(100)]),/processamento/);
await db.query("UPDATE scheduled_posts SET status='failed' WHERE id=$1",[posts[0]]);await db.query('DELETE FROM instagram_accounts WHERE id=$1',[id(100)]);
const a=(await db.query('SELECT * FROM publication_round_accounts WHERE run_id=$1 ORDER BY position',[run])).rows;assert.equal(a[0].ig_account_id,null);assert.equal(a[0].account_label,'@teste');assert(a[0].stopped_at);assert.equal(a[1].stopped_at,null);
assert.equal((await db.query('SELECT count(*)::int n FROM publication_round_items WHERE run_id=$1',[run])).rows[0].n,60);assert.equal((await tick(db)).post_ids[0],posts[1]);
}finally{await db.close();}});
