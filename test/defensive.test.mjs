import test from 'node:test';
import assert from 'node:assert/strict';
import {lightweight} from '../dist/lightweight.js';
import {budgetedRequests} from '../dist/request-budget.js';
import {promptFor,contextCovers} from '../dist/grouping.js';
import {CompatibleProvider} from '../dist/inference.js';
test('large scope budgets preserve every target and declaration exactly once',()=>{
 const code=Array.from({length:1200},(_,i)=>`let variable${i}=${i};`).join('\n');
 const a=lightweight(code),ids=a.symbols.map(s=>s.id);
 const requests=budgetedRequests(code,a,ids,4000,16);
 assert.deepEqual(requests.flatMap(r=>r.targets.map(s=>s.id)).sort(),[...ids].sort());
 for(const r of requests){assert.ok(Buffer.byteLength(promptFor(r))<=4000);for(const s of r.targets)assert.ok(contextCovers(r.contextRanges,s.declaration));}
 assert.throws(()=>budgetedRequests(code,a,[ids[0],ids[0]]),/Duplicate/);
 assert.throws(()=>lightweight(' '.repeat(8*1024*1024+1)),/limit/);
});
test('external responses bounded, redirects forbidden, quota hints preserved, no retries',async()=>{
 const code='let x=1;',a=lightweight(code),request=budgetedRequests(code,a,a.symbols.map(s=>s.id))[0];
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async(url,init)=>{calls++;assert.equal(init.redirect,'error');return new Response('x'.repeat(100),{status:200});};
  const provider=new CompatibleProvider({baseUrl:'https://example.invalid',apiKey:'secret',model:'m',maxResponseBytes:32});
  await assert.rejects(provider.infer(request),/byte limit/);assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;return new Response('quota',{status:429,headers:{'retry-after':'2'}});};
  await assert.rejects(provider.infer(request),e=>e.httpStatus===429&&e.retryAfterMs===2000);assert.equal(calls,2);
  const small=new CompatibleProvider({baseUrl:'https://example.invalid',apiKey:'secret',model:'m',maxPromptBytes:1});
  await assert.rejects(small.infer(request),/before API/);assert.equal(calls,2);
  globalThis.fetch=async()=>new Response('null');await assert.rejects(provider.infer(request),/envelope/);
 }finally{globalThis.fetch=original;}
});

// Minified-style sample with module state, callbacks, a class and destructuring.
const SAMPLE=`var n=new Map,r=0;function t(e,o){var i=n.get(e);if(!i){i={id:++r,items:[],total:0};n.set(e,i)}i.items.push(o);i.total+=o.price*o.qty;return i}
function u(e){var o=n.get(e);if(!o)return null;var i=o.items.filter(function(a){return a.qty>0}).map(function(a){return{name:a.name,cost:a.price*a.qty}});return{id:o.id,lines:i,total:o.total}}
class c{constructor(e){this.rate=e;this.log=[]}apply(e){const{total:o,lines:i}=e,a=o*this.rate;this.log.push({at:Date.now(),tax:a});return{...e,tax:a,count:i.length}}}
const s=(e,o=.1)=>{const i=new c(o),a=u(e);return a?i.apply(a):void 0};
function l(e,...o){for(const i of o)t(e,i);return s(e)}
globalThis.checkout=l;`;

test('default plan cost for a fixed sample is pinned',async()=>{
 const {planRecovery}=await import('../dist/library.js');
 // Planned calls and prompt bytes are the cost this project optimizes. Update these
 // numbers only for an intended change to grouping, context or the prompt text.
 assert.deepEqual(planRecovery(SAMPLE),{identifiers:27,calls:7,promptBytes:9557,largestPromptBytes:3697,warnings:[]});
 assert.deepEqual(planRecovery(SAMPLE,{contextMode:'declarations',promptFormat:'verbose',maxTargets:4}),{identifiers:27,calls:12,promptBytes:16974,largestPromptBytes:2970,warnings:[]});
});

test('every file the build, tests and playground import is tracked by git',async t=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const {readFile}=await import('node:fs/promises');const {posix}=await import('node:path');
 // The ignore file is an allowlist, so a new source file is silently untracked until it is listed there.
 let tracked;
 try{tracked=new Set((await promisify(execFile)('git',['ls-files'])).stdout.split('\n'));}catch{t.skip('not a git checkout');return;}
 if(!tracked.has('package.json')){t.skip('not the repository root');return;}
 const scripts=Object.values(JSON.parse(await readFile('package.json','utf8')).scripts).join(' ');
 const pending=[...JSON.parse(await readFile('tsconfig.json','utf8')).include,...scripts.match(/(?:test|scripts|web)\/[\w.-]+\.mjs/g),
  'web/app.js','web/browser-worker.js','web/browser-globals.js','web/browser-crypto.js','web/index.html','web/style.css','examples/offline-demo.mjs'];
 const seen=new Set();
 while(pending.length){
  const file=pending.pop();if(seen.has(file))continue;seen.add(file);
  if(!/\.(ts|js|mjs)$/.test(file))continue;
  for(const [,spec] of (await readFile(file,'utf8')).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"\n]+\.(?:ts|js|mjs))['"]/g)){
   let target=posix.normalize(posix.join(posix.dirname(file),spec));
   if(target.startsWith('pages-dist/'))continue;
   // Built output maps back to the source it was compiled from.
   if(/^(package-)?dist\//.test(target))target=target.replace(/^(package-)?dist\//,'src/').replace(/\.js$/,'.ts');
   else if(file.startsWith('src/'))target=target.replace(/\.js$/,'.ts');
   pending.push(target);
  }
 }
 assert.ok(seen.size>30);
 assert.deepEqual([...seen].filter(file=>!tracked.has(file)),[]);
});
