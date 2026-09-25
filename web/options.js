export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const providerEndpoints = Object.freeze({
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
});

export function validateInput(input = {}) {
  const {source, apiKey, model, provider} = input ?? {};
  const fail = (field, message) => { throw Object.assign(new Error(message), {field}); };
  if (typeof source !== 'string' || !source.trim()) fail('source', 'Source code is required.');
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > MAX_SOURCE_BYTES) fail('source', `Source is too large: ${bytes.toLocaleString('en-US')} UTF-8 bytes. Maximum: 8 MiB (${MAX_SOURCE_BYTES.toLocaleString('en-US')} bytes). Source has not been truncated or sent.`);
  if (typeof apiKey !== 'string' || !apiKey.trim()) fail('key', 'API key is required. Enter your key before starting a run.');
  if (apiKey.length > 4096) fail('key', 'API key is too long: maximum 4,096 characters.');
  if (typeof model !== 'string' || !model.trim()) fail('model', 'Model ID is required.');
  if (model.length > 200) fail('model', 'Model ID is too long: maximum 200 characters.');
  if (typeof provider !== 'string' || !Object.hasOwn(providerEndpoints, provider)) fail('provider', 'Unsupported API provider. Choose Gemini, OpenAI or Groq.');
  return bytes;
}

export const optionSpecs = {
  requestPropagation: {value:'off', choices:['Independent (default)', 'Linked names (experimental)'], choiceValues:['off','linked'], label:'Names between requests', help:'Linked requests wait for related earlier groups and receive bounded, unverified name hints. May increase tokens and latency; unrelated groups remain parallel.'},
  contextMode: {value:'usage', choices:['Bounded uses (default)', 'Declarations only (baseline)'], choiceValues:['usage','declarations'], label:'Source context', help:'Adds short use excerpts within remaining budget, without changing groups. No full switch cases.'},
  promptFormat: {value:'compact', choices:['Compact (default)', 'Verbose (previous format)'], choiceValues:['compact','verbose'], label:'Prompt format', help:'Compact keeps IDs, declaration offsets, source and relation facts while removing analysis metadata.'},
  passes: {value: 1, min: 1, max: 2, label: 'Recovery mode', choices: ['Single pass (default)', 'Two passes (experimental)'], help: 'Two passes propagate function/class names first and may increase requests, tokens and time.'},
  concurrency: {value: 16, min: 1, max: 32, label: 'Concurrent requests', help: 'Maximum in-flight API requests.'},
  rpm: {value: 60, min: 1, max: 6000, label: 'Requests per minute', help: 'Request starts are paced. Match your provider quota.'},
  maxCalls: {value: 1000, min: 1, max: 10000, label: 'Maximum API calls', help: 'A larger plan stops before sending any requests.'},
  promptBytes: {value: 12000, min: 1024, max: 1048576, label: 'Prompt budget (bytes)', help: 'UTF-8 bytes per prompt, not a token count.'},
  maxTargets: {value: 16, min: 1, max: 64, label: 'Identifiers per request', help: 'Maximum group size; the prompt budget may reduce it.'},
};

export function validateOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Recovery options must be an object.');
  const result = {};
  for (const [key, spec] of Object.entries(optionSpecs)) {
    const value = input[key] === undefined ? spec.value : input[key];
    if (spec.choiceValues) {
      if(!spec.choiceValues.includes(value))throw new Error(`${key} must be ${spec.choiceValues.join(' or ')}.`);
      result[key]=value;continue;
    }
    if (!Number.isSafeInteger(value) || value < spec.min || value > spec.max) {
      throw new Error(`${key} must be an integer from ${spec.min} to ${spec.max}.`);
    }
    result[key] = value;
  }
  return result;
}
