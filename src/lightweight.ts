import { createHash } from 'node:crypto';
import type { NodePath, Binding } from '@babel/traverse';
import * as t from '@babel/types';
import { parseCode, span } from './analysis.js';
import { traverse } from './babel.js';
import {collectUsage} from './usage-context.js';
import type { Analysis, Relation, SymbolInfo } from './types.js';

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
      eligible: b.kind !== 'module',
      ...(b.path.isFunctionDeclaration() || b.path.isFunctionExpression() || (b.path.isVariableDeclarator() && t.isFunction(b.path.node.init)) ? {namingRole:'function' as const} : b.path.isClassDeclaration() || b.path.isClassExpression() || (b.path.isVariableDeclarator() && t.isClassExpression(b.path.node.init)) ? {namingRole:'class' as const} : {}),
    }); },
    WithStatement() { dynamic = true; },
    CallExpression(p) { if (t.isIdentifier(p.node.callee, {name:'eval'})) dynamic = true; },
    ExportSpecifier(p) {
      // A re-export references another module, not a same-spelled local binding.
      if (p.parentPath.isExportNamedDeclaration() && p.parentPath.node.source) return;
      const b=p.scope.getBinding(p.node.local.name);
      if(b && bindings.has(b)) bindings.get(b)!.eligible=false;
    },
    'ExportNamedDeclaration|ExportDefaultDeclaration'(p) {
      const declaration=(p.node as t.ExportNamedDeclaration|t.ExportDefaultDeclaration).declaration;
      if (!declaration) return;
      // Protect the public declaration only, not parameters or implementation locals.
      for (const name of Object.keys(t.getOuterBindingIdentifiers(declaration))) {
        const binding=p.scope.getBinding(name);
        if (binding && bindings.has(binding)) bindings.get(binding)!.eligible=false;
      }
    },
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
  let truncated=false;
  const add=(from:string|undefined,to:string|undefined,kind:Relation['kind'],p:NodePath,property?:string)=>{
    // Relations only guide grouping, so a very large file keeps the first 100,000 instead of failing.
    check();if(relations.length>=100000){truncated=true;return;}
    if(from&&to)relations.push({from,to,kind,span:span(p.node),...(property!==undefined?{property}:{})});
  };
  traverse(ast, {
    VariableDeclarator(p) {if(truncated)return;for(const to of refs(p.get('init') as NodePath))add(id(p.get('id')),to,'assignment',p);},
    AssignmentExpression(p) {if(truncated)return;for(const to of refs(p.get('right')))add(id(p.get('left')),to,'assignment',p);},
    MemberExpression(p) {
      if(truncated)return;
      const objects=refs(p.get('object'));
      const property=!p.node.computed&&t.isIdentifier(p.node.property)?p.node.property.name: t.isStringLiteral(p.node.property)?p.node.property.value:'[computed]';
      for(const a of objects) {add(a,a,'property',p,property);if(p.node.computed)for(const b of refs(p.get('property') as NodePath))add(a,b,'property',p,property);}
    },
    CallExpression(p) {
      if(truncated)return;
      const participants=[...new Set([...refs(p.get('callee') as NodePath),...p.get('arguments').flatMap(q=>refs(q as NodePath))])];
      for(let i=0;i<participants.length;i++)for(let j=i+1;j<participants.length;j++)add(participants[i],participants[j],'argument',p);
    },
    ReturnStatement(p) {
      if(truncated)return;
      const fn=p.getFunctionParent();
      if(fn?.isFunctionDeclaration()&&fn.node.id)for(const to of refs(p.get('argument') as NodePath))add(id(fn.get('id') as NodePath),to,'return',p);
    },
  });
  if(dynamic)for(const s of bindings.values())s.eligible=false;
  const usageContexts=Object.fromEntries([...bindings].map(([binding,symbol])=>{check();return [symbol.id,collectUsage(binding)];}));
  return {usageContexts,version:1,sourceHash:createHash('sha256').update(code).digest('hex'),symbols:[...bindings.values()].sort((a,b)=>a.declaration.start-b.declaration.start),relations,definitions:[],uses:[],flowMode:'lexical-relations',warnings:[...(dynamic?['Direct eval/with: renaming disabled.']:[]),...(truncated?['Relation limit reached (100,000): later bindings are grouped by scope only.']:[])]};
}
