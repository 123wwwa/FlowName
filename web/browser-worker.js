import {recoverNames, CompatibleProvider} from '../src/library.ts';
import {validateOptions, validateInput, providerEndpoints} from './options.js';
let started = false;
self.onmessage = async ({data}) => {
  if (started) return;
  started = true;
  const {source, apiKey, model, provider} = data ?? {};
  const send = event => self.postMessage(JSON.parse(JSON.stringify(event).split(apiKey).join('[REDACTED]')));
  try {
    validateInput(data);
    await recoverNames(source, {
      provider: new CompatibleProvider({baseUrl: providerEndpoints[provider], apiKey, model, timeoutMs: 30000, maxResponseBytes: 1048576}),
      ...validateOptions(data.options), onEvent: send,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Recovery failed';
    self.postMessage({type: 'fatal', error: typeof apiKey === 'string' && apiKey ? message.split(apiKey).join('[REDACTED]') : message});
  } finally { self.close(); }
};
