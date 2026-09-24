import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {serialWriter} from './concurrency.js';
import type {RecoveryEvent} from './library.js';
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Dedicated new directory; refuses reuse. One self-refreshing HTML file, no CDN/server. */
export async function createHtmlReporter(directory:string){
 await mkdir(directory,{recursive:false});
 let total=0,done=0,status='Preparing',result:RecoveryEvent['result'];
 let input=0,output=0,unknown=0;
 const reportWarnings:string[]=[];
 const applied:Record<string,string>={};
 const calls=new Map<number,{request?:RecoveryEvent;response?:RecoveryEvent}>();
 const render=()=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FlowName · Live recovery</title><style>:root{color-scheme:dark}body{margin:0;background:#10151e;color:#e9eef5;font:15px system-ui}main{max-width:1150px;margin:auto;padding:40px 24px}header{display:flex;justify-content:space-between;align-items:center}h1{font-size:32px;letter-spacing:-1px}small,p{color:#9eaec3}.badge{background:#203d39;color:#8ae4c0;padding:8px 14px;border-radius:20px}.stats{display:flex;gap:16px;margin:24px 0}.stats div{background:#1b2433;padding:20px;border-radius:12px;flex:1}.stats b{display:block;font-size:26px}progress{width:100%;accent-color:#8ae4c0}details{background:#1b2433;border:1px solid #2b3749;border-radius:12px;margin:12px 0;padding:16px}summary{cursor:pointer}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{text-align:left;padding:10px;border-bottom:1px solid #303d51}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#111923;padding:16px;border-radius:8px;max-height:400px;overflow:auto}a{color:#8ae4c0}input{padding:12px;background:#1b2433;color:white;border:1px solid #303d51;border-radius:8px;width:60%}</style><main><header><div><small>FLOWNAME / RECOVERY WORKSPACE</small><h1>Names with context.</h1></div><span class="badge">${esc(status)}</span></header><p>${esc(result?.warnings.join("; ")??"")}</p><p>Live suggestions are provisional. Final applied names include scope collision checks.</p><p>${esc(reportWarnings.join("; "))}</p><div class="stats"><div><b>${done} / ${total}</b>Responses</div><div><b>${result?Object.keys(result.accepted).length:'—'}</b>Final renames</div><div><b>${input} / ${output}${unknown?' (known usage; '+unknown+' responses unknown)':''}</b>Actual input / output tokens</div></div><progress max="${total||1}" value="${done}"></progress><p>${result?'<a href="output.js">Recovered JavaScript</a> · <a href="result.json">Result JSON</a> · ':''}<a href="events.jsonl">Event log</a></p><input id="search" placeholder="Search names or symbol IDs">${[...calls].sort(([a],[b])=>a-b).map(([id,c])=>`<details data-call="${id}"><summary>Request ${id+1} · Pass ${c.request?.pass??1} · Group ${(c.request?.groupIndex??id)+1} · Attempt ${c.request?.attempt??1} · ${c.request?.request?.targets.length??0} identifiers · ${c.response?.error?(Object.keys(c.response.names??{}).length?'Partially accepted':'Failed'):c.response?'Received':'In flight'}</summary><p>Actual input / output: ${c.response?.inputTokens??'Unknown'} / ${c.response?.outputTokens??'Unknown'}</p>${c.response?.error?`<p>${esc(c.response.error)}</p>${c.response.retrySkipped?`<p>Retry skipped: ${esc(c.response.retrySkipped)}</p>`:""}`:''}<table><tr><th>Input name</th><th>Suggested</th><th>Final applied</th><th>Adjustment / rejection</th></tr>${(c.request?.request?.targets??[]).map(s=>`<tr><td>${esc(s.name)} <small>${esc(s.id)}</small></td><td>${esc(c.response?.names?.[s.id]??'—')}</td><td>${esc(result?(result.accepted[s.id]??s.name):applied[s.id]??'Pending finalization')}</td><td>${esc(result?.adjustments[s.id]??result?.rejected[s.id]??'')}</td></tr>`).join('')}</table><details><summary>Response details</summary><pre>${esc(JSON.stringify(c.response,null,2))}</pre></details><details><summary>Naming prompt (standard provider)</summary><pre>${esc(c.request?.prompt??'Prompt unavailable in this log')}</pre></details><details><summary>Internal analysis and request budget</summary><pre>${esc(JSON.stringify(c.request?.request,null,2))}</pre></details></details>`).join('')}</main><script>const key=location.pathname;const search=document.querySelector('#search');search.value=sessionStorage.getItem(key+'q')||'';const filter=()=>document.querySelectorAll('[data-call]').forEach(e=>e.hidden=!e.textContent.toLowerCase().includes(search.value.toLowerCase()));search.oninput=()=>{sessionStorage.setItem(key+'q',search.value);filter()};filter();document.querySelectorAll('[data-call]').forEach(e=>{e.open=sessionStorage.getItem(key+e.dataset.call)==='1';e.addEventListener('toggle',()=>sessionStorage.setItem(key+e.dataset.call,e.open?'1':'0'))});${result?'':'setTimeout(()=>location.reload(),2000);'}</script></html>`;
 const persist=async()=>{
  await writeFile(join(directory,'index.tmp'),render());
  for(let attempt=0;attempt<4;attempt++)try{await fs.rename(join(directory,'index.tmp'),join(directory,'index.html'));return;}catch(error){
   if(!['EPERM','EACCES','EBUSY'].includes((error as NodeJS.ErrnoException).code??''))throw error;
   if(attempt<3){await new Promise(resolve=>setTimeout(resolve,25*2**attempt));continue;}
   const warning='HTML refresh temporarily blocked by a file lock; events and results remain saved. Close applications locking index.html.';
   if(!reportWarnings.includes(warning)){reportWarnings.push(warning);await appendFile(join(directory,'events.jsonl'),JSON.stringify({type:'report-warning',time:new Date().toISOString(),message:warning})+'\n');console.warn(warning);}
  }
 };
 await persist();
 const write=serialWriter(async line=>{
  const event:RecoveryEvent=JSON.parse(line);await appendFile(join(directory,'events.jsonl'),line+'\n');
  if(event.type==='response'){input+=event.inputTokens??0;output+=event.outputTokens??0;if(event.inputTokens==null||event.outputTokens==null)unknown++;}
  if(event.total!==undefined)total=event.total;
  if(event.type==='plan'){total=event.total!;status='Running · Pass '+event.pass;}
  if(event.index!==undefined){const call=calls.get(event.index)??{};if(event.type==='request')call.request=event;else{call.response=event;done++;}calls.set(event.index,call);}
  if(event.type==='pass-complete')Object.assign(applied,event.applied);
  if(event.result){result=event.result;status=result.status;await writeFile(join(directory,'output.js'),result.code);await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));}
  await persist();
 });
 return {path:join(directory,'index.html'),warnings:reportWarnings,onEvent:async(event:RecoveryEvent)=>{await write(JSON.stringify(event));}};
}
