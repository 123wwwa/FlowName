import type {Analysis,InferenceRequest,SymbolInfo,Relation,PromptFormat} from './types.js';
import {promptFor} from './grouping.js';
/** UTF-8 byte budget is a conservative local proxy, NOT a measured token count. */
export function budgetedRequests(code:string,analysis:Analysis,ids:string[],budget=12000,maxTargets=16,promptFormat:PromptFormat='compact'){
 if(promptFormat!=='compact'&&promptFormat!=='verbose')throw new Error('promptFormat must be compact or verbose.');
 if(!Number.isSafeInteger(budget)||budget<1024||!Number.isSafeInteger(maxTargets)||maxTargets<1||maxTargets>64)throw new Error('Invalid request budget.');
 if(new Set(ids).size!==ids.length)throw new Error('Duplicate targets.');
 const symbols=new Map(analysis.symbols.map(s=>[s.id,s]));
 for(const id of ids)if(!symbols.get(id)?.eligible)throw new Error('Unknown or protected target.');
 const neighbors=new Map(ids.map(id=>[id,new Set<string>()]));
 const evidence=new Map(ids.map(id=>[id,[] as Relation[]]));
 for(const r of analysis.relations){evidence.get(r.from)?.push(r);if(r.to!==r.from)evidence.get(r.to)?.push(r);if(r.from!==r.to&&neighbors.has(r.from)&&neighbors.has(r.to)){neighbors.get(r.from)!.add(r.to);neighbors.get(r.to)!.add(r.from);}}
 const scopes=new Map<string,Set<string>>();
 for(const id of ids){const scope=symbols.get(id)!.scope;const list=scopes.get(scope)??new Set();list.add(id);scopes.set(scope,list);}
 const make=(group:string[])=>{
  const targets=group.map(id=>symbols.get(id)!);const set=new Set(group);
  const ranges=targets.map(s=>[Math.max(0,s.declaration.start-50),Math.min(code.length,Math.max(s.declaration.end,s.declaration.start+110))] as [number,number]).sort((a,b)=>a[0]-b[0]);
  const merged:Array<[number,number]>=[];
  for(const r of ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}
  const context=merged.map(([a,b])=>`\n/* excerpt [${a},${b}); may be partial */\n${code.slice(a,b)}\n`).join('');
  const request:InferenceRequest={promptFormat,targets:targets.map(s=>({...s,references:[]})),context,relations:[],defUses:[],definitions:[]};
  const facts=[...new Set(group.flatMap(id=>evidence.get(id)!))].filter(r=>set.has(r.from)&&set.has(r.to));
  let omitted=0;
  for(const r of facts){if(request.relations.length>=64){omitted++;continue;}request.relations.push(r);if(Buffer.byteLength(promptFor(request))>budget){request.relations.pop();omitted++;}}
  return Object.assign(request,{budgeting:{promptBytes:Buffer.byteLength(promptFor(request)),limitBytes:budget,omittedRelations:omitted,referenceLocationsNotExpanded:targets.reduce((n,s)=>n+s.references.length,0),contextPolicy:'declaration excerpts only',outputReserveTokens:128+64*group.length}});
 };
 const remaining=new Set(ids);const output=[];
 while(remaining.size){
  const seed=remaining.values().next().value!;let group=[seed];let request=make(group);
  if(request.budgeting.promptBytes>budget)throw new Error(`Target ${seed} cannot fit request budget; no API call made.`);
  const candidates=new Set<string>();let fallback=false;
  const remove=(id:string)=>{remaining.delete(id);scopes.get(symbols.get(id)!.scope)!.delete(id);};remove(seed);
  for(const n of neighbors.get(seed)!)if(remaining.has(n))candidates.add(n);
  while(group.length<maxTargets){
   const id=candidates.values().next().value??scopes.get(symbols.get(seed)!.scope)!.values().next().value;
   if(!id)break;
   const linked=candidates.has(id);candidates.delete(id);
   if(!remaining.has(id))continue;
   const next=make([...group,id]);if(next.budgeting.promptBytes>budget)break;
   fallback ||= !linked;group.push(id);request=next;remove(id);
   for(const n of neighbors.get(id)!)if(remaining.has(n))candidates.add(n);
  }
  output.push(Object.assign(request,{grouping:{kind:group.length===1?'singleton' as const:fallback?'scope-fallback' as const:'relation' as const,singletonOrigins:{}}}));
 }
 return output;
}
