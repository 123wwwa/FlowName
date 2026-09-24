import {lightweight} from './lightweight.js';
import {budgetedRequests} from './request-budget.js';
import {rename} from './rename.js';
import {acceptResponse,ModelFormatError} from './inference.js';
import {promptFor} from './grouping.js';
import {mapConcurrent,serialWriter} from './concurrency.js';
import {priorityTargets,rebaseAnalysis} from './passes.js';
import type {Provider,InferenceRequest,Analysis} from './types.js';
export interface RecoveryEvent {
 type:'plan'|'request'|'response'|'pass-complete'|'complete'; time:string;
 index?:number; groupIndex?:number; attempt?:number; pass?:number; retrySkipped?:string;
 total?:number; request?:InferenceRequest; names?:Record<string,string>; error?:string;
 unresolved?:Record<string,string>; ignoredIds?:string[]; applied?:Record<string,string>;
 inputTokens?:number|null; outputTokens?:number|null; result?:RecoveryResult;
}
export interface RecoveryOptions {provider:Provider;passes?:1|2;concurrency?:number;rpm?:number;maxCalls?:number;promptBytes?:number;maxTargets?:number;signal?:AbortSignal;onEvent?:(event:RecoveryEvent)=>void|Promise<void>;}
export interface RecoveryResult {code:string;proposed:Record<string,string>;accepted:Record<string,string>;rejected:Record<string,string>;adjustments:Record<string,string>;status:'completed'|'partial'|'cancelled';calls:number;plannedCalls:number;failedCalls:number;inputTokens:number|null;outputTokens:number|null;warnings:string[];}
/** Shared call/rate budgets across at most two passes and one repair per group. */
export async function recoverNames(code:string,options:RecoveryOptions):Promise<RecoveryResult>{
 const {provider,signal}=options;
 const passes=options.passes??1;
 if(passes!==1&&passes!==2)throw new Error('passes must be 1 or 2.');
 const concurrency=options.concurrency??4,rpm=options.rpm??60,maxCalls=options.maxCalls??10000,promptBytes=options.promptBytes??12000;
 for(const n of [concurrency,rpm,maxCalls])if(!Number.isSafeInteger(n)||n<1)throw new Error('Execution limits must be positive integers.');
 if(concurrency>32)throw new Error('Maximum concurrency is 32.');
 signal?.throwIfAborted();
 const originalAnalysis=lightweight(code);
 const allIds=originalAnalysis.symbols.filter(s=>s.eligible).map(s=>s.id);
 const priority=passes===2?priorityTargets(originalAnalysis):[],prioritySet=new Set(priority);
 const localIds=allIds.filter(id=>!prioritySet.has(id));
 const phases=passes===2&&priority.length&&localIds.length?[priority,localIds]:[allIds];
 const plan=(source:string,analysis:Analysis,ids:string[])=>budgetedRequests(source,analysis,ids,promptBytes,options.maxTargets);
 // Preflight both sets on the original source. Pass two is rebuilt after application.
 const initialPlans=phases.map(ids=>plan(code,originalAnalysis,ids));
 let plannedCalls=initialPlans.reduce((n,requests)=>n+requests.length,0);
 if(plannedCalls>maxCalls)throw new Error(`Plan requires ${plannedCalls} calls, exceeding maxCalls=${maxCalls}. No requests sent.`);
 let stop=false,count=0,failed=0,consecutive=0,next=0,input=0,output=0,known=true,retries=0,groupCounter=0,repairReservations=0,requestCounter=0;
 let currentCode=code,currentAnalysis=originalAnalysis;
 const names:Record<string,string>={},accepted:Record<string,string>={},rejected:Record<string,string>={},adjustments:Record<string,string>={};
 const warnings=[...originalAnalysis.warnings];
 const resolved=new Set<string>();
 const emit=async(event:Omit<RecoveryEvent,'time'>)=>{try{await options.onEvent?.({...event,time:new Date().toISOString()});}catch(error){stop=true;throw error;}};
 const pace=serialWriter(async()=>{
  if(stop||signal?.aborted)return;
  const wait=Math.max(0,next-Date.now());
  if(wait)await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,wait);signal?.addEventListener('abort',done,{once:true});});
  next=Date.now()+60000/rpm;
 });
 const recordUsage=(i:unknown,o:unknown)=>{
  if(typeof i==='number'&&typeof o==='number'&&i>=0&&o>=0&&Number.isFinite(i+o)){input+=i;output+=o;}else known=false;
 };
 for(let phase=0;phase<phases.length;phase++){
  if(stop||signal?.aborted)break;
  const pass=phase+1;
  let requests=initialPlans[phase]!;
  if(phase>0){
   try{
    currentAnalysis=rebaseAnalysis(currentCode,originalAnalysis,accepted);
    requests=plan(currentCode,currentAnalysis,phases[phase]!);
   }catch(error){warnings.push(`Pass 2 skipped: ${error instanceof Error?error.message:String(error)}`);stop=true;break;}
   plannedCalls+=requests.length-initialPlans[phase]!.length;
   if(count+requests.length>maxCalls){warnings.push('Pass 2 skipped: updated context exceeds remaining call budget.');stop=true;break;}
  }
  await emit({type:'plan',pass,total:plannedCalls+retries});
  const passNames:Record<string,string>={};
  let pendingInitial=requests.length;
  // Reserve the original pass-two estimate until its actual context is available.
  const futureReserved=initialPlans.slice(phase+1).reduce((n,p)=>n+p.length,0);
  const groups=requests.map(request=>({request,groupIndex:groupCounter++}));
  await mapConcurrent(groups,concurrency,async({request:original,groupIndex})=>{
   let request:InferenceRequest=original;
   for(let attempt=1;attempt<=2;attempt++){
    await pace('');if(stop||signal?.aborted)return;
    if(attempt===2)repairReservations--;
    if(count>=maxCalls){stop=true;return;}
    // Reserve an index/call slot before awaiting the observer to avoid concurrent races.
    const index=requestCounter++;count++;if(attempt===1)pendingInitial--;
    await emit({type:'request',index,groupIndex,attempt,pass,total:plannedCalls+retries,request});
    if(stop||signal?.aborted){count--;return;}
    let event:Omit<RecoveryEvent,'time'>,needsRepair=false;
    let missing=request.targets.map(t=>t.id);
    try{
     const response=await provider.infer(request);
     recordUsage(response.inputTokens,response.outputTokens);
     let parsed:ReturnType<typeof acceptResponse>;
     try{parsed=acceptResponse({names:response.names},request);}catch(error){
      // Usage has already been recorded for this custom-provider response.
      throw Object.assign(new ModelFormatError(error instanceof Error?error.message:'Invalid names.',response.rawResponse??'',response.httpStatus??200,{prompt_tokens:response.inputTokens,completion_tokens:response.outputTokens}),{usageRecorded:true});
     }
     const unresolved={...parsed.validation.unresolved,...response.validation?.unresolved};
     // Only unresolved IDs belonging to this request may be retried.
     missing=request.targets.filter(t=>Object.hasOwn(unresolved,t.id)).map(t=>t.id);
     const valid=Object.fromEntries(Object.entries(parsed.names).filter(([id])=>!missing.includes(id)));
     Object.assign(names,valid);Object.assign(passNames,valid);
     Object.keys(valid).forEach(id=>resolved.add(id));
     needsRepair=missing.length>0;
     if(needsRepair)failed++;
     // Useful partial progress breaks the consecutive no-progress failure streak.
     consecutive=Object.keys(valid).length?0:consecutive+1;
     event={type:'response',index,names:valid,unresolved:Object.fromEntries(missing.map(id=>[id,unresolved[id]!])),ignoredIds:[...new Set([...parsed.validation.ignoredIds,...(response.validation?.ignoredIds??[])])],inputTokens:response.inputTokens,outputTokens:response.outputTokens};
     if(needsRepair)event.error=`Partial response: ${missing.length} unresolved target(s).`;
    }catch(error){
     failed++;consecutive++;
     const e=error as {httpStatus?:number;usageRecorded?:boolean;usage?:{prompt_tokens?:number;completion_tokens?:number}};
     const i=e.usage?.prompt_tokens,o=e.usage?.completion_tokens;
     if(!e.usageRecorded)recordUsage(i,o);
     if([401,403,429].includes(e.httpStatus??0))stop=true;
     needsRepair=error instanceof ModelFormatError;
     event={type:'response',index,error:error instanceof Error?error.message:String(error),unresolved:Object.fromEntries(missing.map(id=>[id,'No valid response.'])),inputTokens:i??null,outputTokens:o??null};
    }
    if(consecutive>=3)stop=true;
    let repair:InferenceRequest|undefined;
    if(needsRepair&&attempt===1){
     const ids=new Set(missing);
     const candidate={...original,formatRepair:true,targets:original.targets.filter(t=>ids.has(t.id)),relations:original.relations.filter(r=>ids.has(r.from)&&ids.has(r.to))};
     candidate.budgeting={...original.budgeting,promptBytes:Buffer.byteLength(promptFor(candidate)),outputReserveTokens:128+64*missing.length};
     if(stop||signal?.aborted)event.retrySkipped='Run stopped or cancelled.';
     else if(count+pendingInitial+futureReserved+repairReservations>=maxCalls)event.retrySkipped='No spare maxCalls budget after reserving initial requests.';
     else if(candidate.budgeting.promptBytes>promptBytes)event.retrySkipped='Correction would exceed promptBytes.';
     else {repair=candidate;repairReservations++;}
    }
    await emit({...event,groupIndex,attempt,pass});
    if(!repair||stop||signal?.aborted)return;
    // Concurrent repairs recheck the actual cap before starting, using the same pool.
    retries++;request=repair;
   }
  },()=>stop||!!signal?.aborted);
  const changed=rename(currentCode,currentAnalysis,passNames);
  currentCode=changed.code;
  Object.assign(accepted,changed.accepted);Object.assign(rejected,changed.rejected);Object.assign(adjustments,changed.adjustments);
  await emit({type:'pass-complete',pass,applied:changed.accepted});
 }
 const result:RecoveryResult={code:currentCode,proposed:names,accepted,rejected,adjustments,status:signal?.aborted?'cancelled':stop||resolved.size<allIds.length?'partial':'completed',calls:count,plannedCalls,failedCalls:failed,inputTokens:known?input:null,outputTokens:known?output:null,warnings};
 await emit({type:'complete',result});return result;
}
export {CompatibleProvider} from './inference.js';
export {createProvider} from './provider-config.js';
export type {Provider,InferenceRequest,InferenceResult} from './types.js';
