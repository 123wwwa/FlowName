import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {lightweight} from '../dist/lightweight.js';
import {rename} from '../dist/rename.js';
function check(code, proposals, expression, env={}) {
  const a=lightweight(code);
  const names=Object.fromEntries(a.symbols.filter(s=>proposals[s.name]).map(s=>[s.id,proposals[s.name]]));
  const r=rename(code,a,names);
  assert.equal(runInNewContext(r.code+';'+expression,{...env}),runInNewContext(code+';'+expression,{...env}));
  assert.deepEqual(r,rename(code,a,Object.fromEntries(Object.entries(names).reverse())));
  return {a,names,r};
}
test('sibling scopes reuse a name and ignore globals used only in siblings',()=>{
  const {r}=check('function f(a){a++;return {a};} function g(b){return b+external;} ',{a:'external',b:'external'},'JSON.stringify([f(2),g(3)])',{external:10});
  assert.deepEqual(Object.values(r.accepted),['external','external2']);
  assert.equal(Object.keys(r.adjustments).length,1);
  const both=check('function f(a){return a+1;} function g(b){return b*2;}',{a:'value',b:'value'},'f(3)+g(4)');
  assert.deepEqual(Object.values(both.r.accepted),['value','value']);
});
test('same-scope duplicates and numeric suffixes are adjusted deterministically',()=>{
  const {r}=check('function f(a,b,value3){a+=1; return a+b+value3;}',{a:'value2',b:'value2'},'f(1,2,3)');
  assert.deepEqual(Object.values(r.accepted),['value4','value2']);
});
test('ancestor and descendant captures preserve closures and writes',()=>{
  check('let value=7; function f(a){return ()=>value+a;}',{a:'value'},'f(3)()');
  check('let a=1; function f(){let value=4; a++;return a+value;}',{a:'value'},'f()+f()');
});
