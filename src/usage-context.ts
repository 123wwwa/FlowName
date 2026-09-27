import type {Binding,NodePath} from '@babel/traverse';
import type {UsageContext,Span} from './types.js';

/** Bounded lexical use selection; no second parse, CFG or cross-request state. */
export function collectUsage(binding:Binding):UsageContext[]{
 const candidate=(ref:NodePath):UsageContext=>{
  let selected:NodePath=ref,guards:UsageContext['guards']=[];
  for(let p:NodePath|null=ref.parentPath,depth=0;p&&depth<12;p=p.parentPath,depth++){
   if(p.isFunction())break;
   if(p.isIfStatement()){
    const test=p.node.test;
    if(ref.node.start!>=test.start!&&ref.node.end!<=test.end!)selected=p.get('test') as NodePath;
    else if(test.end!-test.start!<=100){
     const branch=ref.node.start!>=p.node.consequent.start!&&ref.node.end!<=p.node.consequent.end!?'then':p.node.alternate&&ref.node.start!>=p.node.alternate.start!&&ref.node.end!<=p.node.alternate.end!?'else':undefined;
     if(branch)guards.push({kind:`if test (${branch} branch)`,span:{start:test.start!,end:test.end!}});
    }
   }
   else if(p.isExpressionStatement()||p.isReturnStatement()||p.isVariableDeclarator()){
    if(p.node.end!-p.node.start!<=240)selected=p;
   }
   if(p.isSwitchCase()&&p.node.test&&p.parentPath?.isSwitchStatement()){
    const discriminant=p.parentPath.node.discriminant,test=p.node.test;
    if(discriminant.end!-discriminant.start!<=100&&test.end!-test.start!<=60)
     guards=[{kind:'switch discriminant',span:{start:discriminant.start!,end:discriminant.end!}},{kind:'case label (fallthrough possible)',span:{start:test.start!,end:test.end!}}];
    break;
   }
  }
  if(selected.node.end!-selected.node.start!>240)selected=ref;
  const span:Span={start:selected.node.start!,end:selected.node.end!};
  return {span,guards};
 };
 const rank=(paths:NodePath[])=>paths.map(candidate).sort((a,b)=>b.guards.length-a.guards.length||a.span.start-b.span.start);
 const reads=rank(binding.referencePaths.slice(0,32));
 const writes=rank(binding.constantViolations.filter(p=>p.isAssignmentExpression()||p.isUpdateExpression()).slice(0,32));
 const unique=new Map<string,UsageContext>();
 for(const c of [reads[0],writes[0],...reads.slice(1),...writes.slice(1)]){
  if(!c)continue;
  unique.set(JSON.stringify(c),c);if(unique.size===2)break;
 }
 return [...unique.values()];
}
