const {test}=require('node:test');const assert=require('node:assert/strict');
const {PGlite,id,setup,save,control,tick,claim,release}=require('./helpers/rounds-db.cjs');
test('15 contas: 10 de cada em duas rodadas; nenhum avanço antes da confirmação, sem duplicação concorrente',{skip:!PGlite},async()=>{
 const db=await setup(15);try{
 const run=await save(db,15);
 assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,0);
 assert.deepEqual((await db.query('SELECT * FROM media_pools')).rows,[{id:id(3),status:'paused'}]);
 await control(db,run,'start');
 const plan=(await db.query('SELECT i.*,a.ig_account_id FROM publication_round_items i JOIN publication_round_accounts a ON a.id=i.participant_id ORDER BY sequence')).rows;
 assert.equal(plan.length,300);
 for(let k=0;k<300;k++){
   const expectedAccount=id(100+Math.floor((k%150)/10));
   assert.equal(plan[k].ig_account_id,expectedAccount);
   assert.equal(plan[k].round_number,Math.floor(k/150)+1);
   assert.equal(plan[k].media_asset_id,id(4+(plan[k].account_index%2)));
   const concurrent=await Promise.all([tick(db),tick(db)]);
   const post=concurrent[0].post_id;assert.equal(post,concurrent[1].post_id);
   assert.equal((await db.query("SELECT count(*)::int n FROM scheduled_posts WHERE status<>'published'")).rows[0].n,1);
   const leases=await Promise.all([claim(db,post,id(10)),claim(db,post,id(11))]);assert.equal(leases.filter(Boolean).length,1);
   await db.query("UPDATE scheduled_posts SET status='publishing',ig_container_id='container' WHERE id=$1",[post]);
   assert.equal((await tick(db)).post_id,post);
   await db.query("UPDATE scheduled_posts SET status='published',ig_media_id=$2,published_at=now() WHERE id=$1",[post,`media-${k}`]);
   await release(db,post,leases[0]?id(10):id(11));
 }
 assert.equal((await tick(db)).status,'completed');assert.equal((await tick(db)).reserved,false);
 assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,300);
 assert.equal((await db.query('SELECT status FROM media_pools')).rows[0].status,'paused');
 await db.exec('DELETE FROM scheduled_posts');
 assert.equal((await db.query('SELECT count(*)::int n FROM publication_round_items WHERE confirmed_at IS NOT NULL AND confirmed_media_id IS NOT NULL')).rows[0].n,300);
 await db.exec('DELETE FROM media_assets');
 assert.equal((await tick(db)).reserved,false);
 }finally{await db.close();}
});

test('rascunho, conflito com pools/fila, pausa, falha, retomada no mesmo post e cancelamento',{skip:!PGlite},async()=>{
 const db=await setup();try{
 const run=await save(db);
 await db.exec("UPDATE media_pools SET status='active'");await assert.rejects(()=>control(db,run,'start'),/Pause os pools/);
 await db.exec("UPDATE media_pools SET status='paused'");
 const normal=id(600);await db.query("INSERT INTO scheduled_posts(id,status,scheduled_at) VALUES($1,'scheduled',now())",[normal]);
 await assert.rejects(()=>control(db,run,'start'),/fila normal/);
 await db.query("UPDATE scheduled_posts SET status='draft' WHERE id=$1",[normal]);
 assert.equal(await claim(db,normal,id(10)),true);
 await assert.rejects(()=>control(db,run,'start'),/fila normal/);
 await release(db,normal,id(10));
 await control(db,run,'start');
 assert.equal(await claim(db,normal,id(10)),false);
 const second=await save(db);await assert.rejects(()=>control(db,second,'start'),/Outra execução/);
 const post=(await tick(db)).post_id;
 await control(db,run,'pause');assert.equal(await claim(db,post,id(10)),false);
 await control(db,run,'resume');assert.equal(await claim(db,post,id(10)),true);
 await release(db,post,id(10));
 await db.query("UPDATE scheduled_posts SET status='failed',ig_container_id='keep-container',last_error='Meta error' WHERE id=$1",[post]);
 assert.equal((await tick(db)).status,'failed');assert.equal(await claim(db,post,id(10)),false);
 await control(db,run,'resume');
 assert.equal((await tick(db)).post_id,post);
 assert.equal((await db.query('SELECT ig_container_id FROM scheduled_posts WHERE id=$1',[post])).rows[0].ig_container_id,'keep-container');
 await control(db,run,'pause');await assert.rejects(()=>control(db,run,'cancel'),/processamento/);
 await db.query("UPDATE scheduled_posts SET status='failed' WHERE id=$1",[post]);
 await control(db,run,'cancel');assert.equal((await tick(db)).reserved,false);
 assert.equal(await claim(db,post,id(10)),false);
 assert.equal(await claim(db,normal,id(10)),true);
 }finally{await db.close();}
});

test('RLS e RPCs administrativos; total não divisível, espaçamento e mídia protegida',{skip:!PGlite},async()=>{
 const db=await setup(2);try{
 const run=await save(db,2,13,10);
 await db.exec(`SET ROLE authenticated; SET test.uid='${id(2)}';`);
 assert.equal((await db.query('SELECT count(*)::int n FROM publication_rounds')).rows[0].n,0);
 await assert.rejects(()=>control(db,run,'start'),/permission denied/);
 await db.exec('RESET ROLE');
 await db.query('UPDATE publication_round_accounts SET spacing_seconds=60 WHERE run_id=$1',[run]);
 await control(db,run,'start');
 assert.equal((await db.query('SELECT count(*)::int n FROM publication_round_items')).rows[0].n,26);
 await assert.rejects(()=>db.query('DELETE FROM media_assets WHERE id=$1',[id(4)]),/rodada em andamento/);
 const first=(await tick(db)).post_id;
 await db.query("UPDATE scheduled_posts SET status='published',ig_media_id='ok',published_at=now() WHERE id=$1",[first]);
 const next=(await tick(db)).post_id;assert.notEqual(next,first);
 assert.equal(await claim(db,next,id(10)),false);
 assert.equal((await db.query('SELECT scheduled_at>now() future FROM scheduled_posts WHERE id=$1',[next])).rows[0].future,true);
 }finally{await db.close();}
});
