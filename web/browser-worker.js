import {recoverNames, CompatibleProvider} from '../src/library.ts';

const endpoints = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
};
let started = false;
self.onmessage = async ({data}) => {
  if (started) return;
  started = true;
  const {source, apiKey, model, provider} = data ?? {};
  const send = event => self.postMessage(JSON.parse(JSON.stringify(event).split(apiKey).join('[REDACTED]')));
  try {
    if (typeof source !== 'string' || !source.trim() || new TextEncoder().encode(source).length > 524288 ||
        typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 ||
        typeof model !== 'string' || !model.trim() || model.length > 200 || !Object.hasOwn(endpoints, provider)) {
      throw new Error('Source (up to 512 KB), API key, model and a supported provider are required.');
    }
    await recoverNames(source, {
      provider: new CompatibleProvider({baseUrl: endpoints[provider], apiKey, model, timeoutMs: 30000, maxResponseBytes: 1048576}),
      concurrency: 4, rpm: 60, maxCalls: 1000, onEvent: send,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recovery failed';
    self.postMessage({type: 'fatal', error: typeof apiKey === 'string' && apiKey ? message.split(apiKey).join('[REDACTED]') : message});
  } finally { self.close(); }
};
