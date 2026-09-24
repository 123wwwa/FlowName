#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {recoverNames,createProvider} from './library.js';
import {createHtmlReporter} from './html-reporter.js';
async function main(){
 const {values:v,positionals}=parseArgs({allowPositionals:true,options:{passes:{type:'string',default:'1'},help:{type:'boolean'},out:{type:'string'},provider:{type:'string',default:'gemini'},model:{type:'string'},'base-url':{type:'string'},concurrency:{type:'string',default:'4'},rpm:{type:'string',default:'60'},'max-calls':{type:'string',default:'10000'}}});
 if(v.help||!positionals.length){console.log('flowname input.js --out NEW_DIRECTORY [--provider gemini|compatible --model MODEL --base-url URL --concurrency 4 --rpm 60 --max-calls 10000 --passes 1|2]\nSingle pass is the default. Two passes are experimental and may increase cost and time.\nSet GEMINI_API_KEY or FLOWNAME_API_KEY in the environment. Open OUT/index.html during recovery. One corrective retry for model JSON/ID errors within budgets; no transport retries.');return;}
 if(positionals.length!==1||!v.out)throw new Error('Supply one input file and --out NEW_DIRECTORY.');
 const passes=Number(v.passes);if(passes!==1&&passes!==2)throw new Error('--passes must be 1 or 2.');
 const code=await readFile(resolve(positionals[0]),'utf8');
 const provider=createProvider({provider:v.provider,model:v.model,baseUrl:v['base-url'],timeoutMs:60000});
 const directory=resolve(v.out);await mkdir(dirname(directory),{recursive:true});
 const reporter=await createHtmlReporter(directory);console.log(`Live report: ${reporter.path}`);
 const controller=new AbortController();process.once('SIGINT',()=>{console.error('Stopping new requests; draining in-flight calls.');controller.abort();});
 const result=await recoverNames(code,{provider,passes,concurrency:Number(v.concurrency),rpm:Number(v.rpm),maxCalls:Number(v['max-calls']),signal:controller.signal,onEvent:reporter.onEvent});
 console.log(`${result.status}: ${result.calls} calls, ${Object.keys(result.accepted).length} renames`);if(result.status!=='completed')process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
