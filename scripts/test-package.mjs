import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const run=promisify(execFile),root=process.cwd();
const npm=process.env.npm_execpath;
assert.ok(npm,'Run this check with npm run test:package.');
const tempRoot=await realpath(tmpdir());
const consumer=await mkdtemp(join(tempRoot,'flowname-package-'));
const command=(file,args,cwd=consumer)=>run(file,args,{cwd,maxBuffer:4*1024*1024});
const npmRun=(args,cwd)=>command(process.execPath,[npm,...args],cwd);
try {
  const {stdout}=await npmRun(['pack','--json','--pack-destination',consumer],root);
  const json=stdout.trim();
  const [pack]=JSON.parse(json.startsWith('[')?json:json.slice(json.lastIndexOf('\n[')+1));
  assert.ok(pack.files.some(file=>file.path==='LICENSE'),'MIT license must be included.');
  for(const file of pack.files){
    assert.ok(/^(package-dist\/[^/]+\.(js|d\.ts)|docs\/[^/]+\.md|README\.md|LICENSE(?:\.md)?|package\.json)$/.test(file.path),`Unexpected package file: ${file.path}`);
  }
  const typescript=JSON.parse(await readFile(join(root,'node_modules/typescript/package.json'),'utf8')).version;
  await writeFile(join(consumer,'package.json'),JSON.stringify({name:'flowname-package-check',private:true,type:'module'}));
  await npmRun(['install','--ignore-scripts','--no-audit','--no-fund',join(consumer,pack.filename),`typescript@${typescript}`]);
  assert.equal(JSON.parse(await readFile(join(consumer,'node_modules/flowname/package.json'),'utf8')).license,'MIT');
  assert.match(await readFile(join(consumer,'node_modules/flowname/LICENSE'),'utf8'),/MIT License/);
  await writeFile(join(consumer,'consumer.ts'),`import {recoverNames,createProvider,type Provider,type RecoveryOptions} from 'flowname';
import {createHtmlReporter} from 'flowname/html';
const provider:Provider=createProvider({provider:'mock'});
const options:RecoveryOptions={provider};
await recoverNames('const a=1;',options);
await createHtmlReporter('./unused-report');
`);
  await writeFile(join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'NodeNext',target:'ES2023',types:[]},files:['consumer.ts']}));
  await command(process.execPath,['node_modules/typescript/bin/tsc']);
  await writeFile(join(consumer,'smoke.mjs'),`import assert from 'node:assert/strict';
import {recoverNames,createProvider} from 'flowname';
import {createHtmlReporter} from 'flowname/html';
const reporter=await createHtmlReporter('./api-report');
const result=await recoverNames('const a=1;globalThis.answer=a;', {provider:createProvider({provider:'mock'}),onEvent:reporter.onEvent});
assert.equal(result.status,'completed');assert.equal(Object.keys(result.accepted).length,1);
`);
  await command(process.execPath,['smoke.mjs']);
  await writeFile(join(consumer,'input.js'),'const a=1;console.log(a);');
  const windows=process.platform==='win32';
  const cli=windows?process.env.ComSpec:join(consumer,'node_modules/.bin/flowname');
  const {stdout:cliOutput}=await command(cli,windows?['/d','/c','node_modules\\.bin\\flowname.cmd input.js --out cli-output --provider mock --report']:['input.js','--out','cli-output','--provider','mock','--report']);
  assert.ok(cliOutput.includes(pathToFileURL(join(consumer,'cli-output/index.html')).href));
  assert.equal(JSON.parse(await readFile(join(consumer,'cli-output/result.json'),'utf8')).status,'completed');
  assert.match(await readFile(join(consumer,'cli-output/output.js'),'utf8'),/recovered_/);
  console.log(`Installed-package import, strict types without Node globals, CLI and report passed on ${process.version}.`);
} finally {
  // Only remove the exact temporary consumer created above, never a redirected path.
  const resolved=await realpath(consumer);
  assert.equal(resolved,consumer);assert.equal(dirname(resolved),tempRoot);
  await rm(resolved,{recursive:true,force:true});
}
