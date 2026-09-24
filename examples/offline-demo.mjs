// UI demonstration only: deterministic local fixture, no LLM/API or quality claim.
import {recoverNames} from '../package-dist/library.js';
import {createHtmlReporter} from '../package-dist/html-reporter.js';
const reporter=await createHtmlReporter('demo-report-'+Date.now());
const source='function a(b,c){const d=b.filter(e=>e.active);return d.slice(0,c);} globalThis.selected=a([{active:true}],1);';
const names={a:'selectActiveItems',b:'items',c:'limit',d:'activeItems',e:'item'};
const provider={label:'OFFLINE UI FIXTURE',async infer(request){await new Promise(r=>setTimeout(r,400));return {names:Object.fromEntries(request.targets.map(s=>[s.id,names[s.name]??s.name])),inputTokens:null,outputTokens:null};}};
console.log(reporter.path);await recoverNames(source,{provider,rpm:6000,maxTargets:2,onEvent:reporter.onEvent});
