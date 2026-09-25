import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createHash as nodeHash} from 'node:crypto';
import {createHash} from '../web/browser-crypto.js';
import {runRecovery} from '../web/browser-transport.js';
import {validateOptions, validateInput, MAX_SOURCE_BYTES} from '../web/options.js';

test('browser hash adapter matches Node for Unicode source', () => {
  const source = 'const 이름 = "😀";';
  assert.equal(createHash('sha256').update(source).digest('hex'), nodeHash('sha256').update(source).digest('hex'));
});

async function runWorker(source, mode = 'success', options, overrides = {}) {
  const events = []; let pending, calls = 0, closed = false;
  const self = {
    postMessage(event) { events.push(event); if (event.type === 'request') pending = event.request; },
    close() { closed = true; },
  };
  // Deliberately no Node globals: this executes the actual shipped browser bundle.
  runInNewContext(await readFile('pages-dist/browser-worker.js', 'utf8'), {
    self, TextEncoder, TextDecoder, AbortSignal, URL, console, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
      assert.equal(JSON.parse(options.body).messages[0].content,events.findLast(e=>e.type==='request').prompt);
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      const targets=mode==='partial'&&calls===1?pending.targets.slice(0,1):pending.targets;
      const names = Object.fromEntries(targets.map((target, i) => [target.id, `meaningful${i}`]));
      return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({names})}}], usage: {prompt_tokens: 30, completion_tokens: 10}}));
    },
  });
  await self.onmessage({data: {source, apiKey: 'fixture-secret', model: 'fixture', provider: 'gemini', options, ...overrides}});
  assert.equal(closed, true);
  assert.ok(!JSON.stringify(events).includes('fixture-secret'));
  return {events, calls};
}

test('static worker analyzes, calls mocked API, streams and renames without Node', async () => {
  const {events, calls} = await runWorker('const a = 1; console.log(a);');
  assert.equal(calls, 1);
  assert.deepEqual(events.map(e => e.type), ['plan', 'request', 'response', 'pass-complete', 'complete']);
  assert.equal(events.at(-1).result.status, 'completed');
  assert.match(events.at(-1).result.code, /const meaningful0 = 1/);
  assert.equal(events.at(-1).result.inputTokens, 30);
});

test('browser linked propagation sends prior hints in the actual prompt',async()=>{
 const {events,calls}=await runWorker('let a=1;let b=a+2;console.log(b);','success',{requestPropagation:'linked',maxTargets:1,rpm:6000});
 assert.equal(calls,2);assert.equal(events.at(-1).result.status,'completed');
 const requests=events.filter(e=>e.type==='request');
 assert.equal(requests[1].request.previousNames[0].suggested,'meaningful0');
 assert.match(requests[1].prompt,/previousNames/);
 assert.ok(events.findIndex(e=>e.type==='response')<events.indexOf(requests[1]));
});

test('browser worker rejects oversized input before networking and preserves failed runs', async () => {
  const invalid = await runWorker('x'.repeat(MAX_SOURCE_BYTES + 1));
  assert.equal(invalid.calls, 0);
  assert.equal(invalid.events[0].type, 'fatal');
  const failed = await runWorker('const a = 1; console.log(a);', 'offline');
  assert.equal(failed.events.at(-1).result.status, 'partial');
  assert.equal(failed.events.at(-1).result.inputTokens, null);
});

test('Stop terminates the browser worker and clears the supplied key', async () => {
  const previous = globalThis.Worker; let terminated = false, sent;
  globalThis.Worker = class {
    postMessage(payload) { sent = structuredClone(payload); }
    terminate() { terminated = true; }
  };
  try {
    const payload = {apiKey: 'fixture-secret'};
    const controller = new AbortController();
    const run = runRecovery(payload, controller.signal, () => {});
    assert.equal(payload.apiKey, ''); assert.equal(sent.apiKey, 'fixture-secret');
    controller.abort();
    await assert.rejects(run, {name: 'AbortError'});
    assert.equal(terminated, true);
  } finally { globalThis.Worker = previous; }
});

test('Pages assets work below a repository URL and contain no server transport', async () => {
  const html = await readFile('pages-dist/index.html', 'utf8');
  assert.match(html, /src="\.\/app.js"/);
  assert.match(html, /href="\.\/style.css"/);
  assert.match(html, /Analysis runs in your browser/);
  const app = await readFile('pages-dist/app.js', 'utf8');
  assert.ok(!app.includes('api/recover'));
  assert.ok(app.includes('browser-worker.js'));
});

test('web options enforce integer bounds and default concurrency to 16', () => {
  assert.deepEqual(validateOptions(), {requestPropagation:'off',contextMode:'usage',promptFormat:'compact',passes:1,concurrency:16,rpm:60,maxCalls:1000,promptBytes:12000,maxTargets:16});
  for (const options of [{requestPropagation:'invalid'},{passes:3},{passes:0},{passes:1.5},{passes:"2"},{concurrency:33},{rpm:0},{maxCalls:1.5},{promptBytes:1023},{maxTargets:65},{concurrency:'16'},null]) {
    assert.throws(()=>validateOptions(options));
  }
});

test('browser worker applies target, prompt and call limits before API access', async () => {
  const source='const a=1; const b=a+1; console.log(a,b);';
  const grouped=await runWorker(source);
  assert.equal(grouped.calls,1);
  const split=await runWorker(source,'success',{maxTargets:1,rpm:6000,promptBytes:4096});
  assert.equal(split.calls,2);
  for(const event of split.events.filter(e=>e.type==='request')) {
    assert.equal(event.request.targets.length,1);
    assert.equal(event.request.budgeting.limitBytes,4096);
  }
  const capped=await runWorker(source,'success',{maxTargets:1,maxCalls:1});
  assert.equal(capped.calls,0);
  assert.match(capped.events[0].error,/exceeding maxCalls/);
  const invalid=await runWorker(source,'success',{concurrency:33});
  assert.equal(invalid.calls,0);
  assert.match(invalid.events[0].error,/concurrency/);
});

test('browser bundle accepts partial API answers and propagates first-pass applied names',async()=>{
  const single=await runWorker('function f(a){return a+1;} console.log(f(1));','success',{rpm:6000});
  assert.equal(single.calls,1);
  assert.ok(!single.events.some(e=>e.pass===2));
  const invalid=await runWorker('let a=1;','success',{passes:3});
  assert.equal(invalid.calls,0);
  assert.match(invalid.events[0].error,/passes/);
  const partial=await runWorker('const a=1,b=a+1; console.log(b);','partial',{rpm:6000});
  assert.equal(partial.calls,2);
  const requests=partial.events.filter(e=>e.type==='request');
  assert.equal(requests[0].request.targets.length,2);assert.equal(requests[1].request.targets.length,1);
  assert.equal(partial.events.at(-1).result.status,'completed');
  const phased=await runWorker('function f(a){return a+1;} console.log(f(1));','success',{rpm:6000,passes:2});
  const second=phased.events.find(e=>e.type==='request'&&e.pass===2);
  assert.match(second.request.context,/function meaningful0/);
  assert.equal(phased.events.at(-1).result.status,'completed');
});

test('input validation names each invalid field before any provider call',async()=>{
 const cases=[
  [{source:''},'source',/Source code is required/],
  [{apiKey:''},'key',/API key is required/],
  [{apiKey:'x'.repeat(4097)},'key',/API key is too long/],
  [{model:''},'model',/Model ID is required/],
  [{model:'x'.repeat(201)},'model',/Model ID is too long/],
  [{provider:'constructor'},'provider',/Unsupported API provider/],
  [{provider:{}},'provider',/Unsupported API provider/],
 ];
 for(const [overrides,field,pattern] of cases){
  assert.throws(()=>validateInput({source:'const a=1;',apiKey:'fixture-secret',model:'fixture',provider:'gemini',...overrides}),e=>e.field===field&&pattern.test(e.message));
  const result=await runWorker('const a=1;','success',undefined,overrides);
  assert.equal(result.calls,0);assert.match(result.events[0].error,pattern);
 }
});

test('source size uses UTF-8 bytes and reports exact actual and allowed sizes',()=>{
 const payload={apiKey:'fixture',model:'fixture',provider:'gemini'};
 assert.equal(validateInput({...payload,source:'x'.repeat(MAX_SOURCE_BYTES)}),MAX_SOURCE_BYTES);
 const source='가'.repeat(Math.floor(MAX_SOURCE_BYTES/3)+1);
 const bytes=new TextEncoder().encode(source).length;
 assert.ok(source.length<MAX_SOURCE_BYTES);
 assert.throws(()=>validateInput({...payload,source}),e=>e.field==='source'&&e.message.includes(bytes.toLocaleString('en-US'))&&e.message.includes('8,388,608'));
});

test('browser worker processes source at the 8 MiB boundary without truncation',async()=>{
 const prefix='const a="',suffix='";globalThis.answer=a.length;';
 const source=prefix+'x'.repeat(MAX_SOURCE_BYTES-prefix.length-suffix.length)+suffix;
 const {events,calls}=await runWorker(source);
 assert.equal(calls,1);
 const result=events.at(-1).result;
 assert.equal(result.status,'completed');
 assert.match(result.code,/globalThis.answer = meaningful0.length/);
 assert.ok(result.code.includes('x'.repeat(1024)));
 assert.ok(result.code.length>=source.length);
 const request=events.find(e=>e.type==='request').request;
 assert.ok(request.budgeting.promptBytes<=12000);
});

test('Stop interrupts an active large-source worker before a provider request', {timeout:15000}, async()=>{
 const {Worker:NodeWorker}=await import('node:worker_threads');
 const {once}=await import('node:events');
 const bundle=await readFile('pages-dist/browser-worker.js','utf8');
 const previous=globalThis.Worker;let thread,exit,networkCalls=0;
 const controller=new AbortController();
 // Exercise the built browser worker in a real thread with a Web Worker adapter.
 globalThis.Worker=class {
  constructor(){
   thread=new NodeWorker(`const {parentPort,workerData}=require('node:worker_threads');const {runInNewContext}=require('node:vm');
    const self={postMessage:data=>parentPort.postMessage(data),close(){}};
    runInNewContext(workerData,{self,TextEncoder,TextDecoder,AbortSignal,URL,console,setTimeout,clearTimeout,fetch:async()=>{parentPort.postMessage({type:'audit-network'});throw Error('Unexpected network');}});
    parentPort.once('message',data=>{parentPort.postMessage({type:'audit-start'});self.onmessage({data});});`,{eval:true,workerData:bundle});
   exit=once(thread,'exit');
   thread.on('message',data=>this.onmessage?.({data}));thread.on('error',()=>this.onerror?.());
  }
  postMessage(payload){thread.postMessage(payload);}
  terminate(){void thread.terminate();}
 };
 try{
  const payload={source:'const a="'+'x'.repeat(7*1024*1024)+'";',apiKey:'fixture-secret',provider:'gemini',model:'fixture'};
  await assert.rejects(runRecovery(payload,controller.signal,event=>{if(event.type==='audit-start')controller.abort();if(event.type==='audit-network')networkCalls++;}),{name:'AbortError'});
  await exit;assert.equal(networkCalls,0);assert.equal(payload.apiKey,'');
 }finally{globalThis.Worker=previous;await thread?.terminate();}
});

test('form validation keeps the key and prior results until input is valid',async()=>{
 const {optionSpecs}=await import('../web/options.js');const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',append(){},replaceChildren(){this.cleared=true;},focus(){this.focused=true;},hidden:false});return elements.get(id);};
 const document={getElementById:element,createElement:()=>({append(){}})};
 let dispatched=0;
 const app=(await readFile('web/app.js','utf8')).replace(/^import .*;\r?\n/gm,'');
 runInNewContext(app,{document,optionSpecs,validateOptions,validateInput,AbortController,runRecovery:async()=>{dispatched++;},setTimeout});
 // Populate the form-control registry as a browser does for the generated inputs.
 for(const [key,spec] of Object.entries(optionSpecs))element(key).value=String(spec.value);
 element('source').value='x'.repeat(MAX_SOURCE_BYTES+1);element('key').value='fixture-secret';element('provider').value='gemini';element('model').value='fixture';
 element('calls').cleared=false;element('output-section').hidden=false;
 await element('form').onsubmit({preventDefault(){}});
 assert.equal(dispatched,0);assert.equal(element('key').value,'fixture-secret');assert.equal(element('calls').cleared,false);assert.equal(element('output-section').hidden,false);assert.equal(element('source').focused,true);assert.match(element('error').textContent,/8,388,609/);
 element('source').value='const a=1;';
 await element('form').onsubmit({preventDefault(){}});
 assert.equal(dispatched,1);assert.equal(element('key').value,'');
});

test('browser prompt format defaults to compact and supports verbose in both passes',async()=>{
 assert.equal(validateOptions().promptFormat,'compact');
 assert.equal(validateOptions({promptFormat:'verbose'}).promptFormat,'verbose');
 assert.throws(()=>validateOptions({promptFormat:1}),/promptFormat/);
 for(const promptFormat of ['compact','verbose']){
  const {events}=await runWorker('function f(a){return a+1;} console.log(f(1));','success',{promptFormat,passes:2,rpm:6000});
  const requests=events.filter(e=>e.type==='request');assert.ok(requests.some(e=>e.pass===2));
  for(const event of requests){
   assert.equal(event.request.promptFormat,promptFormat);
   const payload=JSON.parse(event.prompt.split('\n').find(l=>l.startsWith('{')));
   assert.equal('defUses' in payload,promptFormat==='verbose');
   assert.equal('scope' in payload.targets[0],promptFormat==='verbose');
   if(promptFormat==='compact')assert.equal(payload.targets[0].at,event.request.targets[0].declaration.start);
  }
 }
 const invalid=await runWorker('let a=1;','success',{promptFormat:'bad'});assert.equal(invalid.calls,0);assert.match(invalid.events[0].error,/promptFormat/);
});

test('browser bundle reports actual repair usage without token estimates',async()=>{
 const {events,calls}=await runWorker('const a=1;const b=a+2;console.log(b);','partial',{rpm:6000});
 assert.equal(calls,2);
 assert.ok(events.every(e=>!('estimate' in e)));
 assert.equal(events.at(-1).result.inputTokens,60);assert.equal(events.at(-1).result.outputTokens,20);
});

test('browser exposes bounded uses and declaration baseline without changing groups',async()=>{
 assert.equal(validateOptions().contextMode,'usage');assert.throws(()=>validateOptions({contextMode:'bad'}),/contextMode/);
 const source='let a=0;'+ '/* gap */'.repeat(40)+'function f(e){'+'/* inner gap */'.repeat(30)+'switch(e.keyCode){case 32:if(!a)a=1;break;}}';
 const plans=[];for(const contextMode of ['declarations','usage']){const {events}=await runWorker(source,'success',{contextMode,rpm:6000});const requests=events.filter(e=>e.type==='request');plans.push(requests.map(e=>e.request.targets.map(t=>t.id)));if(contextMode==='usage')assert.ok(requests.some(e=>e.prompt.includes('switch discriminant')));}
 assert.equal(JSON.stringify(plans[0]),JSON.stringify(plans[1]));
});

test('browser protects shadowed intrinsic eval without sending a request',async()=>{
 const {events,calls}=await runWorker('function f(eval){let secret=42;return eval("secret");}f(globalThis.eval);');
 assert.equal(calls,0);assert.equal(events.at(-1).result.status,'completed');assert.match(events.at(-1).result.code,/secret/);assert.match(events.at(-1).result.warnings.join(' '),/eval/);
});
