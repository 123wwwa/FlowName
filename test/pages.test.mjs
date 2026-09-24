import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createHash as nodeHash} from 'node:crypto';
import {createHash} from '../web/browser-crypto.js';
import {runRecovery} from '../web/browser-transport.js';
import {validateOptions} from '../web/options.js';

test('browser hash adapter matches Node for Unicode source', () => {
  const source = 'const 이름 = "😀";';
  assert.equal(createHash('sha256').update(source).digest('hex'), nodeHash('sha256').update(source).digest('hex'));
});

async function runWorker(source, mode = 'success', options) {
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
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      const targets=mode==='partial'&&calls===1?pending.targets.slice(0,1):pending.targets;
      const names = Object.fromEntries(targets.map((target, i) => [target.id, `meaningful${i}`]));
      return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({names})}}], usage: {prompt_tokens: 30, completion_tokens: 10}}));
    },
  });
  await self.onmessage({data: {source, apiKey: 'fixture-secret', model: 'fixture', provider: 'gemini', options}});
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

test('browser worker rejects oversized input before networking and preserves failed runs', async () => {
  const invalid = await runWorker('x'.repeat(524289));
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
  assert.deepEqual(validateOptions(), {passes:1,concurrency:16,rpm:60,maxCalls:1000,promptBytes:12000,maxTargets:16});
  for (const options of [{passes:3},{passes:0},{passes:1.5},{passes:"2"},{concurrency:33},{rpm:0},{maxCalls:1.5},{promptBytes:1023},{maxTargets:65},{concurrency:'16'},null]) {
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
