import test from 'node:test';
import assert from 'node:assert/strict';
import {lightweight,researchRequests} from '../dist/lightweight.js';
import {budgetedRequests} from '../dist/request-budget.js';
import {promptFor,contextCovers} from '../dist/grouping.js';
import {CompatibleProvider} from '../dist/inference.js';
test('large scope budgets preserve every target and declaration exactly once',()=>{
 const code=Array.from({length:1200},(_,i)=>`let variable${i}=${i};`).join('\n');
 const a=lightweight(code),ids=a.symbols.map(s=>s.id);
 const requests=budgetedRequests(code,a,ids,4000,16);
 assert.deepEqual(requests.flatMap(r=>r.targets.map(s=>s.id)).sort(),[...ids].sort());
 for(const r of requests){assert.ok(Buffer.byteLength(promptFor(r))<=4000);for(const s of r.targets)assert.ok(contextCovers(r.context,s.declaration));}
 assert.throws(()=>budgetedRequests(code,a,[ids[0],ids[0]]),/Duplicate/);
 assert.throws(()=>lightweight(' '.repeat(8*1024*1024+1)),/limit/);
});
test('external responses bounded, redirects forbidden, quota hints preserved, no retries',async()=>{
 const code='let x=1;',a=lightweight(code),request=researchRequests(code,a,a.symbols.map(s=>s.id),'local-500')[0];
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
