
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const PGlite=process.env.PGLITE_PATH ? require(process.env.PGLITE_PATH).PGlite : null;
test('reserva atômica limita a 40, preserva histórico e não devolve vagas ao excluir',{skip:!PGlite},async()=>{
 const db=new PGlite();
 try{
 await db.exec("CREATE TABLE media_pools(id integer primary key,reels_published integer,status text,next_batch_at text); CREATE TABLE scheduled_posts(id serial primary key,source_pool_id integer); CREATE TABLE pool_execution_log(pool_id integer); INSERT INTO media_pools VALUES(1,38,'active',null),(2,45,'active',null);");
 const sql=fs.readFileSync('supabase/migrations/20260912050000_pool_limit_40.sql','utf8');await db.exec(sql);await db.exec(sql);
 const results=await Promise.allSettled(Array.from({length:5},()=>db.exec('INSERT INTO scheduled_posts(source_pool_id) VALUES(1)')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 const row=(await db.query('SELECT * FROM media_pools WHERE id=1')).rows[0];assert.equal(row.reels_reserved,40);assert.equal(row.status,'paused');
 await db.exec('DELETE FROM scheduled_posts');
 await assert.rejects(()=>db.exec('INSERT INTO scheduled_posts(source_pool_id) VALUES(1)'),/40 reels/);
 assert.equal((await db.query('SELECT status FROM media_pools WHERE id=2')).rows[0].status,'paused');
 await db.exec('INSERT INTO scheduled_posts(source_pool_id) VALUES(NULL)');
 }finally{await db.close();}
});

test('limite configurável aceita atualização de 40 para 30, pausa sem remover fila e permite aumentar', {skip:!PGlite},async()=>{
 const db=new PGlite();try{
 await db.exec("CREATE TABLE media_pools(id integer primary key,reels_published integer,status text,next_batch_at text); CREATE TABLE scheduled_posts(id serial primary key,source_pool_id integer); CREATE TABLE pool_execution_log(pool_id integer); INSERT INTO media_pools VALUES(1,29,'active',null);");
 const sql=fs.readFileSync('supabase/migrations/20260912060000_configurable_pool_limit.sql','utf8');await db.exec(sql);await db.exec(sql);
 assert.equal((await db.query('SELECT reel_limit FROM media_pools')).rows[0].reel_limit,40);
 await db.exec('UPDATE media_pools SET reel_limit=30');
 const results=await Promise.allSettled(Array.from({length:3},()=>db.exec('INSERT INTO scheduled_posts(source_pool_id) VALUES(1)')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await db.exec("UPDATE media_pools SET status='active'");assert.equal((await db.query('SELECT status FROM media_pools')).rows[0].status,'paused');
 await db.exec('UPDATE media_pools SET reel_limit=20');assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,1);
 await db.exec("UPDATE media_pools SET reel_limit=50, status='active'");await db.exec('INSERT INTO scheduled_posts(source_pool_id) VALUES(1)');
 await assert.rejects(()=>db.exec('UPDATE media_pools SET reel_limit=0'),/check constraint/);
 }finally{await db.close();}
});
