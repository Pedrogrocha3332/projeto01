const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {test}=require('node:test');
const assert=require('node:assert/strict');
function poolEngine(rows) {
  const db={from(){
    let conditions=[],patch=null,head=false;
    const q={
      select(_s,opts){head=Boolean(opts?.head);return q},
      eq(k,v){conditions.push(r=>r[k]===v);return q},
      order(){return q},
      update(p){patch=p;return q},
      then(resolve){const data=rows.filter(r=>conditions.every(fn=>fn(r))).sort((a,b)=>a.position-b.position);
        if(patch)data.forEach(r=>Object.assign(r,patch));
        resolve({data:head?null:data.map(r=>({...r})),count:data.length,error:null});}
    };return q;
  }};
  let source=fs.readFileSync('src/lib/pools.server.ts','utf8').replace(/^import .*;\r?$/gm,'');
  source+='\nexport {pickBatch, resetCycle};';
  const ctx={exports:{},supabaseAdmin:db};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
  return ctx.exports;
}
test('ordem manual atravessa ciclos sem pular vídeos nem repetir no lote',async()=>{
  const rows=Array.from({length:6},(_,i)=>({id:String(i+1),media_asset_id:String(i+1),pool_id:'pool',position:i,posted_in_current_cycle:false}));
  const e=poolEngine(rows),pool={id:'pool',manual_order:true,batch_size:4,cycle_number:1};
  const results=[];
  for(let n=0;n<3;n++){
    const picked=await e.pickBatch(pool);
    results.push(Array.from(picked,v=>v.id));
    for(const v of picked)rows.find(r=>r.id===v.id).posted_in_current_cycle=!v.fromPreviousCycle;
  }
  assert.deepEqual(results,[['1','2','3','4'],['5','6','1','2'],['3','4','5','6']]);
  assert.deepEqual(rows.map(r=>r.position),[0,1,2,3,4,5]);
});
test('lote maior que biblioteca usa apenas vídeos únicos',async()=>{
  const rows=Array.from({length:3},(_,i)=>({id:String(i),media_asset_id:String(i),pool_id:'pool',position:i,posted_in_current_cycle:false}));
  const picked=await poolEngine(rows).pickBatch({id:'pool',manual_order:true,batch_size:12,cycle_number:1});
  assert.equal(picked.length,3);
  assert.equal(new Set(picked.map(v=>v.id)).size,3);
});
test('validação permite vídeos acessíveis de outras contas e recusa acesso ausente ou seleção inválida',async()=>{
  const code=fs.readFileSync('src/lib/media-account.server.ts','utf8');
  const ctx={exports:{}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
  function db(account,assets){return {from(t){const q={select(){return q},eq(){return q},single:async()=>({data:account,error:null}),in:async()=>({data:assets,error:null})};return q}}}
  await ctx.exports.validatePoolVideos(db({id:'a'},[{id:'v',media_kind:'video',ig_account_id:'a'}]),'a',['v']);
  for(const accountId of ['b',null])await ctx.exports.validatePoolVideos(db({id:'a'},[{id:'v',media_kind:'video',ig_account_id:accountId}]),'a',['v']);
  await assert.rejects(()=>ctx.exports.validatePoolVideos(db({id:'a'},[]),'a',['hidden']),/disponíveis/);
  await assert.rejects(()=>ctx.exports.validatePoolVideos(db({id:'a'},[{id:'photo',media_kind:'image'}]),'a',['photo']),/disponíveis/);
  await assert.rejects(()=>ctx.exports.validatePoolVideos(db(null,[]),'a',['v']),/sem acesso/);
  await assert.rejects(()=>ctx.exports.validatePoolVideos(db({id:'a'},[]),'a',['v','v']),/repetidos/);
});

test('primeiro lote usa exceção uma vez e preserva ordem nos seguintes e ciclos', async()=>{
  const rows=Array.from({length:12},(_,i)=>({id:String(i+1),media_asset_id:String(i+1),pool_id:'pool',position:i,posted_in_current_cycle:false}));
  const engine=poolEngine(rows), pool={id:'pool',manual_order:true,batch_size:3,first_batch_size:6,batches_published:0,cycle_number:1};
  const sizes=[];
  for(let i=0;i<4;i++){
    const picked=await engine.pickBatch(pool);
    sizes.push(picked.length);
    if(i===0)assert.deepEqual(Array.from(picked,v=>v.id),['1','2','3','4','5','6']);
    if(i===1)assert.deepEqual(Array.from(picked,v=>v.id),['7','8','9']);
    for(const v of picked)rows.find(r=>r.id===v.id).posted_in_current_cycle=!v.fromPreviousCycle;
    pool.batches_published++;
  }
  assert.deepEqual(sizes,[6,3,3,3]);
});
test('pool antigo sem primeiro lote continua usando seu tamanho original',async()=>{
  const rows=Array.from({length:8},(_,i)=>({id:String(i),media_asset_id:String(i),pool_id:'pool',position:i,posted_in_current_cycle:false}));
  const e=poolEngine(rows);
  for(const first_batch_size of [null,undefined])assert.equal((await e.pickBatch({id:'pool',batch_size:3,first_batch_size,batches_published:0,cycle_number:1})).length,3);
});

test('limite total reduz o lote final e bloqueia pools esgotados',async()=>{
 const rows=Array.from({length:10},(_,i)=>({id:String(i),media_asset_id:String(i),pool_id:'pool',position:i,posted_in_current_cycle:false}));
 const engine=poolEngine(rows);
 for(const used of [0,37,38,39,40,45]){
 const picked=await engine.pickBatch({id:'pool',manual_order:true,batch_size:6,first_batch_size:8,batches_published:1,cycle_number:1,reels_reserved:used,reels_published:used});
 assert.equal(picked.length,Math.max(0,Math.min(6,40-used)));
 }
});

test('limite editável reduz último lote para 30 e permite limite maior que 40',async()=>{
 const rows=Array.from({length:10},(_,i)=>({id:String(i),media_asset_id:String(i),pool_id:'pool',position:i,posted_in_current_cycle:false}));
 const engine=poolEngine(rows);
 for(const [limit,used,expected] of [[30,29,1],[30,30,0],[40,39,1],[50,40,6]]){
 const picked=await engine.pickBatch({id:'pool',manual_order:true,batch_size:6,batches_published:1,cycle_number:1,reel_limit:limit,reels_reserved:used,reels_published:used});
 assert.equal(picked.length,expected);
 }
});
