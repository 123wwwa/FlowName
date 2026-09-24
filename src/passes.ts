import {lightweight} from './lightweight.js';
import type {Analysis} from './types.js';

/** Syntax-backed priority, not a claim of semantic confidence. */
export function priorityTargets(analysis:Analysis):string[]{
  return analysis.symbols.filter(s=>s.eligible&&s.namingRole).sort((a,b)=>
    Number(b.scope.startsWith('Program:'))-Number(a.scope.startsWith('Program:')) ||
    b.references.length-a.references.length || a.declaration.start-b.declaration.start
  ).map(s=>s.id);
}

/** Rename-only generation preserves declaration order. Verify it before rebasing IDs. */
export function rebaseAnalysis(code:string,previous:Analysis,applied:Record<string,string>):Analysis{
  const next=lightweight(code);
  if(next.symbols.length!==previous.symbols.length)throw new Error('Pass boundary changed binding count.');
  const ids=new Map<string,string>();
  next.symbols.forEach((symbol,i)=>{
    const before=previous.symbols[i]!;
    if(symbol.name!==(applied[before.id]??before.name)||symbol.kind!==before.kind||symbol.namingRole!==before.namingRole)throw new Error('Pass boundary binding identity check failed.');
    ids.set(symbol.id,before.id);
  });
  return {...next,usageContexts:Object.fromEntries(Object.entries(next.usageContexts??{}).map(([id,contexts])=>[ids.get(id)!,contexts])),symbols:next.symbols.map(s=>({...s,id:ids.get(s.id)!})),relations:next.relations.map(r=>({...r,from:ids.get(r.from)!,to:ids.get(r.to)!}))};
}
