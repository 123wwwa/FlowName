import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import type { Binding, NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { traverse } from './babel.js';
import type { Analysis, Definition, Span, SymbolInfo, Use, Relation } from './types.js';

export const span = (node: t.Node): Span => ({ start: node.start ?? 0, end: node.end ?? 0 });
export const parseCode = (code: string) => parse(code, { sourceType: 'unambiguous', plugins: ['jsx'] });

interface FlowNode { predecessors: number[]; definition?: Definition; use?: Use }
class Unsupported extends Error {}

/** Normal-flow CFG for a deliberately restricted JavaScript subset.
 * Unsupported constructs fall back to all-definitions-per-symbol (not a precise CFG).
 */
export function analyze(code: string): Analysis {
  const ast = parseCode(code);
  const bindings = new Map<Binding, SymbolInfo>();
  const symbolAt = new WeakMap<t.Node, string>();
  const functions: t.Function[] = [];
  const warnings = new Set<string>();
  let dynamicScope = false;
  traverse(ast, {
    Scopable(path) {
      for (const binding of Object.values(path.scope.bindings)) {
        if (bindings.has(binding)) continue;
        const declaration = span(binding.identifier);
        const excluded = binding.kind === 'module';
        bindings.set(binding, {
          id: `s${declaration.start}`, name: binding.identifier.name, kind: binding.kind,
          scope: `${binding.scope.block.type}:${binding.scope.block.start ?? 0}`, declaration,
          references: binding.referencePaths.map(p => span(p.node)), eligible: !excluded,
          ...(excluded ? { exclusion: 'import or exported declaration' } : {}),
        });
      }
    },
    Function(path) { functions.push(path.node); },
    WithStatement() { dynamicScope = true; },
    CallExpression(path) {
      if (t.isIdentifier(path.node.callee, { name: 'eval' })) dynamicScope = true;
    },
  });
  traverse(ast, {
    Identifier(path) {
      const binding = path.scope.getBinding(path.node.name);
      const symbol = binding && bindings.get(binding);
      if (symbol) symbolAt.set(path.node, symbol.id);
    },
    ExportSpecifier(path) {
      if (path.parentPath.isExportNamedDeclaration() && path.parentPath.node.source) return;
      const binding = path.scope.getBinding(path.node.local.name);
      const symbol = binding && bindings.get(binding);
      if (symbol) { symbol.eligible = false; symbol.exclusion = 'exported binding'; }
    },
    'ExportNamedDeclaration|ExportDefaultDeclaration'(path) {
      const declaration=(path.node as t.ExportNamedDeclaration|t.ExportDefaultDeclaration).declaration;
      if(!declaration)return;
      for(const name of Object.keys(t.getOuterBindingIdentifiers(declaration))){
        const binding=path.scope.getBinding(name),symbol=binding&&bindings.get(binding);
        if(symbol){symbol.eligible=false;symbol.exclusion='exported declaration';}
      }
    },
  });
  if (dynamicScope) {
    warnings.add('Direct eval or with: all renames disabled for this module.');
    for (const symbol of bindings.values()) { symbol.eligible = false; symbol.exclusion = 'dynamic scope'; }
  }
  // Cross-function reads or writes require an interprocedural model.
  for (const [binding] of bindings) {
    const owner = binding.scope.getFunctionParent();
    if ([...binding.referencePaths,...binding.constantViolations].some(p => p.scope.getFunctionParent() !== owner)) {
      warnings.add('Closure/cross-function references: conservative reaching definitions.');
    }
  }

  let definitions: Definition[] = [];
  let uses: Use[] = [];
  let nodes: FlowNode[] = [];
  const add = (predecessors: number[], event: Partial<FlowNode> = {}, root = false) => {
    if (!root && !predecessors.length) return [];
    nodes.push({ predecessors, ...event }); return [nodes.length - 1];
  };
  const read = (node: t.Identifier, incoming: number[]) => {
    if (!incoming.length) return incoming;
    const symbol = symbolAt.get(node);
    if (!symbol) return incoming;
    const use: Use = { id: `u${uses.length}`, symbol, span: span(node), definitions: [] };
    uses.push(use); return add(incoming, { use });
  };
  const write = (node: t.Node, incoming: number[], kind: string) => {
    if (!incoming.length) return incoming;
    if (!t.isIdentifier(node)) throw new Unsupported('destructuring assignment/declaration');
    const symbol = symbolAt.get(node);
    if (!symbol) return incoming;
    const definition: Definition = { id: `d${definitions.length}`, symbol, span: span(node), kind };
    definitions.push(definition); return add(incoming, { definition });
  };
  const expr = (node: t.Node | null | undefined, incoming: number[]): number[] => {
    if (!node) return incoming;
    if (t.isIdentifier(node)) return read(node, incoming);
    if (t.isTemplateLiteral(node)) return node.expressions.reduce((next, child) => expr(child, next), incoming);
    if (t.isLiteral(node) || t.isThisExpression(node) || t.isSuper(node) || t.isFunction(node)) return incoming;
    if (t.isAssignmentExpression(node)) {
      let next = incoming;
      if (t.isMemberExpression(node.left)) {
        next = expr(node.left, next);
        return expr(node.right, next); // Heap writes are evidence, not local definitions.
      }
      if (node.operator !== '=') next = expr(node.left, next);
      if (['&&=', '||=', '??='].includes(node.operator)) {
        return [...next, ...write(node.left, expr(node.right, next), 'assignment')];
      }
      return write(node.left, expr(node.right, next), 'assignment');
    }
    if (t.isUpdateExpression(node)) {
      const next = expr(node.argument, incoming);
      return t.isIdentifier(node.argument) ? write(node.argument, next, 'update') : next;
    }
    if (t.isLogicalExpression(node)) {
      const left = expr(node.left, incoming);
      return [...left, ...expr(node.right, left)];
    }
    if (t.isConditionalExpression(node)) {
      const test = expr(node.test, incoming);
      return [...expr(node.consequent, test), ...expr(node.alternate, test)];
    }
    if (t.isMemberExpression(node)) return node.computed ? expr(node.property, expr(node.object, incoming)) : expr(node.object, incoming);
    if (t.isCallExpression(node) || t.isNewExpression(node)) {
      return node.arguments.reduce((next, argument) => expr(argument, next), expr(node.callee, incoming));
    }
    if (t.isBinaryExpression(node)) return expr(node.right, expr(node.left, incoming));
    if (t.isUnaryExpression(node) || t.isSpreadElement(node)) return expr(node.argument, incoming);
    if (t.isSequenceExpression(node)) return node.expressions.reduce((next, child) => expr(child, next), incoming);
    if (t.isArrayExpression(node)) return node.elements.reduce((next, child) => expr(child, next), incoming);
    if (t.isObjectExpression(node)) {
      return node.properties.reduce((next, property) => {
        if (t.isSpreadElement(property)) return expr(property.argument, next);
        if (property.computed) next = expr(property.key, next);
        return t.isObjectProperty(property) ? expr(property.value, next) : next;
      }, incoming);
    }
    throw new Unsupported(node.type);
  };
  interface Loop { breaks: number[]; continues: number[] }
  const statement = (node: t.Node, incoming: number[], loop?: Loop): number[] => {
    if (t.isBlockStatement(node) || t.isProgram(node)) return node.body.reduce((next, child) => statement(child, next, loop), incoming);
    if (t.isExpressionStatement(node)) return expr(node.expression, incoming);
    if (t.isVariableDeclaration(node)) return node.declarations.reduce((next, d) => {
      if (node.kind === 'var' && !d.init) throw new Unsupported('uninitialized/redeclared var');
      return write(d.id, expr(d.init, next), d.init ? 'initializer' : 'uninitialized');
    }, incoming);
    if (t.isIfStatement(node)) {
      const test = expr(node.test, incoming);
      return [...statement(node.consequent, test, loop), ...(node.alternate ? statement(node.alternate, test, loop) : test)];
    }
    if (t.isWhileStatement(node) || t.isForStatement(node)) {
      let next = incoming;
      if (t.isForStatement(node) && node.init) next = t.isVariableDeclaration(node.init) ? statement(node.init, next) : expr(node.init, next);
      const header = add(next);
      const test = expr(node.test, header);
      const state: Loop = { breaks: [], continues: [] };
      let tail = [...statement(node.body, test, state), ...state.continues];
      if (t.isForStatement(node)) tail = expr(node.update, tail);
      if (header.length) nodes[header[0]].predecessors.push(...tail);
      return [...(node.test ? test : []), ...state.breaks];
    }
    if (t.isReturnStatement(node) || t.isThrowStatement(node)) { expr(node.argument, incoming); return []; }
    if (t.isBreakStatement(node) || t.isContinueStatement(node)) {
      if (!loop || node.label) throw new Unsupported('label or non-loop break');
      (t.isBreakStatement(node) ? loop.breaks : loop.continues).push(...incoming); return [];
    }
    if (t.isFunctionDeclaration(node) || t.isEmptyStatement(node) || t.isImportDeclaration(node)) return incoming;
    if (t.isExportNamedDeclaration(node) || t.isExportDefaultDeclaration(node)) {
      return node.declaration ? (t.isStatement(node.declaration) ? statement(node.declaration, incoming, loop) : expr(node.declaration, incoming)) : incoming;
    }
    throw new Unsupported(node.type);
  };
  let flowMode: Analysis['flowMode'] = 'structured-cfg';
  try {
    if (warnings.size || dynamicScope) throw new Unsupported('dynamic or cross-function scope');
    // Reads before var initialization need a hoisting model beyond this first CFG subset.
    for (const [binding] of bindings) {
      if (binding.kind === 'var' && binding.referencePaths.some(p => (p.node.start ?? 0) < (binding.identifier.start ?? 0))) throw new Unsupported('var use before declaration');
    }
    const hoisted = (owner: t.Node, entry: number[]) => {
      for (const [binding] of bindings) {
        if (binding.kind === 'hoisted' && (binding.scope.getFunctionParent()?.block ?? ast.program) === owner) entry = write(binding.identifier, entry, 'hoisted-function');
      }
      return entry;
    };
    const root = hoisted(ast.program, add([], {}, true));
    statement(ast.program, root);
    for (const fn of functions) {
      let entry = hoisted(fn, add([], {}, true));
      for (const param of fn.params) entry = write(param, entry, 'parameter');
      if (t.isBlockStatement(fn.body)) statement(fn.body, entry);
      else expr(fn.body, entry);
    }
    // Monotone fixed point, including loop back-edges.
    const outputs = nodes.map(() => new Set<string>());
    const byId = new Map(definitions.map(d => [d.id, d]));
    let changed = true;
    while (changed) {
      changed = false;
      nodes.forEach((node, index) => {
        const reaching = new Set(node.predecessors.flatMap(p => [...outputs[p]]));
        if (node.use) node.use.definitions = [...reaching].filter(id => byId.get(id)!.symbol === node.use!.symbol).sort();
        if (node.definition) {
          for (const id of reaching) if (byId.get(id)!.symbol === node.definition.symbol) reaching.delete(id);
          reaching.add(node.definition.id);
        }
        if (reaching.size !== outputs[index].size || [...reaching].some(id => !outputs[index].has(id))) {
          outputs[index] = reaching; changed = true;
        }
      });
    }
  } catch (error) {
    if (!(error instanceof Unsupported)) throw error;
    flowMode = 'conservative';
    warnings.add(`Conservative fallback: ${error.message}. Every use may see every definition of its symbol; no heap/interprocedural precision.`);
    definitions = []; uses = []; nodes = [];
    for (const [binding, symbol] of bindings) {
      const locations = [binding.identifier, ...binding.constantViolations.map(p => p.node)];
      for (const node of locations) definitions.push({ id: `d${definitions.length}`, symbol: symbol.id, span: span(node), kind: 'conservative' });
      for (const reference of binding.referencePaths) uses.push({ id: `u${uses.length}`, symbol: symbol.id, span: span(reference.node), definitions: definitions.filter(d => d.symbol === symbol.id).map(d => d.id) });
    }
  }

  const relations: Relation[] = [];
  const seen = new Set<string>();
  const addRelation = (from: string, to: string, kind: Relation['kind'], node: t.Node) => {
    const key = `${from}:${to}:${kind}:${node.start}`;
    if (from === to || seen.has(key)) return;
    seen.add(key); relations.push({ from, to, kind, span: span(node) });
  };
  const references = (path: NodePath): string[] => {
    const ids = new Set<string>();
    if (path.isReferencedIdentifier()) { const id = symbolAt.get(path.node); if (id) ids.add(id); }
    path.traverse({
      Function(p) { p.skip(); },
      ReferencedIdentifier(p) { const id = symbolAt.get(p.node); if (id) ids.add(id); },
    });
    return [...ids];
  };
  traverse(ast, {
    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.id) || !path.node.init) return;
      const target = symbolAt.get(path.node.id);
      if (target) for (const source of references(path.get('init') as NodePath)) addRelation(source, target, 'assignment', path.node);
    },
    AssignmentExpression(path) {
      if (!t.isIdentifier(path.node.left)) return;
      const target = symbolAt.get(path.node.left);
      if (target) for (const source of references(path.get('right'))) addRelation(source, target, 'assignment', path.node);
    },
    CallExpression(path) {
      const ids = references(path);
      // A star avoids quadratic relation growth for large argument lists.
      for (const id of ids.slice(1)) addRelation(ids[0], id, 'co-use', path.node);
    },
  });
  return {
    version: 1, sourceHash: createHash('sha256').update(code).digest('hex'),
    symbols: [...bindings.values()].sort((a, b) => a.declaration.start - b.declaration.start),
    definitions, uses, relations, warnings: [...warnings], flowMode,
  };
}
