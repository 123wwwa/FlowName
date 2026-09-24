import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Serve the same browser build deployed to GitHub Pages. No recovery API runs here.
export function createPlayground({assetDirectory = new URL('../pages-dist/', import.meta.url)} = {}) {
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript']],
    ['/browser-worker.js', ['browser-worker.js', 'text/javascript']],
    ['/style.css', ['style.css', 'text/css']],
  ]);
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src https://generativelanguage.googleapis.com https://api.openai.com https://api.groq.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const asset = assets.get(req.url?.split('?')[0]);
    if (!['GET', 'HEAD'].includes(req.method) || !asset) {
      res.writeHead(404); res.end('Not found'); return;
    }
    try {
      const content = await readFile(resolve(fileURLToPath(assetDirectory), asset[0]));
      res.setHeader('Content-Type', asset[1]);
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      res.writeHead(503); res.end('Browser build unavailable. Run npm run build:pages first.');
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPlayground();
  server.requestTimeout = 20000; server.headersTimeout = 15000;
  server.listen(Number(process.env.PORT ?? 4173), process.env.HOST ?? '127.0.0.1', () => {
    console.log('FlowName playground: http://' + (process.env.HOST ?? '127.0.0.1') + ':' + server.address().port);
  });
}
