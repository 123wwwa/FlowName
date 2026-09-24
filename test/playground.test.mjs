import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPlayground} from '../web/server.mjs';

test('local preview serves only browser assets and has no recovery endpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowname-preview-'));
  const assets = {'index.html':'<html>browser preview</html>', 'app.js':'// app', 'browser-worker.js':'// worker', 'style.css':'body {}'};
  for (const [file, content] of Object.entries(assets)) await writeFile(join(directory, file), content);
  await writeFile(join(directory, '.env'), 'private');
  const server = createPlayground({assetDirectory:pathToFileURL(directory)});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const [file, content] of Object.entries(assets)) {
      const response = await fetch(base + '/' + file + '?v=1');
      assert.equal(response.status, 200); assert.equal(await response.text(), content);
    }
    const page = await fetch(base);
    assert.equal(await page.text(), assets['index.html']);
    assert.match(page.headers.get('content-security-policy'), /connect-src https:\/\/generativelanguage.googleapis.com/);
    assert.match(page.headers.get('content-security-policy'), /worker-src 'self'/);
    const head = await fetch(base + '/browser-worker.js', {method:'HEAD'});
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    for (const url of ['/.env', '/%2e%2e/package.json', '/server.mjs', '/api/recover']) assert.equal((await fetch(base + url)).status, 404);
    assert.equal((await fetch(base + '/api/recover', {method:'POST', body:'{}'})).status, 404);
    assert.equal((await fetch(base + '/', {method:'POST'})).status, 404);
    await rm(join(directory, 'app.js'));
    assert.equal((await fetch(base + '/app.js')).status, 503);
  } finally {
    server.closeAllConnections(); await new Promise(r => server.close(r));
    await rm(directory, {recursive:true, force:true});
  }
});
