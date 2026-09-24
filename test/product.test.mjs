import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {recoverNames} from '../dist/library.js';
import {createHtmlReporter} from '../dist/html-reporter.js';
import {CompatibleProvider} from '../dist/inference.js';
import {promptFor} from '../dist/grouping.js';

test('single pass is default and invalid pass counts fail before inference',async()=>{
 const events=[];let calls=0;
 const provider={label:'default mode',async infer(r){calls++;return {names:Object.fromEntries(r.targets.map(s=>[s.id,s.name])),inputTokens:1,outputTokens:1};}};
 const source='function f(a){return a+1;}globalThis.answer=f(2);';
 const result=await recoverNames(source,{provider,rpm:60000,onEvent:e=>events.push(e)});
 assert.equal(result.status,'completed');assert.equal(calls,1);
 assert.deepEqual(events.filter(e=>e.type==='plan').map(e=>e.pass),[1]);
 for(const passes of [0,3,1.5,'2',NaN])await assert.rejects(recoverNames(source,{provider,passes}),/passes must be/);
 assert.equal(calls,1);
});
test('product API emits live report, preserves behavior and finalizes output offline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flowname-product-'));const reporter=await createHtmlReporter(join(root,'report'));
 const provider={label:'local test fixture',async infer(r){return {names:Object.fromEntries(r.targets.map(s=>[s.id,'value'])),inputTokens:10,outputTokens:5};}};
 const result=await recoverNames('function f(a,b){return a+b;}globalThis.answer=f(2,3);',{provider,rpm:60000,onEvent:reporter.onEvent});
 assert.equal(result.status,'completed');assert.equal(runInNewContext(result.code+'answer'),5);
 assert.match(await readFile(reporter.path,'utf8'),/completed/);
 assert.ok((await readFile(join(root,'report/events.jsonl'),'utf8')).includes('"type":"request"'));
 await assert.rejects(createHtmlReporter(join(root,'report')));
});
test('product enforces call budget before provider access and stops on quota failure',async()=>{
 let calls=0;const provider={label:'fixture',async infer(){calls++;throw Object.assign(new Error('quota'),{httpStatus:429});}};
 const code='function f(a){return a;}function g(b){return b;}';
 await assert.rejects(recoverNames(code,{provider,maxTargets:1,maxCalls:1}),/No requests sent/);assert.equal(calls,0);
 const result=await recoverNames(code,{provider,maxTargets:1,concurrency:1,rpm:60000});assert.equal(result.status,'partial');assert.equal(calls,1);assert.equal(result.inputTokens,null);
});

test('malformed model JSON is retried once with correction and both attempts logged and counted',async()=>{
 const originalFetch=globalThis.fetch, bodies=[],events=[];
 const root=await mkdtemp(join(tmpdir(),'flowname-repair-'));const reporter=await createHtmlReporter(join(root,'report'));
 try{
  globalThis.fetch=async(url,init)=>{
   bodies.push(JSON.parse(init.body));
   return new Response(JSON.stringify({choices:[{message:{content:bodies.length===1?'```bad json':'{"names":{"s6":"count"}}'}}],usage:{prompt_tokens:10,completion_tokens:3}}));
  };
  const provider=new CompatibleProvider({baseUrl:'https://example.invalid',apiKey:'fixture',model:'test'});
  const result=await recoverNames('const a=1; console.log(a);',{provider,maxCalls:2,rpm:60000,onEvent:async e=>{events.push(e);await reporter.onEvent(e);}});
  assert.equal(result.calls,2);assert.equal(result.failedCalls,1);assert.equal(result.status,'completed');
  assert.equal(result.inputTokens,20);assert.equal(result.outputTokens,6);
  assert.ok(bodies[1].messages[0].content.startsWith(bodies[0].messages[0].content));
  assert.match(bodies[1].messages[0].content,/Correction:/);
  assert.ok(!bodies[1].messages[0].content.includes('```bad json'));
  assert.deepEqual(events.filter(e=>e.type==='request').map(e=>[e.index,e.groupIndex,e.attempt]),[[0,0,1],[1,0,2]]);
  assert.match(await readFile(reporter.path,'utf8'),/Attempt 2/);
 }finally{globalThis.fetch=originalFetch;}
});

test('missing IDs stop after two attempts; retry honors call budget, byte budget and cancellation',async()=>{
 const code='const a=1,b=a+1,c=b+1,d=c+1,e=d+1,f=e+1,g=f+1,h=g+1; console.log(h);';
 for(const mode of ['twice','calls','bytes','cancel']){
  let calls=0,firstBytes=0;const events=[],controller=new AbortController();
  const provider={label:'invalid fixture',async infer(r){calls++;firstBytes=Buffer.byteLength(promptFor(r));return {names:{},inputTokens:5,outputTokens:2};}};
  // Measure the normal prompt once to choose a byte budget with no room for correction.
  if(mode==='bytes')await recoverNames(code,{provider,maxCalls:1,rpm:60000});
  calls=0;
  const result=await recoverNames(code,{provider,rpm:60000,maxCalls:mode==='calls'?1:3,promptBytes:mode==='bytes'?firstBytes:12000,signal:controller.signal,onEvent:e=>{events.push(e);if(mode==='cancel'&&e.type==='response')controller.abort();}});
  assert.equal(calls,mode==='twice'?2:1);assert.equal(Object.keys(result.accepted).length,0);
  assert.equal(result.status,mode==='cancel'?'cancelled':'partial');
  assert.equal(result.inputTokens,5*calls);
  if(mode==='calls'||mode==='bytes')assert.ok(events.find(e=>e.type==='response').retrySkipped);
 }
});

test('partial acceptance preserves valid names and retries only invalid or missing IDs',async()=>{
 const requests=[],events=[];
 const provider={label:'partial fixture',async infer(r){
  requests.push(r);
  if(requests.length===1)return {names:{[r.targets[0].id]:'firstValue',[r.targets[1].id]:'not-valid',foreign:'ignored'},inputTokens:10,outputTokens:4};
  return {names:Object.fromEntries(r.targets.map(s=>[s.id,'remainingValue'])),inputTokens:8,outputTokens:3};
 }};
 const result=await recoverNames('const a=1,b=a+1; globalThis.answer=b;',{provider,rpm:60000,maxCalls:2,onEvent:e=>events.push(e)});
 assert.equal(result.status,'completed');assert.equal(requests.length,2);
 assert.equal(requests[1].targets.length,1);
 assert.ok(!requests[1].targets.some(s=>s.id===requests[0].targets[0].id));
 assert.equal(result.accepted[requests[0].targets[0].id],'firstValue');
 assert.deepEqual(events.find(e=>e.type==='response').ignoredIds,['foreign']);
 assert.equal(result.inputTokens,18);assert.equal(result.outputTokens,7);
 assert.equal(runInNewContext(result.code+'answer'),2);
});

test('partial values survive a broken repair and unknown IDs alone do not cause a retry',async()=>{
 let calls=0;
 const provider={label:'partial',async infer(r){calls++;return {names:calls===1?{[r.targets[0].id]:'retained'}:{},inputTokens:2,outputTokens:1};}};
 const result=await recoverNames('const a=1,b=2; console.log(a,b);',{provider,rpm:60000});
 assert.equal(calls,2);assert.equal(Object.keys(result.accepted).length,1);assert.equal(result.status,'partial');
 calls=0;
 const extra={label:'extra',async infer(r){calls++;return {names:{...Object.fromEntries(r.targets.map(s=>[s.id,s.name])),foreign:'ignore'},inputTokens:1,outputTokens:1};}};
 const complete=await recoverNames('let a=1;',{provider:extra});assert.equal(calls,1);assert.equal(complete.status,'completed');
});

test('two passes propagate applied names, preserve original IDs and protect first-pass collisions',async()=>{
 const events=[],requests=[];
 const provider={label:'phases',async infer(r){requests.push(r);return {names:Object.fromEntries(r.targets.map(s=>[s.id,'value'])),inputTokens:2,outputTokens:1};}};
 const source='function f(a){return a+1;}globalThis.answer=f(2);';
 const result=await recoverNames(source,{provider,passes:2,rpm:60000,onEvent:e=>events.push(e)});
 assert.equal(result.status,'completed');assert.equal(requests.length,2);
 assert.deepEqual(requests[0].targets.map(t=>t.name),['f']);
 assert.deepEqual(requests[1].targets.map(t=>t.name),['a']);
 assert.match(requests[1].context,/function value\(a\)/);
 assert.equal(requests[1].targets[0].id,'s11');
 assert.notEqual(requests[1].targets[0].declaration.start,11);
 assert.equal(result.accepted.s9,'value');assert.equal(result.accepted.s11,'value2');
 assert.equal(runInNewContext(result.code+'answer'),3);
 assert.deepEqual(events.filter(e=>e.type==='request').map(e=>e.pass),[1,2]);
 assert.ok(events.findIndex(e=>e.type==='pass-complete')<events.findIndex(e=>e.type==='request'&&e.pass===2));
});

test('class, nested functions and shorthand bindings retain identity across passes',async()=>{
 const source='class A { m(x){return x+1;} } const f=(a)=>{function g(b){return b*2;}return g(a);}; const v=2; globalThis.answer={v,result:new A().m(f(v))};';
 const provider={label:'roles',async infer(r){return {names:Object.fromEntries(r.targets.map(s=>[s.id,'named'+s.id])),inputTokens:1,outputTokens:1};}};
 const result=await recoverNames(source,{provider,passes:2,rpm:60000});
 assert.equal(result.status,'completed');
 assert.equal(JSON.stringify(runInNewContext(result.code+'answer')),JSON.stringify({v:2,result:5}));
 assert.ok(!result.warnings.length);
});

test('pass boundary cancellation preserves applied pass one without starting pass two',async()=>{
 let calls=0;const controller=new AbortController();
 const provider={label:'stop',async infer(r){calls++;return {names:Object.fromEntries(r.targets.map(s=>[s.id,'recoveredFunction'])),inputTokens:1,outputTokens:1};}};
 const result=await recoverNames('function f(a){return a;}globalThis.answer=f(3);',{provider,passes:2,rpm:60000,signal:controller.signal,onEvent:e=>{if(e.type==='pass-complete')controller.abort();}});
 assert.equal(calls,1);assert.equal(result.status,'cancelled');assert.match(result.code,/recoveredFunction/);
 assert.equal(runInNewContext(result.code+'answer'),3);
});

test('first-pass repair cannot consume the second-pass call reservation',async()=>{
 const events=[];let calls=0;
 const provider={label:'reservation',async infer(r){calls++;return {names:calls===1?{}:Object.fromEntries(r.targets.map(s=>[s.id,'inputValue'])),inputTokens:1,outputTokens:1};}};
 const result=await recoverNames('function f(a){return a;}globalThis.answer=f(7);',{provider,passes:2,maxCalls:2,rpm:60000,onEvent:e=>events.push(e)});
 assert.equal(calls,2);assert.equal(result.status,'partial');
 assert.match(events.find(e=>e.type==='response').retrySkipped,/maxCalls/);
 assert.deepEqual(events.filter(e=>e.type==='request').map(e=>e.pass),[1,2]);
 assert.equal(runInNewContext(result.code+'answer'),7);
});

test('duplicate parameter spellings retain distinct IDs through both passes',async()=>{
 const source='function f(a){return a+1;}function g(a){return a*2;}globalThis.answer=f(2)+g(3);';
 const requests=[];
 const provider={label:'binding identity',async infer(r){requests.push(r);return {names:Object.fromEntries(r.targets.map(s=>[s.id,s.namingRole?'fn'+s.id:'value'])),inputTokens:1,outputTokens:1};}};
 const result=await recoverNames(source,{provider,passes:2,rpm:60000});
 const parameters=requests.flatMap(r=>r.targets).filter(s=>s.kind==='param');
 assert.equal(new Set(parameters.map(s=>s.id)).size,2);
 assert.ok(parameters.every(s=>result.accepted[s.id]==='value'));
 assert.equal(runInNewContext(result.code+'answer'),9);
});

test('concurrent format failures never spend initial-request reservations on retries',async()=>{
 let calls=0;const events=[];
 const provider={label:'invalid',async infer(){calls++;return {names:{},inputTokens:null,outputTokens:null};}};
 const result=await recoverNames('const a=1; const b=2; console.log(a,b);',{provider,maxTargets:1,maxCalls:3,concurrency:2,rpm:60000,onEvent:e=>events.push(e)});
 assert.ok(calls<=3);assert.equal(result.inputTokens,null);
 const requests=events.filter(e=>e.type==='request');
 assert.equal(new Set(requests.map(e=>e.index)).size,requests.length);
 assert.equal(requests.filter(e=>e.attempt===1).length,2);
});


test('CLI reports progress and makes live HTML opt-in without losing output', async () => {
 const {execFile}=await import('node:child_process');
 const {promisify}=await import('node:util');
 const {writeFile,readdir}=await import('node:fs/promises');
 const {pathToFileURL}=await import('node:url');
 const root=await mkdtemp(join(tmpdir(),'flowname-cli-'));
 const input=join(root,'input.js');await writeFile(input,'const a=1; console.log(a);');
 for(const report of [false,true]) {
  const directory=join(root,report?'with report':'plain');
  const args=['dist/product-cli.js',input,'--out',directory,'--provider','mock','--rpm','6000',...(report?['--report','--prompt-format','verbose']:[])];
  const {stdout,stderr}=await promisify(execFile)(process.execPath,args);
  assert.match(stderr,/Progress: 1\/1 responses/);
  assert.match(stderr,/in flight.*response errors.*retries.*tokens in\/out/);
  const result=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
  assert.equal(result.status,'completed');
  assert.equal(await readFile(join(directory,'output.js'),'utf8'),result.code);
  const files=await readdir(directory);
  if(report) {
   assert.ok(stdout.includes(pathToFileURL(join(directory,'index.html')).href));
   assert.ok(files.includes('events.jsonl'));
   const events=(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
   assert.ok(events.some(e=>e.type==='request'));assert.ok(events.some(e=>e.type==='response'));
   assert.ok(events.filter(e=>e.type==='request').every(e=>e.request.promptFormat==='verbose'&&e.prompt.includes('defUses')));
   assert.match(await readFile(join(directory,'index.html'),'utf8'),/completed/);
  } else {
   assert.deepEqual(files.sort(),['output.js','result.json']);assert.ok(!stdout.includes('Live report'));
  }
  await assert.rejects(promisify(execFile)(process.execPath,args),/EEXIST/);
 }
});


test('exported declarations stay public while implementation locals are recovered in both modes',async()=>{
 for(const passes of [1,2]){
  const source='export function sum(a){const b=a+1;return b;} export const double=(c)=>{const d=c*2;return d;}; export class Counter{constructor(e){this.value=e;}get(){const f=this.value;return f;}}';
  const targets=[];
  const provider={label:'exports',async infer(request){targets.push(...request.targets.map(t=>t.name));return {names:Object.fromEntries(request.targets.map(t=>[t.id,'value_'+t.id])),inputTokens:1,outputTokens:1};}};
  const result=await recoverNames(source,{provider,passes,rpm:60000});
  assert.equal(result.status,'completed');
  for(const name of ['sum','double','Counter'])assert.ok(!targets.includes(name));
  for(const name of ['a','b','c','d','e','f'])assert.ok(targets.includes(name),name);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.code));
  assert.equal(module.sum(2),3);assert.equal(module.double(3),6);assert.equal(new module.Counter(4).get(),4);
 }
 const source='const a=2;export {a as value};export default function f(b){return b+a;}';
 const result=await recoverNames(source,{provider:{label:'exports',async infer(r){assert.ok(r.targets.every(t=>!['a','f'].includes(t.name)));return {names:Object.fromEntries(r.targets.map(t=>[t.id,'parameter'])),inputTokens:1,outputTokens:1};}},rpm:60000});
 const module=await import('data:text/javascript,'+encodeURIComponent(result.code));
 assert.equal(module.value,2);assert.equal(module.default(3),5);
});

test('compact prompt preserves IDs, disambiguating offsets, source and relation facts',async()=>{
 const {lightweight}=await import('../dist/lightweight.js');const {budgetedRequests}=await import('../dist/request-budget.js');
 const source='const a=response.user;const b=a.permissions;function f(a){return a.length;}';
 const analysis=lightweight(source),ids=analysis.symbols.filter(s=>s.eligible).map(s=>s.id);
 const request=budgetedRequests(source,analysis,ids,100000,64)[0];
 const compact=promptFor(request),verbose=promptFor({...request,promptFormat:'verbose'});
 const body=JSON.parse(compact.split('\n').find(l=>l.startsWith('{')));
 assert.deepEqual(body.targets,request.targets.map(s=>({id:s.id,name:s.name,at:s.declaration.start})));
 assert.equal(body.context,request.context);assert.equal(body.defUses,undefined);assert.equal(body.definitions,undefined);
 assert.deepEqual(body.relations,request.relations.map(({from,to,kind,property})=>({from,to,kind,...(property!==undefined?{property}:{})})));
 assert.ok(Buffer.byteLength(compact)<Buffer.byteLength(verbose));
 const full=JSON.parse(verbose.split('\n').find(l=>l.startsWith('{')));
 assert.deepEqual(full,{targets:request.targets,context:request.context,relations:request.relations,defUses:request.defUses,definitions:request.definitions});
 assert.equal(request.targets.filter(s=>s.name==='a').length,2);
 assert.equal(new Set(body.targets.filter(s=>s.name==='a').map(s=>s.at)).size,2);
});

test('selected prompt format controls grouping byte budgets, never target coverage',async()=>{
 const {lightweight}=await import('../dist/lightweight.js');const {budgetedRequests}=await import('../dist/request-budget.js');
 const source=Array.from({length:12},(_,i)=>`const variable${i}=${i};`).join('\n');
 const a=lightweight(source),ids=a.symbols.map(s=>s.id);
 const full=budgetedRequests(source,a,ids,100000,16,'compact')[0];const budget=Math.max(1024,Buffer.byteLength(promptFor(full)));
 const compact=budgetedRequests(source,a,ids,budget,16,'compact'),verbose=budgetedRequests(source,a,ids,budget,16,'verbose');
 assert.equal(compact.length,1);assert.ok(verbose.length>compact.length);
 for(const requests of [compact,verbose]){
  assert.deepEqual(requests.flatMap(r=>r.targets.map(t=>t.id)).sort(),[...ids].sort());
  for(const r of requests){assert.equal(r.budgeting.promptBytes,Buffer.byteLength(promptFor(r)));assert.ok(r.budgeting.promptBytes<=budget);}
 }
});

test('both formats log the exact provider prompt and preserve IDs through partial repair',async()=>{
 const old=globalThis.fetch;
 try{for(const promptFormat of ['compact','verbose']){
  const events=[],bodies=[];
  globalThis.fetch=async(_url,init)=>{
   const b=JSON.parse(init.body);bodies.push(b);
   const payload=JSON.parse(b.messages[0].content.split('\n').find(l=>l.startsWith('{')));
   const targets=bodies.length===1?payload.targets.slice(0,1):payload.targets;
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({names:Object.fromEntries(targets.map(t=>[t.id,'recovered']))})}}],usage:{prompt_tokens:10,completion_tokens:3}}));
  };
  const result=await recoverNames('const a=1,b=a+1;globalThis.answer=b;',{provider:new CompatibleProvider({baseUrl:'https://fixture.invalid',apiKey:'fixture',model:'m'}),promptFormat,maxCalls:2,rpm:60000,onEvent:e=>events.push(e)});
  assert.equal(result.status,'completed');assert.equal(bodies.length,2);
  const requests=events.filter(e=>e.type==='request');
  for(let i=0;i<2;i++){assert.equal(requests[i].request.promptFormat,promptFormat);assert.equal(requests[i].prompt,bodies[i].messages[0].content);assert.equal(Buffer.byteLength(requests[i].prompt),requests[i].request.budgeting.promptBytes);}
  assert.equal(requests[1].request.targets[0].id,requests[0].request.targets[1].id);
  assert.equal(requests[1].request.targets.length,1);assert.match(requests[1].prompt,/Correction:/);
 }}finally{globalThis.fetch=old;}
});

test('invalid prompt format fails before any model access',async()=>{
 let calls=0;const provider={label:'never',async infer(){calls++;throw Error('Unexpected call');}};
 await assert.rejects(recoverNames('let a=1;',{provider,promptFormat:'short'}),/promptFormat/);assert.equal(calls,0);
});

test('token estimates precede inference and repair usage remains actual',async()=>{
 const events=[];let count=0;
 const result=await recoverNames('const a=1; const b=a+1; console.log(b);',{rpm:60000,provider:{label:'fixture',async infer(r){
  count++;const event=events.at(-1);assert.equal(event.type,'request');assert.equal(event.estimate.inputTokens,Math.ceil(Buffer.byteLength(event.prompt)/4));
  assert.equal(event.estimate.outputTokenLimit,128+64*r.targets.length);assert.ok(events[0].estimate.inputTokens>0);
  return {names:Object.fromEntries((count===1?r.targets.slice(0,1):r.targets).map(t=>[t.id,t.name])),inputTokens:10,outputTokens:3};
 }},onEvent:e=>events.push(e)});
 assert.equal(count,2);assert.equal(result.inputTokens,20);assert.equal(result.outputTokens,6);
 assert.equal(events.filter(e=>e.type==='request')[1].attempt,2);
 assert.match(events[0].estimate.method,/excludes API framing/);
});

test('HTML file locks are bounded and cannot discard provider results',async t=>{
 const fs=(await import('node:fs/promises')).default;
 const directory=join(await mkdtemp(join(tmpdir(),'flowname-lock-')),'report');
 const reporter=await createHtmlReporter(directory),original=fs.rename;
 let attempts=0;
 t.mock.method(fs,'rename',async(...args)=>{attempts++;if(attempts<=4)throw Object.assign(new Error('locked'),{code:'EPERM'});return original(...args);});
 let calls=0;
 const result=await recoverNames('const a=1; console.log(a);',{rpm:60000,provider:{label:'fixture',async infer(r){calls++;return {names:Object.fromEntries(r.targets.map(t=>[t.id,'value'])),inputTokens:null,outputTokens:null};}},onEvent:reporter.onEvent});
 assert.equal(calls,1);assert.equal(result.status,'completed');assert.equal(reporter.warnings.length,1);
 assert.match(await readFile(join(directory,'events.jsonl'),'utf8'),/report-warning/);
 assert.equal(JSON.parse(await readFile(join(directory,'result.json'),'utf8')).status,'completed');
 const html=await readFile(reporter.path,'utf8');assert.match(html,/Estimated input tokens/);assert.match(html,/1 responses unknown/);assert.match(html,/Actual input \/ output: Unknown \/ Unknown/);
});

test('HTML rename retries recover transient locks but surface unrelated errors',async t=>{
 const fs=(await import('node:fs/promises')).default,original=fs.rename;
 let attempts=0;
 t.mock.method(fs,'rename',async(...args)=>{if(++attempts<3)throw Object.assign(new Error('busy'),{code:'EBUSY'});return original(...args);});
 const root=await mkdtemp(join(tmpdir(),'flowname-retry-'));
 const reporter=await createHtmlReporter(join(root,'ok'));assert.equal(attempts,3);assert.equal(reporter.warnings.length,0);
 t.mock.method(fs,'rename',async()=>{throw Object.assign(new Error('disk failure'),{code:'EIO'});});
 await assert.rejects(createHtmlReporter(join(root,'bad')),/disk failure/);
});

test('permanent HTML replacement lock still saves final output and full event journal',async t=>{
 const fs=(await import('node:fs/promises')).default;
 const directory=join(await mkdtemp(join(tmpdir(),'flowname-permanent-lock-')),'report');
 const reporter=await createHtmlReporter(directory);
 t.mock.method(fs,'rename',async()=>{throw Object.assign(new Error('locked'),{code:'EACCES'});});
 const result=await recoverNames('let a=1; console.log(a);',{provider:{label:'fixture',async infer(r){return {names:Object.fromEntries(r.targets.map(t=>[t.id,'value'])),inputTokens:4,outputTokens:2};}},onEvent:reporter.onEvent});
 assert.equal(result.status,'completed');
 const journal=(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(journal.at(-1).type,'complete');assert.equal(journal.filter(e=>e.type==='report-warning').length,1);
 assert.equal(JSON.parse(await readFile(join(directory,'result.json'),'utf8')).inputTokens,4);
 assert.match(await readFile(join(directory,'output.js'),'utf8'),/value/);
});
