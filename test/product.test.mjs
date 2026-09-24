import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {recoverNames} from '../dist/library.js';
import {createHtmlReporter} from '../dist/html-reporter.js';
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
