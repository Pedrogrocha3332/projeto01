
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const ts=require('typescript');const fs=require('node:fs');
const ctx={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/delete-library-videos.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
const remove=ctx.exports.deleteLibraryVideos;
function fake(rows,fail=false,storageFail=false){const removed=[];return {removed,from(){let ids,kind;const q={delete(){return q},in(k,v){ids=v;return q},eq(k,v){kind=v;return q},async select(){if(fail)return {error:{message:'blocked'}};const data=rows.filter(r=>ids.includes(r.id)&&r.media_kind===kind);return {data}}};return q},storage:{from(){return {async remove(paths){removed.push(...paths);return {error:storageFail?{}:null}}}}}}}
test('apaga somente vídeos confirmados e seus arquivos, preservando fotos e outras contas',async()=>{
 const db=fake([{id:'v',media_kind:'video',storage_path:'v.mp4',thumbnail_path:'v.jpg'},{id:'photo',media_kind:'image',storage_path:'p.jpg'},{id:'other',media_kind:'video',storage_path:'other.mp4'}]);
 const r=await remove(db,['v','photo']);assert.equal(r.deleted,1);assert.deepEqual(db.removed,['v.mp4','v.jpg']);
});
test('falha no banco preserva arquivos e falha de storage é informada',async()=>{
 const db=fake([],true);await assert.rejects(()=>remove(db,['v']),/blocked/);assert.equal(db.removed.length,0);
 const r=await remove(fake([{id:'v',media_kind:'video',storage_path:'v.mp4'}],false,true),['v']);assert.equal(r.deleted,1);assert.equal(r.storageFailures,1);
});

