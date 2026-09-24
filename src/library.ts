import {lightweight} from './lightweight.js';
import {budgetedRequests} from './request-budget.js';
import {rename} from './rename.js';
import {validateResponse} from './inference.js';
import {mapConcurrent,serialWriter} from './concurrency.js';
import type {Provider,InferenceRequest} from './types.js';
export interface RecoveryEvent {type:'plan'|'request'|'response'|'complete'; time:string; index?:number; total?:number; request?:InferenceRequest; names?:Record<string,string>; error?:string; inputTokens?:number|null;outputTokens?:number|null;result?:RecoveryResult;}
export interface RecoveryOptions {provider:Provider;concurrency?:number;rpm?:number;maxCalls?:number;promptBytes?:number;maxTargets?:number;signal?:AbortSignal;onEvent?:(event:RecoveryEvent)=>void|Promise<void>;}
export interface RecoveryResult {code:string;proposed:Record<string,string>;accepted:Record<string,string>;rejected:Record<string,string>;adjustments:Record<string,string>;status:'completed'|'partial'|'cancelled';calls:number;plannedCalls:number;failedCalls:number;inputTokens:number|null;outputTokens:number|null;warnings:string[];}
/** No environment loading, network access or file writes until explicitly supplied by caller. */
export async function recoverNames(code:string,options:RecoveryOptions):Promise<RecoveryResult>{
 const {provider,signal}=options;const concurrency=options.concurrency??4,rpm=options.rpm??60,maxCalls=options.maxCalls??10000;
 for(const n of [concurrency,rpm,maxCalls])if(!Number.isSafeInteger(n)||n<1)throw new Error('Execution limits must be positive integers.');
 if(concurrency>32)throw new Error('Maximum concurrency is 32.');
 signal?.throwIfAborted();
 const analysis=lightweight(code);const requests=budgetedRequests(code,analysis,analysis.symbols.filter(s=>s.eligible).map(s=>s.id),options.promptBytes,options.maxTargets);
 if(requests.length>maxCalls)throw new Error(`Plan requires ${requests.length} calls, exceeding maxCalls=${maxCalls}. No requests sent.`);
 let stop=false;
 const emit=async(event:Omit<RecoveryEvent,'time'>)=>{try{await options.onEvent?.({...event,time:new Date().toISOString()});}catch(error){stop=true;throw error;}};
 await emit({type:'plan',total:requests.length});
 const names:Record<string,string>={};let count=0,failed=0,consecutive=0,next=0,input=0,output=0,known=true;
 const pace=serialWriter(async()=>{if(stop||signal?.aborted)return;const wait=Math.max(0,next-Date.now());if(wait)await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,wait);signal?.addEventListener('abort',done,{once:true});});next=Date.now()+60000/rpm;});
 await mapConcurrent(requests,concurrency,async(request,index)=>{
  await pace('');if(stop||signal?.aborted)return;
  await emit({type:'request',index,request});count++;
  let event:Omit<RecoveryEvent,'time'>;
  try{
   const response=await provider.infer(request);
   const valid=validateResponse({names:response.names},request);Object.assign(names,valid);consecutive=0;
   if(response.inputTokens===null||response.outputTokens===null)known=false;else{input+=response.inputTokens;output+=response.outputTokens;}
   event={type:'response',index,names:valid,inputTokens:response.inputTokens,outputTokens:response.outputTokens};
  }catch(error){
   failed++;consecutive++;const e=error as {httpStatus?:number;usage?:{prompt_tokens?:number;completion_tokens?:number}};
   const i=e.usage?.prompt_tokens,o=e.usage?.completion_tokens;if(typeof i==='number'&&typeof o==='number'&&i>=0&&o>=0&&Number.isFinite(i+o)){input+=i;output+=o;}else known=false;
   if(consecutive>=3||[401,403,429].includes(e.httpStatus??0))stop=true;
   event={type:'response',index,error:error instanceof Error?error.message:String(error),inputTokens:i??null,outputTokens:o??null};
  }
  // Observer errors propagate; they are not mislabeled as provider errors.
  await emit(event);
 },()=>stop||!!signal?.aborted);
 const changed=rename(code,analysis,names);
 const result:RecoveryResult={...changed,proposed:names,status:signal?.aborted?'cancelled':stop||failed||count<requests.length?'partial':'completed',calls:count,plannedCalls:requests.length,failedCalls:failed,inputTokens:known?input:null,outputTokens:known?output:null,warnings:analysis.warnings};
 await emit({type:'complete',result});return result;
}
export {CompatibleProvider} from './inference.js';
export {createProvider} from './provider-config.js';
export type {Provider,InferenceRequest,InferenceResult} from './types.js';
