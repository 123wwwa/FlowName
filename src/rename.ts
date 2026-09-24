import type { Binding, Scope } from '@babel/traverse';
import { createHash } from 'node:crypto';
import * as t from '@babel/types';
import { generate, traverse } from './babel.js';
import { parseCode } from './analysis.js';
import type { Analysis } from './types.js';

export function rename(code: string, analysis: Analysis, proposed: Record<string, string>) {
  if (createHash('sha256').update(code).digest('hex') !== analysis.sourceHash) throw new Error('Analysis/source hash mismatch.');
  const ast = parseCode(code);
  const bindings = new Map<string, Binding>();
  const allNames = new Set<string>();
  const freeReferences: Array<{name:string;scope:Scope}> = [];
  traverse(ast, {
    Scopable(path) {
      for (const binding of Object.values(path.scope.bindings)) bindings.set(`s${binding.identifier.start ?? 0}`, binding);
    },
    Identifier(path) {
      allNames.add(path.node.name);
      if (path.isReferencedIdentifier() && !path.scope.getBinding(path.node.name)) freeReferences.push({name:path.node.name,scope:path.scope});
    },
  });
  const accepted = new Map<string, string>();
  const rejected: Record<string, string> = {};
  for (const [id, name] of Object.entries(proposed)) {
    const symbol = analysis.symbols.find(s => s.id === id);
    if (!symbol?.eligible || !bindings.has(id)) rejected[id] = 'unknown or protected symbol';
    else if (!t.isValidIdentifier(name) || ['arguments', 'eval', 'await', 'yield'].includes(name)) rejected[id] = 'invalid or restricted identifier';
    else if (name !== symbol.name) accepted.set(id, name);
  }
  // Reserve all proposed final names, so swaps remain possible. Resolve in source
  // order (never response completion order). Disjoint scopes may share names.
  const adjustments: Record<string,string> = {};
  const within=(scope:Scope, ancestor:Scope):boolean=>{
    for(let current:Scope|null=scope;current;current=current.parent)if(current===ancestor)return true;
    return false;
  };
  const collision=(id:string,name:string):string|null=>{
    const scope=bindings.get(id)!.scope;
    for(const [otherId,other] of bindings){
      if(otherId===id||(accepted.get(otherId)??other.identifier.name)!==name)continue;
      if(other.scope===scope)return 'same-scope binding collision';
      // Conservative protection: related scopes conflict even without a use
      // at the overlapping site. Sibling functions are intentionally allowed.
      if(within(scope,other.scope))return 'ancestor binding shadowing risk';
      if(within(other.scope,scope))return 'descendant binding capture risk';
    }
    if(freeReferences.some(r=>r.name===name&&within(r.scope,scope)))return 'unresolved reference capture risk';
    return null;
  };
  const ordered=[...accepted.keys()].sort((a,b)=>bindings.get(a)!.identifier.start!-bindings.get(b)!.identifier.start!);
  for(const id of ordered){
    const base=accepted.get(id)!;
    const reason=collision(id,base);
    if(!reason)continue;
    const match=/^(.*?)([0-9]+)$/.exec(base);
    const stem=match?.[1]??base;
    let suffix=match?BigInt(match[2]!)+1n:2n;
    let candidate:string;
    do {candidate=`${stem}${suffix++}`;}while(collision(id,candidate));
    accepted.set(id,candidate);
    adjustments[id]=reason;
  }
  let counter = 0;
  for (const [id] of accepted) {
    const binding = bindings.get(id)!;
    let temporary: string;
    do { temporary = `__flowname_tmp_${counter++}`; } while (allNames.has(temporary) || [...accepted.values()].includes(temporary));
    allNames.add(temporary);
    binding.scope.rename(binding.identifier.name, temporary);
  }
  for (const [id, name] of accepted) {
    const binding = bindings.get(id)!;
    binding.scope.rename(binding.identifier.name, name);
  }
  const output = generate(ast, { comments: true }).code;
  parseCode(output);
  return { code: output, accepted: Object.fromEntries(accepted), rejected, adjustments };
}
