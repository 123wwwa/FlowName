import {runRecovery} from './transport.js';
const $=id=>document.getElementById(id);let controller=null,finalCode='',total=0,done=0;const calls=new Map();
const providers={gemini:'gemini-3.5-flash-lite',openai:'gpt-5-mini',groq:'openai/gpt-oss-20b'};
$('provider').onchange=()=>{$('model').value=providers[$('provider').value];$('models').replaceChildren(Object.assign(document.createElement('option'),{value:$('model').value}));};
$('example').onclick=()=>{$('source').value='function a(b,c){const d=b.filter(e=>e.active);return d.slice(0,c);}\nconsole.log(a([{active:true},{active:false}],1));';};
const text=(tag,value)=>Object.assign(document.createElement(tag),{textContent:String(value??'—')});
function show(event){
 if(event.type==='plan'){total=event.total;$('status').textContent='Recovering';}
 if(event.type==='request'){
  if(calls.size===0)$('calls').replaceChildren();const card=document.createElement('details');card.append(text('summary',`Request ${event.index+1} · ${event.request.targets.length}identifiers · In flight`));
  const table=document.createElement('table');const head=document.createElement('tr');for(const label of ['Input name / ID','Suggested name','Final name','Adjustment reason'])head.append(text('th',label));table.append(head);
  const rows=new Map();for(const s of event.request.targets){const row=document.createElement('tr');for(const value of [`${s.name} / ${s.id}`,'Waiting','Pending final checks','—'])row.append(text('td',value));rows.set(s.id,row);table.append(row);}card.append(table);
  const context=document.createElement('details');context.append(text('summary','View submitted context and relations'),text('pre',JSON.stringify(event.request,null,2)));card.append(context);$('calls').append(card);calls.set(event.index,{card,rows,request:event.request});
 }
 if(event.type==='response'){
  done++;const c=calls.get(event.index);if(c){c.card.querySelector('summary').textContent=`Request ${event.index+1} · ${event.error?'Failed':'Response received'}`;for(const [id,row] of c.rows)row.children[1].textContent=event.names?.[id]??'Response failed';if(event.error)c.card.append(text('p',event.error));}
 }
 $('progress').textContent=`${done} / ${total}`;
 if(event.type==='complete'){
  const r=event.result;$('status').textContent=r.status==='completed'?'Completed':'Partially completed';$('renamed').textContent=Object.keys(r.accepted).length;$('tokens').textContent=`${r.inputTokens??'Unknown'} / ${r.outputTokens??'Unknown'}`;
  for(const c of calls.values())for(const s of c.request.targets){const row=c.rows.get(s.id);row.children[2].textContent=r.accepted[s.id]??s.name;row.children[3].textContent=r.adjustments[s.id]??r.rejected[s.id]??'—';}
  finalCode=r.code;$('output').textContent=r.code;$('output-section').hidden=false;
 }
 if(event.type==='fatal')throw new Error(event.error);
 filter();
}
function filter(){const q=$('search').value.toLowerCase();for(const c of calls.values())c.card.hidden=!c.card.textContent.toLowerCase().includes(q);}$('search').oninput=filter;
$('stop').onclick=()=>{controller?.abort();$('status').textContent='Stopped · Received suggestions preserved';};
$('form').onsubmit=async e=>{
 e.preventDefault();if(controller)return;controller=new AbortController();calls.clear();done=0;total=0;finalCode='';$('calls').replaceChildren();$('error').textContent='';$('status').textContent='Analyzing';$('output-section').hidden=true;$('renamed').textContent='—';$('tokens').textContent='—';$('progress').textContent='0 / 0';$('run').disabled=true;$('stop').disabled=false;
 const payload={source:$('source').value,provider:$('provider').value,model:$('model').value.trim(),apiKey:$('key').value.trim()};$('key').value='';
 try{
  await runRecovery(payload,controller.signal,show);
 }catch(error){if(error.name!=='AbortError'){$('error').textContent=error.message;$('status').textContent='Run failed';}}
 finally{payload.apiKey='';controller=null;$('run').disabled=false;$('stop').disabled=true;}
};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([finalCode],{type:'text/javascript'}));const a=document.createElement('a');a.href=url;a.download='recovered.js';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
