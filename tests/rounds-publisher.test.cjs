const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const vm=require('vm');const ts=require('typescript');
function engine({allowed=true,round=false,failCompletion=false}={}){
 const post={id:'post',user_id:'user',ig_account_id:'account',post_type:'reel',status:'scheduled',caption:'test',first_comment:null,cover_url:null,cover_media_id:null,thumbnail_offset:null,scheduled_at:new Date().toISOString(),interval_minutes:null,recurrence:'none',ig_container_id:null,round_run_id:round?'run':null};
 let leased=false, released=0, published=false, fail=failCompletion;const calls=[];
 const db={from(table){let patch;const q={
  select(){return q},eq(){return q},neq(){return q},ilike(){return q},gte(){return q},lte(){return q},lt(){return q},order(){return q},limit(){return q},in(){return q},or(){return q},
  update(p){patch=p;return q},
  async single(){return {data:table==='scheduled_posts'?{...post}:{ig_user_id:'ig',access_token:'test-only',username:'demo'},error:null}},
  then(resolve){
   if(patch){if(patch.status==='published'&&fail){fail=false;resolve({error:{message:'database unavailable'}});return;}Object.assign(post,patch);}
   resolve({error:null,data:table==='post_media'?[{position:0,media_assets:{storage_path:'video.mp4',media_kind:'video'}}]:[]});
  }
 };return q;},storage:{from(){return {async createSignedUrl(){return {data:{signedUrl:'https://example.invalid/video.mp4'}}}}}}};
 const gate={async claimPublicationSend(){if(!allowed||leased)return null;leased=true;return 'token'},async releasePublicationSend(){leased=false;released++},publicationWait(){return {scheduled_at:new Date().toISOString(),reason:'waiting'}}};
 const fetch=async(url,opts)=>{const u=new URL(url);calls.push({path:u.pathname,method:opts.method});let data;
  if(u.pathname.endsWith('/media_publish')){published=true;data={id:'confirmed-media'};}
  else if(u.pathname.endsWith('/media')&&opts.method==='POST')data={id:'container'};
  else if(u.searchParams.get('fields')==='status_code,status')data={status_code:published?'PUBLISHED':'FINISHED'};
  else if(u.searchParams.get('fields')==='id')data={id:'confirmed-media'};
  else data={permalink:'https://example.invalid/reel'};
  return {ok:true,json:async()=>data};
 };
 const source=fs.readFileSync('src/lib/publish.server.ts','utf8').replace(/^import .*client.server.*;\r?$/gm,'');
 const ctx={exports:{},require(name){if(name==='./rounds.server')return gate;throw new Error('Unexpected import '+name)},supabaseAdmin:db,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch,console,Date};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 return {api:ctx.exports,post,calls,get released(){return released}};
}
test('porta bloqueia cron, envio manual e recuperação antes de qualquer chamada à Meta',async()=>{
 const e=engine({allowed:false});assert.equal((await e.api.processScheduledPostTick('post',{publishNow:true})).status,'delayed');
 assert.equal((await e.api.attemptRecovery('post')).kind,'delayed');await assert.rejects(()=>e.api.publishScheduledPost('post'),/aguardando/);
 assert.equal(e.calls.length,0);assert.equal(e.post.status,'scheduled');
});
test('sem rodada, publicador normal continua criando e confirmando um reel',async()=>{
 const e=engine();const r=await e.api.processScheduledPostTick('post');assert.equal(r.status,'published');assert.equal(e.post.ig_media_id,'confirmed-media');assert.equal(e.released,1);
 assert.equal(e.calls.filter(c=>c.path.endsWith('/media_publish')).length,1);
});
test('falha ao salvar confirmação mantém container e retoma sem publicar outra vez',async()=>{
 const e=engine({round:true,failCompletion:true});await assert.rejects(()=>e.api.processScheduledPostTick('post'),/database unavailable/);
 assert.equal(e.post.status,'publishing');assert.equal(e.post.ig_container_id,'container');
 assert.equal((await e.api.processScheduledPostTick('post')).status,'published');
 assert.equal(e.calls.filter(c=>c.path.endsWith('/media_publish')).length,1);assert.equal(e.released,2);
});

test('retry manual da fila não apaga o container de uma rodada',async()=>{const e=engine({round:true});await assert.rejects(()=>e.api.resetPostForManualRetry('post'),/Use Continuar/);assert.equal(e.post.status,'scheduled');assert.equal(e.calls.length,0);});
