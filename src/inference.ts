import { promptFor } from './grouping.js';
import type { InferenceRequest, InferenceResult, Provider } from './types.js';
import {isValidIdentifier} from '@babel/types';

export class ModelResponseError extends Error {
  constructor(message:string,public rawResponse:string,public httpStatus:number,public usage?:Record<string,unknown>,public retryAfterMs?:number) {super(message);}
}
export class ModelFormatError extends ModelResponseError {}

/** Parseable answers are evaluated per ID; never salvage fragments of invalid JSON. */
export function acceptResponse(value:unknown,request:InferenceRequest){
  if(!value || typeof value!=='object' || !('names' in value) || !value.names || typeof value.names!=='object' || Array.isArray(value.names))throw new Error('Response must contain a names object.');
  const raw=value.names as Record<string,unknown>;
  const names:Record<string,string>={},unresolved:Record<string,string>={};
  const expected=new Set(request.targets.map(s=>s.id));
  for(const id of expected){
    const name=Object.hasOwn(raw,id)?raw[id]:undefined;
    if(typeof name!=='string'||name.length>256||!isValidIdentifier(name)||['arguments','eval','await','yield'].includes(name))unresolved[id]=name===undefined?'Missing target ID.':'Invalid identifier value.';
    else names[id]=name;
  }
  return {names,validation:{unresolved,ignoredIds:Object.keys(raw).filter(id=>!expected.has(id))}};
}

/** Plumbing-only test double: does not simulate semantic naming quality or token usage. */
export class MockProvider implements Provider {
  label = 'mock (not a semantic model)';
  async infer(request: InferenceRequest): Promise<InferenceResult> {
    return { names: Object.fromEntries(request.targets.map(s => [s.id, `recovered_${s.id}`])), inputTokens: null, outputTokens: null };
  }
}

export function validateResponse(value: unknown, request: InferenceRequest): Record<string, string> {
  if (!value || typeof value !== 'object' || !('names' in value)) throw new Error('Response must contain names.');
  const names = value.names;
  if (!names || typeof names !== 'object' || Array.isArray(names)) throw new Error('names must be an object.');
  const expected = new Set(request.targets.map(s => s.id));
  if (Object.keys(names).length !== expected.size || Object.entries(names).some(([id, name]) => !expected.has(id) || typeof name !== 'string' || name.length>256)) throw new Error('Response must contain exactly the requested symbol IDs and string names.');
  return names as Record<string, string>;
}

export function requestBody(request:InferenceRequest,model:string){
  const reserve=(request as InferenceRequest & {budgeting?:{outputReserveTokens?:number}}).budgeting?.outputReserveTokens;
  if(reserve!==undefined&&(!Number.isSafeInteger(reserve)||reserve<1||reserve>65536))throw new Error('Invalid output token limit.');
  return {model,temperature:0,messages:[{role:'user',content:promptFor(request)}],response_format:{type:'json_object'},...(reserve===undefined?{}:{max_tokens:reserve})};
}

/** Generic chat-completions compatible endpoint; no SDK or provider lock-in. */
export class CompatibleProvider implements Provider {
  label: string;
  constructor(private config: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number; maxResponseBytes?:number; maxPromptBytes?:number }) {
    this.label = config.model;
    if(!config.apiKey?.trim()||!config.model?.trim())throw new Error('API key and model must be non-empty.');
    for(const limit of [config.timeoutMs??60000,config.maxResponseBytes??4194304,config.maxPromptBytes??1048576])if(!Number.isSafeInteger(limit)||limit<1)throw new Error('Provider limits must be positive integers.');
    const url = new URL(config.baseUrl);
    if(url.username||url.password||url.search||url.hash)throw new Error('Endpoint must not contain credentials, query or fragment.');
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Endpoint must be HTTP(S).');
  }
  async infer(request: InferenceRequest): Promise<InferenceResult> {
    const prompt=promptFor(request);
    if(Buffer.byteLength(prompt)> (this.config.maxPromptBytes??1048576))throw new Error('Prompt byte limit exceeded before API request.');
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', redirect:'error', signal: AbortSignal.timeout(this.config.timeoutMs ?? 60000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(requestBody(request,this.config.model)),
    });
    // Keep provider body even when JSON/ID validation fails. Never record auth headers.
    const reader=response.body?.getReader();
    const chunks:Uint8Array[]=[];let size=0;
    if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>(this.config.maxResponseBytes??4194304)){await reader.cancel();throw new ModelResponseError('Response byte limit exceeded (body omitted).','',response.status);}
      chunks.push(value);
    }}finally{reader.releaseLock();}
    const rawResponse=Buffer.concat(chunks).toString('utf8').split(this.config.apiKey).join('[REDACTED]');
    const retryHeader=response.headers.get('retry-after');
    const retryAfterMs=retryHeader===null?undefined:Math.max(0,/^\d+(\.\d+)?$/.test(retryHeader)?Number(retryHeader)*1000:Date.parse(retryHeader)-Date.now());
    if (!response.ok) throw new ModelResponseError(`Model endpoint returned HTTP ${response.status}.`,rawResponse,response.status,undefined,Number.isFinite(retryAfterMs)?retryAfterMs:undefined);
    let data: { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; [key: string]: unknown } };
    try {data=JSON.parse(rawResponse);}catch {throw new ModelResponseError('Model endpoint returned invalid JSON.',rawResponse,response.status);}
    if(!data||typeof data!=='object'||!Array.isArray(data.choices))throw new ModelResponseError('Invalid response envelope.',rawResponse,response.status);
    const content = data.choices?.[0]?.message?.content;
    if (typeof content!=='string'||!content) throw new ModelFormatError('Model returned no content.',rawResponse,response.status,data.usage);
    const tokenCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    let parsed:ReturnType<typeof acceptResponse>;
    try {parsed=acceptResponse(JSON.parse(content),request);}catch(error){throw new ModelFormatError(error instanceof Error?error.message:String(error),rawResponse,response.status,data.usage);}
    return {
      ...parsed,
      inputTokens: tokenCount(data.usage?.prompt_tokens), outputTokens: tokenCount(data.usage?.completion_tokens),
      usage: data.usage,
      rawResponse, httpStatus:response.status,
    };
  }
}
