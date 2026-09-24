import {build} from 'esbuild';
import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const outdir = resolve('pages-dist');
await mkdir(outdir, {recursive: true});
await build({
  entryPoints: ['web/app.js', 'web/browser-worker.js'], outdir,
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true,
  inject: ['web/browser-globals.js'],
  define: {'process.env.NODE_ENV': '"production"'},
  alias: {'node:crypto': resolve('web/browser-crypto.js')},
  plugins: [{name: 'browser-transport', setup(builder) {
    builder.onResolve({filter: /^\.\/transport\.js$/}, () => ({path: resolve('web/browser-transport.js')}));
  }}],
});
let html = await readFile('web/index.html', 'utf8');
html = html.replace('<meta name="viewport"', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; worker-src \'self\'; connect-src https://generativelanguage.googleapis.com https://api.openai.com https://api.groq.com; object-src \'none\'; base-uri \'none\'"><meta name="referrer" content="no-referrer"><meta name="viewport"');
html = html.replace('Your code and key pass through this server to the selected API provider. The application does not store them in files or a database.', 'Analysis runs in your browser. Your key and request context go directly to the selected API provider, not to a FlowName server. Your key is kept only for this run; no browser storage or analytics are used. Provider CORS restrictions may prevent a connection.');
await writeFile(`${outdir}/index.html`, html);
await copyFile('web/style.css', `${outdir}/style.css`);
await writeFile(`${outdir}/.nojekyll`, '');
console.log('Built static playground in pages-dist. No API keys are required at build time.');
