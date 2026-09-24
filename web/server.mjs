import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateOptions} from './options.js';
export function createPlayground({spawnWorker=(data)=>new Worker(new URL('./worker.mjs',import.meta.url),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:256}})}={}){
 let active=0;
 return createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
  for(const [k,v] of Object.entries(headers))res.setHeader(k,v);
  const fail=(status,message)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:message}));};
  if(req.method==='GET'){
   const files={'/':'index.html','/app.js':'app.js','/transport.js':'transport.js','/options.js':'options.js','/style.css':'style.css'};const file=files[req.url];if(!file)return fail(404,'Not found');
   try{const content=await readFile(new URL(file,import.meta.url));res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(content);}catch{fail(500,'Asset unavailable');}return;
  }
  if(req.method!=='POST'||req.url!=='/api/recover')return fail(404,'Not found');
  // JSON + same-origin browser requests only; arbitrary upstream URLs are never accepted.
  if(req.headers['sec-fetch-site']==='cross-site')return fail(403,'Cross-origin request blocked');
  if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return fail(403,'Origin mismatch');}catch{return fail(403,'Invalid origin');}}
  if(!req.headers['content-type']?.startsWith('application/json'))return fail(415,'JSON required');
  if(active>=2)return fail(429,'Playground busy. Try again shortly.');
  active++;let worker,timer;let released=false;
  const cleanup=()=>{if(released)return;released=true;active--;clearTimeout(timer);worker?.terminate();};
  res.on('close',cleanup);
  timer=setTimeout(()=>{if(!res.headersSent)fail(408,'Upload timed out');else res.end();cleanup();},15000);
  try{
   let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>600000){fail(413,'Input too large (max 512 KB source).');cleanup();return;}chunks.push(chunk);}
   if(released)return;
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{fail(400,'Invalid JSON');cleanup();return;}
   const {source,apiKey,model,provider}=input??{};
   if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>524288||typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>4096||typeof model!=='string'||!model.trim()||model.length>200||!['gemini','openai','groq'].includes(provider)){fail(400,'Source, API key, provider and model are required within limits.');cleanup();return;}
   let options;try{options=validateOptions(input.options);}catch(error){fail(400,error.message);cleanup();return;}
   res.writeHead(200,{'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'});res.flushHeaders();
   clearTimeout(timer);timer=setTimeout(()=>{res.end(JSON.stringify({type:'fatal',error:'Session time limit reached (20 minutes). Completed suggestions remain visible.'})+'\n');cleanup();},1200000);
   worker=spawnWorker({source,apiKey,model,provider,options});
   worker.on('message',event=>{if(released)return;const line=JSON.stringify(event).split(apiKey).join('[REDACTED]')+'\n';if(!res.write(line)&&res.writableLength>4194304){res.end();cleanup();return;}if(['complete','fatal'].includes(event.type)){res.end();cleanup();}});
   worker.on('error',()=>{if(!released){res.end(JSON.stringify({type:'fatal',error:'Recovery worker failed.'})+'\n');cleanup();}});
   worker.on('exit',()=>{if(!released){res.end(JSON.stringify({type:'fatal',error:'Recovery worker exited before completion.'})+'\n');cleanup();}});
  }catch{if(!released){if(!res.headersSent)fail(400,'Request failed');else res.end();cleanup();}}
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createPlayground();server.requestTimeout=20000;server.headersTimeout=15000;
 server.listen(Number(process.env.PORT??4173),process.env.HOST??'127.0.0.1',()=>console.log(`FlowName playground: http://${process.env.HOST??'127.0.0.1'}:${server.address().port}`));
}
