const PGlite = process.env.PGLITE_PATH ? require(process.env.PGLITE_PATH).PGlite : null;
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('migração preserva pools antigos e valida conta, permissão e ordem no PostgreSQL', { skip: !PGlite }, async()=>{
const db=new PGlite();
try {
await db.exec(`
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE instagram_accounts(id uuid PRIMARY KEY, user_id text);
CREATE TABLE media_assets(id uuid PRIMARY KEY,user_id text,media_kind text);
CREATE TABLE media_pools(id uuid PRIMARY KEY,user_id text,ig_account_id uuid,status text);
CREATE TABLE pool_videos(id uuid PRIMARY KEY,pool_id uuid,media_asset_id uuid,position integer,posted_in_current_cycle boolean);
INSERT INTO instagram_accounts VALUES ('${uuid(1)}','owner'),('${uuid(2)}','owner'),('${uuid(3)}','other');
INSERT INTO media_assets VALUES ('${uuid(11)}','owner','video'),('${uuid(12)}','owner','video'),('${uuid(13)}','owner','video'),('${uuid(14)}','other','video');
INSERT INTO media_pools VALUES ('${uuid(21)}','owner','${uuid(1)}','paused'),('${uuid(22)}','other','${uuid(3)}','paused');
INSERT INTO pool_videos VALUES ('${uuid(31)}','${uuid(21)}','${uuid(11)}',0,true),('${uuid(32)}','${uuid(21)}','${uuid(12)}',1,false);
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON instagram_accounts USING(user_id=current_setting('app.user_id',true));
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON media_assets USING(user_id=current_setting('app.user_id',true));
ALTER TABLE media_pools ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON media_pools USING(user_id=current_setting('app.user_id',true));
ALTER TABLE pool_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON pool_videos USING(EXISTS(SELECT 1 FROM media_pools p WHERE p.id=pool_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
`);
const before=(await db.query('SELECT * FROM pool_videos ORDER BY id')).rows;
const sql=fs.readFileSync('supabase/migrations/20260912020000_media_account_library.sql','utf8').replace(/^\uFEFF/,'');
await db.exec(sql);await db.exec(sql);
assert.deepEqual((await db.query('SELECT * FROM pool_videos ORDER BY id')).rows,before);
assert.equal((await db.query('SELECT manual_order FROM media_pools LIMIT 1')).rows[0].manual_order,false);
assert.equal((await db.query('SELECT count(*)::int AS n FROM media_assets WHERE ig_account_id IS NULL')).rows[0].n,4);
await db.exec("SET ROLE authenticated; SET app.user_id='owner';");
await assert.rejects(()=>db.exec(`UPDATE media_assets SET ig_account_id='${uuid(3)}' WHERE id='${uuid(11)}'`),/sem acesso/);
await db.exec(`UPDATE media_assets SET ig_account_id='${uuid(1)}' WHERE id IN ('${uuid(11)}','${uuid(13)}'); UPDATE media_assets SET ig_account_id='${uuid(2)}' WHERE id='${uuid(12)}';`);
await assert.rejects(()=>db.exec(`INSERT INTO pool_videos VALUES ('${uuid(33)}','${uuid(21)}','${uuid(12)}',2,false)`),/Vincule/);
await db.exec(`INSERT INTO pool_videos VALUES ('${uuid(33)}','${uuid(21)}','${uuid(13)}',2,false)`);
const save=(ids,pool=21)=>db.query('SELECT save_pool_video_order($1,$2::uuid[],true)',[uuid(pool),ids.map(uuid)]);
await assert.rejects(()=>save([31,32]),/mudaram/);
await assert.rejects(()=>save([31,31,33]),/mudaram/);
await assert.rejects(()=>save([31,32,99]),/mudaram/);
await assert.rejects(()=>save([],22),/sem acesso/);
await db.exec(`UPDATE media_pools SET status='active' WHERE id='${uuid(21)}'`);
await assert.rejects(()=>save([33,32,31]),/Pause/);
await db.exec(`UPDATE media_pools SET status='paused' WHERE id='${uuid(21)}'`);
await save([33,32,31]);
assert.deepEqual((await db.query('SELECT id FROM pool_videos ORDER BY position')).rows.map(r=>r.id),[33,32,31].map(uuid));
assert.equal((await db.query(`SELECT posted_in_current_cycle FROM pool_videos WHERE id='${uuid(31)}'`)).rows[0].posted_in_current_cycle,true);
// Rotação dos pools antigos continua válida, mesmo com vídeo sem vínculo ou movido na biblioteca.
await db.exec(`UPDATE media_assets SET ig_account_id=NULL WHERE id='${uuid(11)}'; UPDATE pool_videos SET posted_in_current_cycle=false WHERE pool_id='${uuid(21)}';`);
assert.equal((await db.query('SELECT count(*)::int AS n FROM pool_videos')).rows[0].n,3);
await db.exec(`RESET ROLE; SET ROLE service_role; INSERT INTO pool_videos VALUES ('${uuid(34)}','${uuid(22)}','${uuid(14)}',0,false)`);
assert.equal((await db.query('SELECT count(*)::int AS n FROM pool_videos')).rows[0].n,4);
} finally {await db.close()}
});

test('primeiro lote: migração repetível preserva pools ativos e valida valores', {skip:!PGlite}, async()=>{
  const db=new PGlite();
  try{
    await db.exec("CREATE TABLE media_pools(id integer PRIMARY KEY, batch_size integer, batches_published integer, status text, next_batch_at text); INSERT INTO media_pools VALUES(1,3,10,'active','2026-09-12T12:00:00Z');");
    const before=(await db.query('SELECT * FROM media_pools')).rows;
    const sql=fs.readFileSync('supabase/migrations/20260912040000_pool_first_batch.sql','utf8');
    await db.exec(sql);await db.exec(sql);
    assert.deepEqual((await db.query('SELECT id,batch_size,batches_published,status,next_batch_at FROM media_pools')).rows,before);
    assert.equal((await db.query('SELECT first_batch_size FROM media_pools')).rows[0].first_batch_size,null);
    await assert.rejects(()=>db.exec('UPDATE media_pools SET first_batch_size=0'),/check constraint/);
    await db.exec('UPDATE media_pools SET first_batch_size=6');
  }finally{await db.close();}
});
