#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import type {RecoveryEvent} from './library.js';
import {recoverNames,createProvider} from './library.js';
import {createHtmlReporter} from './html-reporter.js';
async function main(){
 const {values:v,positionals}=parseArgs({allowPositionals:true,options:{'context-mode':{type:'string',default:'usage'},'prompt-format':{type:'string',default:'compact'},passes:{type:'string',default:'1'},help:{type:'boolean'},report:{type:'boolean',default:false},out:{type:'string'},provider:{type:'string',default:'gemini'},model:{type:'string'},'base-url':{type:'string'},concurrency:{type:'string',default:'4'},rpm:{type:'string',default:'60'},'max-calls':{type:'string',default:'10000'}}});
 if(v.help||!positionals.length){console.log('Usage: flowname input.js [options]\nDefaults: Gemini / gemini-3.5-flash-lite (unless overridden by environment), concurrency 4, RPM 60, max calls 10000, one pass, compact prompts, bounded use context.\nOutput: a unique flowname-output-TIMESTAMP-ID directory in the current directory.\nOptions: --out NEW_DIRECTORY --report --provider gemini|compatible --model MODEL --base-url URL --concurrency N --rpm N --max-calls N --passes 1|2 --prompt-format compact|verbose --context-mode usage|declarations\nSet GEMINI_API_KEY or FLOWNAME_API_KEY in the environment. Add --report to generate a live HTML report and print its file URL. Without it, only output.js and result.json are saved. One corrective retry for model JSON/ID errors within budgets; no transport retries.');return;}
 if(positionals.length!==1)throw new Error('Supply exactly one input file.');
 const promptFormat=v['prompt-format'];if(promptFormat!=='compact'&&promptFormat!=='verbose')throw new Error('--prompt-format must be compact or verbose.');
 const contextMode=v['context-mode'];if(contextMode!=='usage'&&contextMode!=='declarations')throw new Error('--context-mode must be usage or declarations.');
 const passes=Number(v.passes);if(passes!==1&&passes!==2)throw new Error('--passes must be 1 or 2.');
 const code=await readFile(resolve(positionals[0]),'utf8');
 const provider=createProvider({provider:v.provider,model:v.model,baseUrl:v['base-url'],timeoutMs:60000});
 const directory=resolve(v.out??`flowname-output-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);await mkdir(dirname(directory),{recursive:true});
 const reporter=v.report?await createHtmlReporter(directory):undefined;
 if(!reporter)await mkdir(directory,{recursive:false});
 console.log('Output directory: '+directory);
 if(reporter)console.log('Live report (open in your browser): '+pathToFileURL(reporter.path).href);
 let total=0,done=0,active=0,failed=0,retries=0,input=0,output=0,unknown=false;
 const progress=(event:RecoveryEvent)=>{
  if(event.type==='response')console.error(`Request ${(event.index??0)+1}: actual tokens in/out: ${event.inputTokens??'Unknown'} / ${event.outputTokens??'Unknown'}`);
  if(event.total!==undefined)total=event.total;
  if(event.type==='request'){active++;if((event.attempt??1)>1)retries++;}
  if(event.type==='response'){
   active=Math.max(0,active-1);done++;if(event.error)failed++;
   if(event.inputTokens==null||event.outputTokens==null)unknown=true;
   input+=event.inputTokens??0;output+=event.outputTokens??0;
  }
  if(event.type==='complete')return;
  const line='Progress: '+done+'/'+total+' responses | '+active+' in flight | '+failed+' response errors | '+retries+' retries | tokens in/out: '+input+'/'+output+(unknown?' (known usage only; some unavailable)':'');
  if(process.stderr.isTTY){process.stderr.clearLine(0);process.stderr.cursorTo(0);process.stderr.write(line);}
  else if(event.type!=='request')console.error(line);
 };

 const controller=new AbortController();const stop=()=>{console.error('\nStopping new requests; draining in-flight calls.');controller.abort();};process.once('SIGINT',stop);
 try {
 const result=await recoverNames(code,{provider,passes,promptFormat,contextMode,concurrency:Number(v.concurrency),rpm:Number(v.rpm),maxCalls:Number(v['max-calls']),signal:controller.signal,onEvent:async event=>{progress(event);await reporter?.onEvent(event);}});
 if(!reporter){await writeFile(join(directory,'output.js'),result.code);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));}
 console.log('Output: '+join(directory,'output.js'));
 console.log(`${result.status}: ${result.calls} calls, ${Object.keys(result.accepted).length} renames`);if(result.status!=='completed')process.exitCode=1;
 } finally {process.removeListener('SIGINT',stop);if(process.stderr.isTTY)process.stderr.write('\n');}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
