const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');
const {PGlite,id,setup,save,control,tick,claim,release}=require('./helpers/rounds-db.cjs');
const sql=fs.readFileSync('supabase/migrations/20260914020000_rounds_account_pairs.sql','utf8');
const pending=async db=>(await db.query("SELECT * FROM scheduled_posts WHERE status<>'published' ORDER BY ig_account_id")).rows;
async function done(db,post){await db.query("UPDATE scheduled_posts SET status='published',ig_media_id=id::text,published_at=now() WHERE id=$1",[post]);}

test('15 contas em pares: 10 por rodada, 20 no total; par lento segura o seguinte e última conta sozinha',{skip:!PGlite},async()=>{
 const db=await setup(15);try{
 const run=await save(db,15);await control(db,run,'start');
 const before=(await db.query('SELECT * FROM publication_round_items ORDER BY sequence')).rows;
 await db.exec(sql);await db.exec(sql);
 assert.deepEqual((await db.query('SELECT * FROM publication_round_items ORDER BY sequence')).rows,before);
 for(let round=1;round<=2;round++)for(let group=0;group<8;group++){
  await Promise.all([tick(db),tick(db),tick(db)]);
  let posts=await pending(db);
  const accounts=[id(100+group*2),...(group===7?[]:[id(101+group*2)])];
  assert.deepEqual(posts.map(p=>p.ig_account_id),accounts);
  // Os dois parceiros podem manter um lease ao mesmo tempo.
  const first=posts[0],second=posts[1];assert.equal(await claim(db,first.id,id(20)),true);
  if(second)assert.equal(await claim(db,second.id,id(21)),true);
  assert.equal(await claim(db,first.id,id(22)),false);
  await done(db,first.id);await release(db,first.id,id(20));
  // Primeira conta termina seus 10; a segunda permanece no primeiro post.
  for(let n=1;n<10;n++){
   await tick(db);posts=await pending(db);
   assert(posts.every(p=>accounts.includes(p.ig_account_id)));assert(posts.length<=2);
   const p=posts.find(p=>p.ig_account_id===accounts[0]);assert(p);
   assert.equal(await claim(db,p.id,id(20)),true);await done(db,p.id);await release(db,p.id,id(20));
  }
  if(second){
   await tick(db);posts=await pending(db);assert.equal(posts.length,1);assert.equal(posts[0].id,second.id);
   await done(db,second.id);await release(db,second.id,id(21));
   for(let n=1;n<10;n++){
    await tick(db);posts=await pending(db);assert.equal(posts.length,1);assert.equal(posts[0].ig_account_id,accounts[1]);
    assert.equal(await claim(db,posts[0].id,id(21)),true);await done(db,posts[0].id);await release(db,posts[0].id,id(21));
   }
  }
 }
 assert.equal((await tick(db)).status,'completed');
 const totals=(await db.query('SELECT ig_account_id,count(*)::int n FROM scheduled_posts GROUP BY ig_account_id')).rows;
 assert.equal(totals.length,15);assert(totals.every(r=>r.n===20));
 const captions=(await db.query('SELECT i.account_index,s.caption FROM publication_round_items i JOIN scheduled_posts s ON s.id=i.post_id')).rows;
 for(const row of captions)assert.equal(row.caption,['primeira','segunda','terceira'][Math.floor(row.account_index/6)%3]);
 }finally{await db.close();}
});

test('pares respeitam 60s por conta, pausa/falha, progresso existente e barreira contra outra conta',{skip:!PGlite},async()=>{
 const db=await setup(3);try{
 const run=await save(db,3,13,10);await control(db,run,'start');
 const oldPost=(await tick(db)).post_id;await done(db,oldPost);
 await db.query('UPDATE publication_round_accounts SET spacing_seconds=60 WHERE run_id=$1',[run]);
 await db.exec(sql);await tick(db);
 const posts=await pending(db);assert.equal(posts.length,2);
 const first=posts.find(p=>p.ig_account_id===id(100)),second=posts.find(p=>p.ig_account_id===id(101));
 assert.equal(await claim(db,first.id,id(20)),false); // só a conta 1 tem publicação recente
 assert.equal(await claim(db,second.id,id(21)),true);await release(db,second.id,id(21));
 await control(db,run,'pause');assert.equal(await claim(db,second.id,id(21)),false);
 await control(db,run,'resume');
 await db.query("UPDATE scheduled_posts SET status='failed',last_error='teste' WHERE id=$1",[second.id]);
 assert.equal((await tick(db)).status,'failed');assert.equal(await claim(db,first.id,id(20)),false);
 await db.query("UPDATE scheduled_posts SET status='publishing',ig_container_id='existing',scheduled_at=now() WHERE id=$1",[first.id]);
 assert.equal(await claim(db,first.id,id(20)),true); // um parceiro já iniciado pode terminar
 assert.equal(await claim(db,second.id,id(21)),false); // nenhuma nova tentativa enquanto falhou
 await done(db,first.id);await release(db,first.id,id(20));
 await control(db,run,'resume');await tick(db);
 assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,4);
 assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts WHERE ig_account_id=$1',[id(102)])).rows[0].n,0);
 }finally{await db.close();}
});
