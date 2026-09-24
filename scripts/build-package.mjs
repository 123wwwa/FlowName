// Stage only the dependency closure of public entrypoints; no research corpus or credentials.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const pending=['library','html-reporter','product-cli'],seen=new Set();
await mkdir('package-dist',{recursive:true});
while(pending.length){const name=pending.pop();if(seen.has(name))continue;seen.add(name);
 for(const suffix of ['.js','.d.ts']){const content=await readFile('dist/'+name+suffix,'utf8');await writeFile('package-dist/'+name+suffix,content);for(const match of content.matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+)\.js['"]/g))pending.push(match[1]);}}
console.log(`Staged ${seen.size} modules.`);
