// Stage only the dependency closure of public entrypoints; no research corpus or credentials.
import {readFile,writeFile,mkdir,lstat,realpath,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const pending=['library','html-reporter','product-cli'],seen=new Set();
// Only remove this project's generated staging directory; reject redirected paths.
const root=await realpath('.'),stage=resolve(root,'package-dist');
try {
 const info=await lstat(stage);
 if(info.isSymbolicLink()||!info.isDirectory()||await realpath(stage)!==stage)throw new Error('Unsafe package staging directory.');
 await rm(stage,{recursive:true});
} catch(error) {if(error.code!=='ENOENT')throw error;}
await mkdir('package-dist',{recursive:true});
while(pending.length){const name=pending.pop();if(seen.has(name))continue;seen.add(name);
 for(const suffix of ['.js','.d.ts']){const content=await readFile('dist/'+name+suffix,'utf8');await writeFile('package-dist/'+name+suffix,content);for(const match of content.matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+)\.js['"]/g))pending.push(match[1]);}}
console.log(`Staged ${seen.size} modules.`);
