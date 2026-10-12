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
  const sourceIds = new Map(analysis.symbols.map(s=>[s.declaration.start,s.id]));
  const freeReferences: Array<{name:string;scope:Scope}> = [];
  const jsxComponents = new Set<Binding>();
  const recordWrites = (node:t.Node, scope:Scope) => {
    for (const name of Object.keys(t.getBindingIdentifiers(node))) {
      if (!scope.getBinding(name)) freeReferences.push({name,scope});
    }
  };
  traverse(ast, {
    Scopable(path) {
      for (const binding of Object.values(path.scope.bindings)) {
        const id=sourceIds.get(binding.identifier.start??0);if(id)bindings.set(id,binding);
      }
    },
    Identifier(path) {
      if (path.isReferencedIdentifier() && !path.scope.getBinding(path.node.name)) freeReferences.push({name:path.node.name,scope:path.scope});
    },
    AssignmentExpression(path) { recordWrites(path.node.left,path.scope); },
    UpdateExpression(path) { recordWrites(path.node.argument,path.scope); },
    'ForInStatement|ForOfStatement'(path) {
      const node=path.node as t.ForInStatement|t.ForOfStatement;
      recordWrites(node.left,path.scope);
    },
    JSXIdentifier(path) {
      const parent=path.parent;
      const standalone=(t.isJSXOpeningElement(parent)||t.isJSXClosingElement(parent))&&parent.name===path.node;
      const memberRoot=t.isJSXMemberExpression(parent)&&parent.object===path.node;
      if ((!standalone&&!memberRoot)||(standalone&&t.react.isCompatTag(path.node.name))) return;
      const binding=path.scope.getBinding(path.node.name);
      if (!binding) freeReferences.push({name:path.node.name,scope:path.scope});
      else if (standalone) jsxComponents.add(binding);
    },
  });
  const symbols = new Map(analysis.symbols.map(s=>[s.id,s]));
  const accepted = new Map<string, string>();
  const rejected: Record<string, string> = {};
  for (const [id, name] of Object.entries(proposed)) {
    const symbol = symbols.get(id);
    if (!symbol?.eligible || !bindings.has(id)) rejected[id] = 'unknown or protected symbol';
    else if (!t.isValidIdentifier(name) || ['arguments', 'eval', 'await', 'yield'].includes(name)) rejected[id] = 'invalid or restricted identifier';
    else if (jsxComponents.has(bindings.get(id)!) && t.react.isCompatTag(name)) rejected[id] = 'JSX component name would become an intrinsic tag';
    else if (name !== symbol.name) accepted.set(id, name);
  }
  // Reserve all proposed final names, so swaps remain possible. Resolve in source
  // order (never response completion order). Disjoint scopes may share names.
  const adjustments: Record<string,string> = {};
  const within=(scope:Scope, ancestor:Scope):boolean=>{
    for(let current:Scope|null=scope;current;current=current.parent)if(current===ancestor)return true;
    return false;
  };
  // Index bindings by their current final name so each check inspects only
  // same-named bindings instead of every binding in the file.
  const order=new Map([...bindings.keys()].map((id,index)=>[id,index]));
  const finalName=(id:string)=>accepted.get(id)??bindings.get(id)!.identifier.name;
  const byName=new Map<string,Set<string>>();
  const index=(id:string)=>{const name=finalName(id);const ids=byName.get(name)??new Set();ids.add(id);byName.set(name,ids);};
  for(const id of bindings.keys())index(id);
  const freeScopes=new Map<string,Scope[]>();
  for(const reference of freeReferences){const scopes=freeScopes.get(reference.name)??[];scopes.push(reference.scope);freeScopes.set(reference.name,scopes);}
  const collision=(id:string,name:string):string|null=>{
    const scope=bindings.get(id)!.scope;
    // Report the earliest conflicting binding in traversal order, as a full scan would.
    let first=Infinity,reason:string|null=null;
    for(const otherId of byName.get(name)??[]){
      if(otherId===id||order.get(otherId)!>=first)continue;
      const other=bindings.get(otherId)!;
      // Conservative protection: related scopes conflict even without a use
      // at the overlapping site. Sibling functions are intentionally allowed.
      const found=other.scope===scope?'same-scope binding collision':within(scope,other.scope)?'ancestor binding shadowing risk':within(other.scope,scope)?'descendant binding capture risk':null;
      if(found){first=order.get(otherId)!;reason=found;}
    }
    if(reason)return reason;
    if(freeScopes.get(name)?.some(free=>within(free,scope)))return 'unresolved reference capture risk';
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
    byName.get(base)!.delete(id);
    accepted.set(id,candidate);
    index(id);
    adjustments[id]=reason;
  }
  // Edit each binding's own declaration, reference and write nodes. Collecting
  // every node before changing a name keeps swaps safe without temporaries and
  // avoids re-traversing the enclosing scope once per binding.
  const edits: Array<[t.Identifier|t.JSXIdentifier, string]> = [];
  for (const [id, name] of accepted) {
    const binding = bindings.get(id)!, current = binding.identifier.name;
    const nodes = new Set<t.Node>([binding.identifier, ...binding.referencePaths.map(path => path.node)]);
    for (const path of binding.constantViolations) {
      for (const node of Object.values(t.getBindingIdentifiers(path.node, true, true)).flat()) nodes.add(node);
    }
    for (const node of nodes) if ((t.isIdentifier(node) || t.isJSXIdentifier(node)) && node.name === current) edits.push([node, name]);
  }
  for (const [node, name] of edits) node.name = name;
  // A renamed value can no longer share its property key: `{a}` becomes `{a: name}`.
  t.traverseFast(ast, node => {
    if (!t.isObjectProperty(node) || !node.shorthand || !t.isIdentifier(node.key)) return;
    const value = t.isAssignmentPattern(node.value) ? node.value.left : node.value;
    if (!t.isIdentifier(value) || value.name === node.key.name) return;
    node.shorthand = false;
    if (node.extra?.shorthand) node.extra.shorthand = false;
  });
  const output = generate(ast, { comments: true }).code;
  parseCode(output);
  return { code: output, accepted: Object.fromEntries(accepted), rejected, adjustments };
}
