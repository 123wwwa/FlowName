import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createHash as nodeHash} from 'node:crypto';
import {createHash} from '../web/browser-crypto.js';
import {runRecovery} from '../web/browser-transport.js';

test('browser hash adapter matches Node for Unicode source', () => {
  const source = 'const 이름 = "😀";';
  assert.equal(createHash('sha256').update(source).digest('hex'), nodeHash('sha256').update(source).digest('hex'));
});

async function runWorker(source, mode = 'success') {
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
      const names = Object.fromEntries(pending.targets.map((target, i) => [target.id, `meaningful${i}`]));
      return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({names})}}], usage: {prompt_tokens: 30, completion_tokens: 10}}));
    },
  });
  await self.onmessage({data: {source, apiKey: 'fixture-secret', model: 'fixture', provider: 'gemini'}});
  assert.equal(closed, true);
  assert.ok(!JSON.stringify(events).includes('fixture-secret'));
  return {events, calls};
}

test('static worker analyzes, calls mocked API, streams and renames without Node', async () => {
  const {events, calls} = await runWorker('const a = 1; console.log(a);');
  assert.equal(calls, 1);
  assert.deepEqual(events.map(e => e.type), ['plan', 'request', 'response', 'complete']);
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
