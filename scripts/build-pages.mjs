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
});
let html = await readFile('web/index.html', 'utf8');
html = html.replace('<meta name="viewport"', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; worker-src \'self\'; connect-src https://generativelanguage.googleapis.com https://api.openai.com https://api.groq.com; object-src \'none\'; base-uri \'none\'"><meta name="referrer" content="no-referrer"><meta name="viewport"');
await writeFile(`${outdir}/index.html`, html);
await copyFile('web/style.css', `${outdir}/style.css`);
await writeFile(`${outdir}/.nojekyll`, '');
console.log('Built static playground in pages-dist. No API keys are required at build time.');
