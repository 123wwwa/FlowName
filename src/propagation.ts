import type {Analysis,InferenceRequest} from './types.js';
import {promptFor} from './grouping.js';

export interface PriorCandidate {id:string;name:string;at:number;owner:number}
/** Match bound occurrences, never spellings. Only direct relations crossing groups qualify. */
export function propagationPlan(requests:InferenceRequest[],analysis:Analysis):PriorCandidate[][]{
 const owner=new Map<string,number>();requests.forEach((r,i)=>r.targets.forEach(t=>owner.set(t.id,i)));
 const neighbors=new Map<string,Set<string>>();
 for(const r of analysis.relations){
  if(r.from===r.to)continue;
  for(const [a,b] of [[r.from,r.to],[r.to,r.from]]){const set=neighbors.get(a!)??new Set<string>();set.add(b!);neighbors.set(a!,set);}
 }
 const symbols=new Map(analysis.symbols.map(s=>[s.id,s]));
 return requests.map((r,i)=>{
  const related=new Set(r.targets.flatMap(t=>[...(neighbors.get(t.id)??[])]));
  const candidates:PriorCandidate[]=[];
  for(const id of related){
   const group=owner.get(id),symbol=symbols.get(id);
   if(group===undefined||group>=i||!symbol)continue;
   const occurrence=[symbol.declaration,...symbol.references].find(s=>r.contextRanges?.some(range=>range.start<=s.start&&range.end>=s.end));
   if(occurrence)candidates.push({id,name:symbol.name,at:occurrence.start,owner:group});
  }
  return candidates.sort((a,b)=>a.owner-b.owner||a.at-b.at).slice(0,16);
 });
}

/** Append hints only within spare budget; source, grouping and target IDs stay unchanged. */
export function withPreviousNames(request:InferenceRequest,candidates:PriorCandidate[],names:Record<string,string>,budget:number,groupOffset:number):InferenceRequest{
 const result:InferenceRequest={...request,previousNames:[]};
 const initial=Buffer.byteLength(promptFor(request));
 let omitted=0;
 for(const candidate of candidates){
  const suggested=names[candidate.id];
  if(!suggested||suggested===candidate.name){omitted++;continue;}
  const {id,name,at}=candidate;
  result.previousNames!.push({id,name,at,suggested});
  const bytes=Buffer.byteLength(promptFor(result));
  if(bytes>budget||bytes-initial>1024){result.previousNames!.pop();omitted++;}
 }
 const bytes=Buffer.byteLength(promptFor(result));
 result.propagation={dependsOn:[...new Set(candidates.map(c=>c.owner+groupOffset))],included:result.previousNames!.length,omitted,addedPromptBytes:bytes-initial};
 if('budgeting' in request)Object.assign(result,{budgeting:{...(request as InferenceRequest & {budgeting:object}).budgeting,promptBytes:bytes}});
 return result;
}
