import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recoverNames} from '../dist/library.js';
import {lightweight} from '../dist/lightweight.js';
import {rename} from '../dist/rename.js';
import {CompatibleProvider} from '../dist/inference.js';
import {createHtmlReporter} from '../dist/html-reporter.js';

const provider=(choose=t=>'value_'+t.id)=>({label:'edge-fixture',async infer(r){return {names:Object.fromEntries(r.targets.map(t=>[t.id,choose(t)])),inputTokens:3,outputTokens:2};}});
function outcome(code){const ctx={};try{runInNewContext(code,ctx,{timeout:1000});return JSON.stringify({answer:ctx.answer});}catch(e){return JSON.stringify({error:e.name});}}
const cases={
 'nested patterns and defaults':'function f({a:x=2,b:{c:y=3}={},...z}={}){return [x,y,z]}globalThis.answer=f({a:4,extra:9});',
 'rest and assignment patterns':'let a,b,c;[a,,...b]=[1,2,3,4];({v:c=8}={});globalThis.answer=[a,b,c];',
 'catch shadowing':'let a=7;function f(){try{throw 3}catch(a){return ()=>a+1}}globalThis.answer=[f()(),a];',
 'loop closures':'const a=[];for(let b=0;b<3;b++)a.push(()=>b);globalThis.answer=a.map(c=>c());',
 'named recursive expression':'const a=function b(c){return c?c*b(c-1):1};globalThis.answer=a(5);',
 'function parameter same as declaration':'function a(a){return a+1}globalThis.answer=a(2);',
 'class private fields and inheritance':'class a{#x=3;get(){return this.#x}}class b extends a{get(){return super.get()+1}}globalThis.answer=new b().get();',
 'nested defaults and outer reference':'let a=4;function f(b=a,c=()=>b){let d=2;return c()+d}globalThis.answer=f();',
 'generator bindings':'function* a(b){for(let c of b)yield c+1}globalThis.answer=[...a([1,2])];',
 'strict unresolved assignment stays ReferenceError':'"use strict";function f(){let a=1;missing=2;return a}globalThis.answer=f();',
};
for(const [name,source] of Object.entries(cases))test('behavior: '+name,async()=>{
 const result=await recoverNames(source,{provider:provider(()=>name.startsWith('strict')?'missing':'value'),rpm:60000});
 assert.equal(result.status,'completed');assert.equal(outcome(result.code),outcome(source));
});

test('simultaneous cyclic renames preserve binding identity',()=>{
 const code='let a=1,b=2,c=3;globalThis.answer=[a,b,c];';const a=lightweight(code),names={a:'b',b:'c',c:'a'};
 const result=rename(code,a,Object.fromEntries(a.symbols.map(t=>[t.id,names[t.name]])));
 assert.equal(outcome(result.code),outcome(code));assert.equal(Object.keys(result.adjustments).length,0);
});

test('re-export names do not protect unrelated local bindings',()=>{
 const a=lightweight('const value=1;export {value} from "external-module";console.log(value);');
 assert.equal(a.symbols.find(t=>t.name==='value').eligible,true);
});

test('default export expression and imported aliases preserve module interface',async()=>{
 const src='import {value as a} from "data:text/javascript,export const value=3";const b=(c)=>c+a;export default b;export {b as calculate};';
 const result=await recoverNames(src,{provider:provider(),rpm:60000});
 const m=await import('data:text/javascript,'+encodeURIComponent(result.code));assert.equal(m.default(4),7);assert.equal(m.calculate(2),5);
});

test('JSX member properties and intrinsic tags are not renamed as bindings',()=>{
 const code='const A={Item:()=>null};const Item=2;const b=<><A.Item/><item data-value={Item}/></>;';const a=lightweight(code);
 const r=rename(code,a,Object.fromEntries(a.symbols.map(t=>[t.id,'renamed'+t.name])));
 assert.match(r.code,/<renamedA.Item/);assert.match(r.code,/<item data-value=\{renamedItem\}/);
});

for(const value of ['await','yield','arguments','eval','class','not-valid','x'.repeat(257),7,null,{},['a']])test('invalid response value: '+String(value).slice(0,25),async()=>{
 let count=0;const p={label:'bad',async infer(r){count++;return {names:Object.fromEntries(r.targets.map(t=>[t.id,value])),inputTokens:1,outputTokens:1};}};
 const r=await recoverNames('const a=1;globalThis.answer=a;',{provider:p,rpm:60000,maxCalls:2});assert.equal(count,2);assert.equal(r.status,'partial');assert.equal(Object.keys(r.accepted).length,0);assert.equal(outcome(r.code),JSON.stringify({answer:1}));
});

test('duplicate IDs in raw JSON cannot silently select the last proposal',async()=>{
 const old=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{"names":{"s6":"first","s6":"second"}}'}}],usage:{prompt_tokens:1,completion_tokens:1}}));};
 const r=await recoverNames('const a=1;',{provider:new CompatibleProvider({baseUrl:'https://fixture.invalid',apiKey:'fixture',model:'fixture'}),maxCalls:2,rpm:60000});
 assert.equal(r.status,'partial');assert.equal(Object.keys(r.accepted).length,0);assert.equal(calls,2);
 }finally{globalThis.fetch=old;}
});

test('cancellation drains active responses without starting later requests',async()=>{
 const controller=new AbortController();let calls=0;const events=[];
 const p={label:'cancel',async infer(r){calls++;controller.abort();await new Promise(resolve=>setTimeout(resolve,5));return {names:{[r.targets[0].id]:'kept'},inputTokens:3,outputTokens:2};}};
 const r=await recoverNames('const a=1,b=2,c=3;',{provider:p,maxTargets:1,concurrency:1,rpm:60000,signal:controller.signal,onEvent:e=>events.push(e)});
 assert.equal(calls,1);assert.equal(r.status,'cancelled');assert.equal(Object.keys(r.accepted).length,1);assert.equal(r.inputTokens,3);assert.equal(events.at(-1).type,'complete');
});

test('observer failure stops scheduling and drains already-started providers',async()=>{
 let calls=0,finished=0;const p={label:'observer',async infer(r){calls++;await new Promise(resolve=>setTimeout(resolve,10));finished++;return {names:{[r.targets[0].id]:'value'},inputTokens:1,outputTokens:1};}};
 await assert.rejects(recoverNames('let a=1,b=2,c=3,d=4;',{provider:p,maxTargets:1,concurrency:2,rpm:60000,onEvent:e=>{if(e.type==='response')throw new Error('disk failed');}}),/disk failed/);
 assert.equal(finished,calls);assert.ok(calls<=2);
});

test('malformed custom-provider response preserves known usage in response events',async()=>{
 const events=[];const p={label:'bad-shape',async infer(){return {names:null,inputTokens:7,outputTokens:3};}};
 const r=await recoverNames('let a=1;',{provider:p,maxCalls:1,onEvent:e=>events.push(e)});
 assert.equal(r.inputTokens,7);assert.equal(r.outputTokens,3);
 const response=events.find(e=>e.type==='response');assert.equal(response.inputTokens,7);assert.equal(response.outputTokens,3);
});

test('timeout does not retry a transport failure and keeps usage unknown',async()=>{
 const old=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(_url,options)=>{calls++;assert.ok(options.signal);throw new DOMException('Request timed out','TimeoutError');};
 const result=await recoverNames('let a=1;',{provider:new CompatibleProvider({baseUrl:'https://fixture.invalid',apiKey:'fixture',model:'fixture',timeoutMs:5})});
 assert.equal(calls,1);assert.equal(result.status,'partial');assert.equal(result.inputTokens,null);
 }finally{globalThis.fetch=old;}
});

test('pre-aborted and invalid syntax inputs never call the provider',async()=>{
 let calls=0;const p={label:'never',async infer(){calls++;throw Error('Unexpected call');}};
 await assert.rejects(recoverNames('const a=1;',{provider:p,signal:AbortSignal.abort()}));
 await assert.rejects(recoverNames('const a: number = 1;',{provider:p}));assert.equal(calls,0);
});

test('report escapes hostile source and errors and preserves the event journal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flowname-edge-report-')),report=await createHtmlReporter(join(root,'report'));
 const payload='</pre><script>globalThis.injected=true</script>';
 const result=await recoverNames('const a='+JSON.stringify(payload)+';globalThis.answer=a;',{provider:{label:'error',async infer(){throw new Error(payload);}},onEvent:report.onEvent});
 assert.equal(result.status,'partial');const html=await readFile(report.path,'utf8');assert.ok(!html.includes(payload));assert.ok(html.includes('&lt;script&gt;'));
 const events=(await readFile(join(root,'report/events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(e=>e.type==='request').length,1);assert.equal(events.filter(e=>e.type==='response').length,1);assert.equal(events.at(-1).result.status,'partial');
});

test('out-of-order responses resolve duplicate suggestions deterministically',async()=>{
 const source='const a=1,b=2,c=3;globalThis.answer=[a,b,c];';
 const outputs=[];
 for(const reverse of [false,true]){
  const p={label:'completion-order',async infer(r){const index=['a','b','c'].indexOf(r.targets[0].name);await new Promise(resolve=>setTimeout(resolve,(reverse?index:2-index)*8));return {names:{[r.targets[0].id]:'value'},inputTokens:1,outputTokens:1};}};
  const result=await recoverNames(source,{provider:p,maxTargets:1,concurrency:3,rpm:600000});
  assert.equal(result.status,'completed');assert.equal(outcome(result.code),outcome(source));outputs.push(result.code);
 }
 assert.equal(outputs[0],outputs[1]);
});

test('concurrent incomplete responses never exceed the shared repair budget',async()=>{
 let calls=0;const events=[];
 const p={label:'budget',async infer(r){calls++;await new Promise(resolve=>setTimeout(resolve,5));return {names:r.formatRepair?{[r.targets[0].id]:'repaired'}:{},inputTokens:1,outputTokens:1};}};
 const result=await recoverNames('let a=1,b=2;globalThis.answer=a+b;',{provider:p,maxTargets:1,concurrency:2,rpm:600000,maxCalls:3,onEvent:e=>events.push(e)});
 assert.equal(calls,3);assert.equal(result.calls,3);assert.equal(result.inputTokens,3);assert.equal(result.status,'partial');
 assert.equal(events.filter(e=>e.type==='request'&&e.attempt===2).length,1);assert.equal(outcome(result.code),JSON.stringify({answer:3}));
});

test('adversarial identifier strings cannot pollute maps or break source syntax',async()=>{
 for(const name of ['__proto__','constructor','toString','π','value999999999999999999999999999999']){
  const source='let a=2,b=3;globalThis.answer=a+b;';
  const result=await recoverNames(source,{provider:provider(()=>name),rpm:60000});
  assert.equal(result.status,'completed');assert.equal(outcome(result.code),outcome(source));
  assert.equal(Object.prototype.polluted,undefined);
 }
});

test('duplicate-key validation handles escaped keys, nested objects and bounded repair',async()=>{
 const old=globalThis.fetch;
 try{
  for(const ambiguous of [String.raw`{"names":{"s6":"first","\u00736":"second"}}`,'{"names":{"s6":"first"},"names":{"s6":"second"}}','{"names":{"s6":"value"},"extra":{"nested":{"x":1,"x":2}}}']){
   let calls=0;const events=[];
   globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:calls===1?ambiguous:'{"names":{"s6":"repaired"}}'}}],usage:{prompt_tokens:7,completion_tokens:3}}));};
   const r=await recoverNames('const a=1;',{provider:new CompatibleProvider({baseUrl:'https://fixture.invalid',apiKey:'fixture',model:'fixture'}),rpm:60000,maxCalls:2,onEvent:e=>events.push(e)});
   assert.equal(calls,2);assert.equal(r.status,'completed');assert.equal(r.accepted.s6,'repaired');assert.equal(r.inputTokens,14);assert.equal(r.outputTokens,6);
   assert.match(events.find(e=>e.type==='response').error,/Duplicate JSON/);
  }
 }finally{globalThis.fetch=old;}
});

test('key-shaped string contents and identical keys in separate objects are accepted',async()=>{
 const old=globalThis.fetch;let calls=0;
 try{
  const content=JSON.stringify({names:{s6:'value'},note:'"x":1,"x":2 } ] \\ "',extra:[{x:1},{x:2}],nested:{names:{s6:'other'}}});
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:2,completion_tokens:1}}));};
  const r=await recoverNames('const a=1;',{provider:new CompatibleProvider({baseUrl:'https://fixture.invalid',apiKey:'fixture',model:'fixture'}),rpm:60000});
  assert.equal(calls,1);assert.equal(r.status,'completed');assert.equal(r.accepted.s6,'value');
 }finally{globalThis.fetch=old;}
});

test('custom-provider malformed response and repair count known usage exactly once',async()=>{
 let calls=0;const events=[];
 const p={label:'repair-usage',async infer(r){calls++;return {names:calls===1?null:{[r.targets[0].id]:'fixed'},inputTokens:7,outputTokens:3};}};
 const r=await recoverNames('const a=1;',{provider:p,maxCalls:2,rpm:60000,onEvent:e=>events.push(e)});
 const responses=events.filter(e=>e.type==='response');
 assert.equal(r.status,'completed');assert.equal(calls,2);assert.equal(r.inputTokens,14);assert.equal(r.outputTokens,6);
 assert.equal(responses.reduce((n,e)=>n+e.inputTokens,0),r.inputTokens);assert.equal(responses.reduce((n,e)=>n+e.outputTokens,0),r.outputTokens);
});
