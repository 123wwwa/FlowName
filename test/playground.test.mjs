import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayground} from '../web/server.mjs';
test('playground serves UI and rejects unsafe or invalid API requests without upstream calls',async()=>{
 const server=createPlayground();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/id="stop"/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/api/recover',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.invalid'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  assert.equal((await fetch(base+'/api/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'let a=1',apiKey:'fixture',model:'model',provider:'http://localhost'})})).status,400);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('disconnect stops worker and streamed events do not leak supplied key',async()=>{
 const {EventEmitter}=await import('node:events');let terminated=false;
 const server=createPlayground({spawnWorker:()=>{const w=new EventEmitter();w.terminate=()=>{terminated=true;};setTimeout(()=>w.emit('message',{type:'request',index:0,note:'fixture-secret'}),10);return w;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/recover`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'let a=1',apiKey:'fixture-secret',model:'m',provider:'gemini'})});
  const reader=response.body.getReader();const event=new TextDecoder().decode((await reader.read()).value);assert.match(event,/request/);assert.ok(!event.includes('fixture-secret'));await reader.cancel();
  for(let i=0;i<20&&!terminated;i++)await new Promise(r=>setTimeout(r,10));assert.equal(terminated,true);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
