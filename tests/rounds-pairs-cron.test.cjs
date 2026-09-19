const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const vm=require('vm');const ts=require('typescript');
async function cron(reserved,concurrent_accounts){
 let active=0,max=0;const queries=[];
 const db={from(){let status;const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);if(k==='status')status=v;return q},lt(){return q},lte(){return q},order(){return q},limit(){return q},then(resolve){queries.push(filters);resolve({data:status==='scheduled'?[{id:'p1',ig_account_id:'a1'},{id:'p2',ig_account_id:'a2'}]:[],error:null});}};return q;}};
 const mocks={
  '@tanstack/react-router':{createFileRoute:()=>x=>x},
  '@/integrations/supabase/client.server':{supabaseAdmin:db},
  '@/lib/rounds.server':{tickPublicationRounds:async()=>({reserved,concurrent_accounts,run_id:reserved?'run':undefined})},
  '@/lib/publish.server':{processScheduledPostTick:async()=>{active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,10));active--;return {status:'processing'};},markPostFailed:async()=>assert.fail('unexpected error')},
 };
 const ctx={exports:{},require:n=>mocks[n],process:{env:{SUPABASE_PUBLISHABLE_KEY:'test'}},Response,Date};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/routes/api/public/cron/publish-scheduled.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 const response=await ctx.exports.Route.server.handlers.POST({request:new Request('http://test',{headers:{apikey:'test'}})});
 assert.equal(response.status,200);assert.equal((await response.json()).processed,2);
 return {max,queries};
}
test('cron executa dois parceiros em paralelo e filtra a execução reservada',async()=>{
 const r=await cron(true);assert.equal(r.max,2);assert(r.queries.every(filters=>filters.some(([k,v])=>k==='round_run_id'&&v==='run')));
});
test('cron mantém processamento normal sequencial sem rodadas',async()=>{assert.equal((await cron(false)).max,1);});
test('cron respeita uma conta quando configurado',async()=>{assert.equal((await cron(true,1)).max,1);});
