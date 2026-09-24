import {parentPort,workerData} from 'node:worker_threads';
import {recoverNames,CompatibleProvider} from '../dist/library.js';
const endpoints={gemini:'https://generativelanguage.googleapis.com/v1beta/openai',openai:'https://api.openai.com/v1',groq:'https://api.groq.com/openai/v1'};
try{
 const {source,apiKey,model,provider}=workerData;
 await recoverNames(source,{provider:new CompatibleProvider({baseUrl:endpoints[provider],apiKey,model,timeoutMs:30000,maxResponseBytes:1048576}),concurrency:4,rpm:60,maxCalls:1000,onEvent:event=>parentPort.postMessage(event)});
}catch(error){parentPort.postMessage({type:'fatal',error:(error instanceof Error?error.message:'Recovery failed').split(workerData.apiKey).join('[REDACTED]')});}
