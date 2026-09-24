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


test('unresolved assignment, pattern, loop and update writes cannot be captured',()=>{
 const writes=['total=2','total+=2','total++','({value:total}={value:2})','[total]=[2]','for(total of [2]){}','for(total in {x:1}){}'];
 for(const write of writes){
  const {r}=check('function f(){let a=1;'+write+';return a;}',{a:'total'},'JSON.stringify([f(),total])',{total:10});
  assert.deepEqual(Object.values(r.accepted),['total2'],write);
  assert.match(Object.values(r.adjustments)[0],/unresolved reference/,write);
 }
 const {r}=check('function f(){let a=1;total=2;return a;}',{a:'total'},'JSON.stringify([f(),globalThis.total])');
 assert.deepEqual(Object.values(r.accepted),['total2']);
 // A property write is not a free identifier write.
 const property=check('function f(){let a=1;obj.total=2;return a;}',{a:'total'},'f()',{obj:{}});
 assert.deepEqual(Object.values(property.r.accepted),['total']);
});

test('JSX component classification and unresolved JSX references are protected',()=>{
 const source='function A(){return null;}const b=<><A/><A></A></>;';
 const analysis=lightweight(source),id=analysis.symbols.find(s=>s.name==='A').id;
 const rejected=rename(source,analysis,{[id]:'widget'});
 assert.equal(rejected.accepted[id],undefined);assert.match(rejected.rejected[id],/intrinsic tag/);
 assert.match(rejected.code,/<A/);
 const renamed=rename(source,analysis,{[id]:'Widget'});
 assert.equal(renamed.accepted[id],'Widget');assert.match(renamed.code,/<Widget/);
 for(const source of ['const a=1;const b=<External/>;','const a=1;const b=<External.Part/>;']){
  const analysis=lightweight(source),id=analysis.symbols.find(s=>s.name==='a').id;
  assert.equal(rename(source,analysis,{[id]:'External'}).accepted[id],'External2');
 }
 // The root of a JSX member expression may be lowercase without becoming a tag string.
 const member='const A={Item:()=>null};const b=<A.Item/>;';
 const ma=lightweight(member),mid=ma.symbols.find(s=>s.name==='A').id;
 assert.match(rename(member,ma,{[mid]:'widgets'}).code,/<widgets.Item/);
});
