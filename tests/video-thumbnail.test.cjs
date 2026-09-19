const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
function moduleCode(p){return ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}
const utils={exports:{}};vm.runInNewContext(moduleCode('src/lib/video-utils.ts'),utils);
test('identifica quadro preto sem rejeitar imagem com conteúdo visível',()=>{
 const dark=new Uint8ClampedArray(400).fill(0);
 assert.equal(utils.exports.isDarkFrame(dark),true);
 const visible=dark.slice();for(let i=0;i<200;i+=4)visible[i]=150;
 assert.equal(utils.exports.isDarkFrame(visible),false);
});
function resolver({broken=false,generateFails=false}={}){
 let generated=0,signed=0;
 class Image {
  naturalWidth=32;
  set src(value){ if(!value)return; this.url=value; queueMicrotask(()=>{if(broken)this.onerror?.();else this.onload?.()}) }
 }
 const db={storage:{from:()=>({createSignedUrl:async path=>{signed++;return {data:{signedUrl:'fresh:'+path}}},upload:async()=>({error:true})})}};
 class FileReader {readAsDataURL(){this.result='data:image/jpeg;base64,generated';this.onload()}}
 const context={exports:{},require(name){
  if(name.includes('client'))return {supabase:db};
  if(name.includes('thumb-queue'))return {thumbQueue:{run:fn=>fn()}};
  return {isDarkFrame:utils.exports.isDarkFrame,generateVideoThumbnail:async()=>{generated++;if(generateFails)throw Error('decode');return new Blob(['jpeg'])}};
 },Image,FileReader,Blob,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,queueMicrotask,document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4096)})})})}};
 vm.runInNewContext(moduleCode('src/lib/video-thumbnail.ts'),context);
 return {load:context.exports.resolveVideoThumbnail,stats:()=>({generated,signed})};
}
test('recupera imagem preta e reutiliza uma única geração entre biblioteca e pool',async()=>{
 const r=resolver();const source={storagePath:'owner/video',thumbnailUrl:'black.jpg',thumbnailPath:'old.jpg'};
 const [a,b]=await Promise.all([r.load(source),r.load(source)]);
 assert.equal(a,'data:image/jpeg;base64,generated');assert.equal(a,b);
 assert.equal(r.stats().generated,1);assert.equal(r.stats().signed,2);
});
test('imagem expirada falha de forma limitada e é reconstruída',async()=>{
 const r=resolver({broken:true});await r.load({storagePath:'owner/video',thumbnailUrl:'expired.jpg',thumbnailPath:'missing.jpg'});
 assert.equal(r.stats().generated,1);assert.equal(r.stats().signed,2);
});
test('falha de decodificação não fica presa no cache',async()=>{
 const r=resolver({generateFails:true});
 for(let i=0;i<2;i++)await assert.rejects(()=>r.load({storagePath:'owner/video'}),/decode/);
 assert.equal(r.stats().generated,2);
});
