const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function engine(rateLimited = false) {
  const updates = [];
  const db = { from() {
    let history = false;
    const q = new Proxy({ then(resolve) { resolve({ data: history ? Array.from({length:12}, (_,i) => ({id:String(i),status:'published',scheduled_at:new Date(Date.now()-60000).toISOString(),published_at:new Date(Date.now()-60000).toISOString()})) : rateLimited ? [{updated_at: new Date().toISOString(), last_error: 'too many actions'}] : [] }); } }, {
      get(target, key) {
        if (key === 'then') return target.then;
        return (...args) => { if (key === 'or') history = true; if (key === 'update') updates.push(args[0]); return q; };
      }
    });
    return q;
  }};
  let source = fs.readFileSync('src/lib/publish.server.ts', 'utf8');
  source = source.slice(0, source.indexOf('async function signedUrl')).replace(/import .*client.server.*;\r?\n/, '');
  source += '\nexport { maybeDelayUnsafeStart };\nasync function logHealing() {}';
  const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const context = {exports:{},supabaseAdmin:db,Date};
  vm.runInNewContext(js, context);
  return {...context.exports,updates};
}

test('12 posts da mesma conta podem ser enviados sem quota horária', async () => {
  const e = engine();
  for (let i=0;i<12;i++) {
    const result = await e.computeSafePublishSlot('account',new Date());
    assert.equal(result.delayed,false);
  }
});
test('publicar agora ignora data futura; cron preserva agendamento', async () => {
  const e=engine();
  const post={id:'post',ig_account_id:'account',status:'scheduled',scheduled_at:new Date(Date.now()+3600000).toISOString()};
  assert.equal(await e.maybeDelayUnsafeStart(post,true),null);
  assert.equal(e.updates.length,0);
  assert.equal((await e.maybeDelayUnsafeStart(post)).delayed,true);
});
test('resposta recente de rate-limit continua reagendando', async () => {
  const e=engine(true);
  const r=await e.computeSafePublishSlot('account',new Date());
  assert.equal(r.delayed,true);
  assert.equal(r.reason,'cooldown_account_rate_limit');
});
