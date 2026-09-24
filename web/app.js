import {runRecovery} from './browser-transport.js';
import {optionSpecs, validateOptions, validateInput} from './options.js';
const $=id=>document.getElementById(id);let controller=null,finalCode='',total=0,done=0;const calls=new Map();
const providers={gemini:'gemini-3.5-flash-lite',openai:'gpt-5-mini',groq:'openai/gpt-oss-20b'};
$('provider').onchange=()=>{$('model').value=providers[$('provider').value];$('models').replaceChildren(Object.assign(document.createElement('option'),{value:$('model').value}));};
$('example').onclick=()=>{$('source').value='function a(b,c){const d=b.filter(e=>e.active);return d.slice(0,c);}\nconsole.log(a([{active:true},{active:false}],1));';};
const text=(tag,value)=>Object.assign(document.createElement(tag),{textContent:String(value??'—')});
let inputTokens=0,outputTokens=0,unknownUsage=0;
for (const [key, spec] of Object.entries(optionSpecs)) {
 const label=text('label',spec.label);
 const input=spec.choices?Object.assign(document.createElement('select'),{id:key,name:key,required:true}):Object.assign(document.createElement('input'),{id:key,name:key,type:'number',min:String(spec.min),max:String(spec.max),step:'1',value:String(spec.value),required:true});
 if(spec.choices){spec.choices.forEach((label,i)=>input.append(Object.assign(document.createElement('option'),{value:spec.choiceValues?.[i]??String(i+1),textContent:label})));input.value=String(spec.value);}
 label.append(input,text('span',spec.help));$('recovery-options').append(label);
}
function show(event){
 if(event.total!==undefined)total=event.total;
 if(event.type==='plan'){total=event.total;$('status').textContent=`Recovering · Pass ${event.pass??1}`;}
 if(event.type==='request'){
  if(calls.size===0)$('calls').replaceChildren();const card=document.createElement('details');card.append(text('summary',`Request ${event.index+1} · Pass ${event.pass??1} · Group ${(event.groupIndex??event.index)+1} · Attempt ${event.attempt??1} · ${event.request.targets.length} identifiers · In flight`));
  const table=document.createElement('table');const head=document.createElement('tr');for(const label of ['Input name / ID','Suggested name','Final name','Adjustment reason'])head.append(text('th',label));table.append(head);
  const rows=new Map();for(const s of event.request.targets){const row=document.createElement('tr');for(const value of [`${s.name} / ${s.id}`,'Waiting','Pending final checks','—'])row.append(text('td',value));rows.set(s.id,row);table.append(row);}card.append(table);
  const prompt=document.createElement('details');prompt.append(text('summary','View exact naming prompt'),text('pre',event.prompt??'Prompt unavailable'));card.append(prompt);
  const context=document.createElement('details');context.append(text('summary','View internal analysis and request budget'),text('pre',JSON.stringify(event.request,null,2)));card.append(context);$('calls').append(card);calls.set(event.index,{card,rows,request:event.request});
 }
 if(event.type==='response'){
  inputTokens+=event.inputTokens??0;outputTokens+=event.outputTokens??0;if(event.inputTokens==null||event.outputTokens==null)unknownUsage++;
  $('tokens').textContent=`${inputTokens} / ${outputTokens}${unknownUsage?' (known usage; '+unknownUsage+' responses unknown)':''}`;
  calls.get(event.index)?.card.append(text('p',`Actual input / output tokens: ${event.inputTokens??'Unknown'} / ${event.outputTokens??'Unknown'}`));
  done++;const c=calls.get(event.index);if(c){c.card.querySelector('summary').textContent=`Request ${event.index+1} · Pass ${event.pass??1} · Group ${(event.groupIndex??event.index)+1} · Attempt ${event.attempt??1} · ${event.error?(Object.keys(event.names??{}).length?'Partially accepted':'Failed'):'Response received'}`;for(const [id,row] of c.rows)row.children[1].textContent=event.names?.[id]??'Response failed';if(event.error)c.card.append(text('p',event.error));if(event.ignoredIds?.length)c.card.append(text('p','Ignored IDs: '+event.ignoredIds.join(', ')));if(event.unresolved&&Object.keys(event.unresolved).length)c.card.append(text('pre',JSON.stringify(event.unresolved,null,2)));if(event.retrySkipped)c.card.append(text('p','Retry skipped: '+event.retrySkipped));}
 }
 if(event.type==='pass-complete'){for(const c of calls.values())for(const [id,row] of c.rows)if(event.applied?.[id])row.children[2].textContent=event.applied[id];}
 $('progress').textContent=`${done} / ${total}`;
 if(event.type==='complete'){
  const r=event.result;$('status').textContent=r.status==='completed'?'Completed':'Partially completed';$('renamed').textContent=Object.keys(r.accepted).length;$('tokens').textContent=`${r.inputTokens??inputTokens} / ${r.outputTokens??outputTokens}${r.inputTokens==null||r.outputTokens==null?' (known usage only; total unknown)':''}`;
  if(r.warnings?.length)$('error').textContent=r.warnings.join('\n');
  for(const c of calls.values())for(const s of c.request.targets){const row=c.rows.get(s.id);row.children[2].textContent=r.accepted[s.id]??s.name;row.children[3].textContent=r.adjustments[s.id]??r.rejected[s.id]??'—';}
  finalCode=r.code;$('output').textContent=r.code;$('output-section').hidden=false;
 }
 if(event.type==='fatal')throw new Error(event.error);
 filter();
}
function filter(){const q=$('search').value.toLowerCase();for(const c of calls.values())c.card.hidden=!c.card.textContent.toLowerCase().includes(q);}$('search').oninput=filter;
$('stop').onclick=()=>{controller?.abort();$('status').textContent='Stopped · Received suggestions preserved';};
$('form').onsubmit=async e=>{
 e.preventDefault();if(controller)return;
 const payload={source:$('source').value,provider:$('provider').value,model:$('model').value.trim(),apiKey:$('key').value.trim()};
 try{
  validateInput(payload);
  payload.options=validateOptions(Object.fromEntries(Object.keys(optionSpecs).map(key=>[key,optionSpecs[key].choiceValues?$(key).value:Number($(key).value)])));
 }catch(error){payload.apiKey='';$('error').textContent=error.message;$('status').textContent='Check input';if(error.field)$(error.field).focus();return;}
 controller=new AbortController();calls.clear();done=0;total=0;finalCode='';$('calls').replaceChildren();$('error').textContent='';$('status').textContent='Analyzing';$('output-section').hidden=true;$('renamed').textContent='—';$('tokens').textContent='—';$('progress').textContent='0 / 0';$('run').disabled=true;$('stop').disabled=false;
 inputTokens=0;outputTokens=0;unknownUsage=0;
 $('key').value='';
 try{
  $('recovery-options').disabled=true;
  await runRecovery(payload,controller.signal,show);
 }catch(error){if(error.name!=='AbortError'){$('error').textContent=error.message;$('status').textContent='Run failed';}}
 finally{payload.apiKey='';controller=null;$('run').disabled=false;$('stop').disabled=true;$('recovery-options').disabled=false;}
};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([finalCode],{type:'text/javascript'}));const a=document.createElement('a');a.href=url;a.download='recovered.js';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
