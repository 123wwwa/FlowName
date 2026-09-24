import { createHash } from 'node:crypto';
import type { NodePath, Binding } from '@babel/traverse';
import * as t from '@babel/types';
import { parseCode, span } from './analysis.js';
import { budgetedRequests } from './request-budget.js';
import { traverse } from './babel.js';
import type { Analysis, Relation, SymbolInfo, InferenceRequest } from './types.js';

/** Lexical evidence only: no CFG, reaching definitions, alias or call resolution. */
export function lightweight(code: string): Analysis {
  if(Buffer.byteLength(code)>8*1024*1024)throw new Error('Analysis source exceeds 8 MiB limit.');
  const deadline=Date.now()+30000;
  const check=()=>{if(Date.now()>deadline)throw new Error('Analysis time budget exceeded.');};
  const ast = parseCode(code);
  const bindings = new Map<Binding, SymbolInfo>();
  let dynamic = false;
  traverse(ast, {
    Scopable(p) { check();for (const b of Object.values(p.scope.bindings)) if (!bindings.has(b)) bindings.set(b, {
      id: `s${b.identifier.start}`, name: b.identifier.name, kind: b.kind,
      scope: `${b.scope.block.type}:${b.scope.block.start ?? 0}`, declaration: span(b.identifier),
      references: b.referencePaths.map(r => span(r.node)),
      eligible: b.kind !== 'module' && !b.path.findParent(q => q.isExportDeclaration()),
      ...(b.path.isFunctionDeclaration() || b.path.isFunctionExpression() || (b.path.isVariableDeclarator() && t.isFunction(b.path.node.init)) ? {namingRole:'function' as const} : b.path.isClassDeclaration() || b.path.isClassExpression() || (b.path.isVariableDeclarator() && t.isClassExpression(b.path.node.init)) ? {namingRole:'class' as const} : {}),
    }); },
    WithStatement() { dynamic = true; },
    CallExpression(p) { if (t.isIdentifier(p.node.callee, {name:'eval'}) && !p.scope.getBinding('eval')) dynamic = true; },
    ExportSpecifier(p) { const b=p.scope.getBinding(p.node.local.name); if(b && bindings.has(b)) bindings.get(b)!.eligible=false; },
  });
  const id = (p: NodePath) => p.isIdentifier() ? bindings.get(p.scope.getBinding(p.node.name)!)?.id : undefined;
  const refs = (p: NodePath): string[] => {
    check();
    const found = new Set<string>();
    if (p.isReferencedIdentifier()) { const s=id(p); if(s) found.add(s); }
    // Nested function bodies are not dependencies of the enclosing expression.
    if (!p.isFunction()) p.traverse({ Function(q) { q.skip(); }, ReferencedIdentifier(q) {const s=id(q);if(s)found.add(s);} });
    return [...found];
  };
  const relations: Relation[]=[];
  const add=(from:string|undefined,to:string|undefined,kind:Relation['kind'],p:NodePath,property?:string)=>{
    check();if(relations.length>=100000)throw new Error('Analysis relation limit exceeded.');
    if(from&&to)relations.push({from,to,kind,span:span(p.node),...(property!==undefined?{property}:{})});
  };
  traverse(ast, {
    VariableDeclarator(p) {for(const to of refs(p.get('init') as NodePath))add(id(p.get('id')),to,'assignment',p);},
    AssignmentExpression(p) {for(const to of refs(p.get('right')))add(id(p.get('left')),to,'assignment',p);},
    MemberExpression(p) {
      const objects=refs(p.get('object'));
      const property=!p.node.computed&&t.isIdentifier(p.node.property)?p.node.property.name: t.isStringLiteral(p.node.property)?p.node.property.value:'[computed]';
      for(const a of objects) {add(a,a,'property',p,property);if(p.node.computed)for(const b of refs(p.get('property') as NodePath))add(a,b,'property',p,property);}
    },
    CallExpression(p) {
      const participants=[...new Set([...refs(p.get('callee') as NodePath),...p.get('arguments').flatMap(q=>refs(q as NodePath))])];
      for(let i=0;i<participants.length;i++)for(let j=i+1;j<participants.length;j++)add(participants[i],participants[j],'argument',p);
    },
    ReturnStatement(p) {
      const fn=p.getFunctionParent();
      if(fn?.isFunctionDeclaration()&&fn.node.id)for(const to of refs(p.get('argument') as NodePath))add(id(fn.get('id') as NodePath),to,'return',p);
    },
  });
  if(dynamic)for(const s of bindings.values())s.eligible=false;
  return {version:1,sourceHash:createHash('sha256').update(code).digest('hex'),symbols:[...bindings.values()].sort((a,b)=>a.declaration.start-b.declaration.start),relations,definitions:[],uses:[],flowMode:'lexical-relations',warnings:dynamic?['Direct eval/with: renaming disabled.']:[]};
}

export type ResearchMethod = 'local-500' | 'file-batch' | 'relation-guided' | 'relation-guided-scope' | 'budgeted';
export interface GroupingInfo { kind:'relation'|'scope-fallback'|'singleton'; singletonOrigins:Record<string,'no-target-neighbor'|'split-isolated'>; }
export type ResearchRequest=InferenceRequest & {grouping?:GroupingInfo;budgeting?:unknown};
export function researchRequests(code:string, analysis:Analysis, targetIds:string[], method:ResearchMethod):ResearchRequest[] {
  if(method==='budgeted')return budgetedRequests(code,analysis,targetIds);
  const relational=method==='relation-guided'||method==='relation-guided-scope';
  const targets=targetIds.map(id=>{const s=analysis.symbols.find(s=>s.id===id&&s.eligible);if(!s)throw new Error('Unknown target');return s;});
  if(method==='file-batch')return [{targets:targets.map(s=>({...s,references:[]})),context:`\n/* excerpt [0,${code.length}); may be partial */\n${code}\n`,relations:[],defUses:[],definitions:[]}];
  const remaining=new Set(targetIds), groups:SymbolInfo[][]=[];
  while(remaining.size){
    const queue=[remaining.values().next().value!], group:SymbolInfo[]=[];
    while(queue.length&&group.length<(method==='local-500'?1:4)){
      const id=queue.shift()!;if(!remaining.delete(id))continue;group.push(targets.find(s=>s.id===id)!);
      if(relational)for(const r of analysis.relations){if(r.from===id&&remaining.has(r.to))queue.push(r.to);if(r.to===id&&remaining.has(r.from))queue.push(r.from);}
    }
    groups.push(group);
  }
  const origins:GroupingInfo['singletonOrigins']={};
  const targetSet=new Set(targetIds);
  if(relational)for(const group of groups)if(group.length===1){
    const id=group[0]!.id;
    // Self-property facts do not connect distinct recovery targets.
    const connected=analysis.relations.some(r=>r.from!==r.to&&targetSet.has(r.from)&&targetSet.has(r.to)&&(r.from===id||r.to===id));
    origins[id]=connected?'split-isolated':'no-target-neighbor';
  }
  const fallback=new Set<SymbolInfo[]>();
  let finalGroups=groups;
  if(method==='relation-guided-scope'){
    const scopes=new Map<string,SymbolInfo[]>();
    for(const group of groups)if(group.length===1){const symbol=group[0]!;const list=scopes.get(symbol.scope)??[];list.push(symbol);scopes.set(symbol.scope,list);}
    finalGroups=groups.filter(g=>g.length>1);
    for(const list of scopes.values()){
      list.sort((a,b)=>a.declaration.start-b.declaration.start);
      for(let i=0;i<list.length;i+=4){const group=list.slice(i,i+4);finalGroups.push(group);if(group.length>1)fallback.add(group);}
    }
    finalGroups.sort((a,b)=>a[0]!.declaration.start-b[0]!.declaration.start);
  }
  return finalGroups.map(group=>{
    const ids=new Set(group.map(s=>s.id));
    const evidence=relational?analysis.relations.filter(r=>ids.has(r.from)||ids.has(r.to)):[];
    let ranges:Array<[number,number]>=[];
    {
      // Fixed budgets: 500 local chars or at most 1600 source chars per relation group.
      const width=method==='local-500'?500:160;
      const positions=group.map(s=>s.declaration.start);
      if(relational)positions.push(...evidence.map(r=>r.span.start),...group.flatMap(s=>s.references.map(r=>r.start)));
      let used=0;
      for(const position of positions){
        const start=Math.max(0,Math.min(code.length-width,position-Math.floor(width/3))),end=Math.min(code.length,start+width);
        const candidate=[...ranges,[start,end] as [number,number]].sort((a,b)=>a[0]-b[0]);
        const merged:Array<[number,number]>=[];
        for(const range of candidate){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
        const size=merged.reduce((n,[a,b])=>n+b-a,0);
        if(size<=(method==='local-500'?500:1600)){ranges=merged;used=size;}
      }
      if(!used||group.some(s=>!ranges.some(([a,b])=>a<=s.declaration.start&&b>=s.declaration.end)))throw new Error('Declaration omitted');
    }
    const visible=new Set(analysis.symbols.filter(s=>ranges.some(([a,b])=>s.declaration.start>=a&&s.declaration.end<=b)).map(s=>s.id));
    // No dangling symbol IDs in transmitted evidence. Non-target bindings remain code context.
    const relations=evidence.filter(r=>ids.has(r.from)&&ids.has(r.to)&&visible.has(r.from)&&visible.has(r.to));
    return {...(relational?{grouping:{kind:group.length===1?'singleton' as const:fallback.has(group)?'scope-fallback' as const:'relation' as const,singletonOrigins:Object.fromEntries(group.filter(s=>origins[s.id]).map(s=>[s.id,origins[s.id]!]))}}:{}),targets:group.map(s=>({...s,references:[]})),context:ranges.map(([a,b])=>`\n/* excerpt [${a},${b}); may be partial */\n${code.slice(a,b)}\n`).join(''),relations,defUses:[],definitions:[]};
  });
}
