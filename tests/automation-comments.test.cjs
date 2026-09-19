const {test}=require('node:test');const assert=require('assert/strict');const fs=require('fs');
const {PGlite,id,setup,save,control,tick}=require('./helpers/rounds-db.cjs');
test('comentário opcional: migração não altera fila ativa, comentário por conta e pool só em novos posts',{skip:!PGlite},async()=>{
const db=await setup(3);try{
 await db.exec('ALTER TABLE scheduled_posts ADD COLUMN first_comment text; ALTER TABLE scheduled_posts ADD COLUMN source_pool_id uuid;');
 await db.exec(fs.readFileSync('supabase/migrations/20260914030000_rounds_configurable_concurrency.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20260914050000_rounds_auto_stop_failed_accounts.sql','utf8'));
 const run=await save(db,3,2,1);await control(db,run,'start');await tick(db);
 const before=(await db.query('SELECT * FROM scheduled_posts ORDER BY id')).rows;
 const sql=fs.readFileSync('supabase/migrations/20260914060000_automation_first_comment.sql','utf8');await db.exec(sql);await db.exec(sql);
 assert.deepEqual((await db.query('SELECT * FROM scheduled_posts ORDER BY id')).rows,before);
 await db.query("UPDATE publication_round_accounts SET first_comment='comentário A' WHERE run_id=$1 AND ig_account_id=$2",[run,id(100)]);
 for(let n=0;n<6;n++){await db.exec("UPDATE scheduled_posts SET status='published',ig_media_id=id::text,published_at=now() WHERE status='scheduled'");await tick(db);}
 const posts=(await db.query('SELECT ig_account_id,first_comment FROM scheduled_posts ORDER BY ig_account_id,scheduled_at')).rows;
 assert.equal(posts.filter(p=>p.first_comment==='comentário A').length,1);assert(posts.filter(p=>p.ig_account_id!==id(100)).every(p=>p.first_comment===null));
 await db.query("UPDATE media_pools SET first_comment='pool' WHERE id=$1",[id(3)]);
 let p=(await db.query("INSERT INTO scheduled_posts(source_pool_id) VALUES($1) RETURNING first_comment",[id(3)])).rows[0];assert.equal(p.first_comment,'pool');
 p=(await db.query("INSERT INTO scheduled_posts(source_pool_id,first_comment) VALUES($1,'manual') RETURNING first_comment",[id(3)])).rows[0];assert.equal(p.first_comment,'manual');
 const draft=await save(db,3);const config=(await db.query("SELECT to_jsonb(r)||jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('first_comment','teste')) FROM publication_round_accounts a WHERE run_id=r.id)) config FROM publication_rounds r WHERE id=$1",[draft])).rows[0].config;
 await db.query('SELECT save_publication_round($1,$2,$3::jsonb)',[id(1),draft,JSON.stringify(config)]);
 assert.equal((await db.query("SELECT count(*)::int n FROM publication_round_accounts WHERE run_id=$1 AND first_comment='teste'",[draft])).rows[0].n,3);
}finally{await db.close();}
});
