import { CompatibleProvider, MockProvider } from './inference.js';
import type { Provider } from './types.js';

export interface ProviderFlags {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export function createProvider(flags: ProviderFlags, env: Record<string,string|undefined> = process.env): Provider {
  // A model/API flag implies a real endpoint unless mock was explicitly selected.
  const provider = flags.provider ?? (flags.model || flags.apiKey || flags.baseUrl ? 'compatible' : 'mock');
  if (provider === 'mock') {
    if (flags.apiKey || flags.model || flags.baseUrl) throw new Error('Model/API flags cannot be used with --provider mock.');
    return new MockProvider();
  }
  if (!['compatible', 'gemini'].includes(provider)) throw new Error('Unknown provider; use mock, compatible or gemini.');
  const baseUrl = flags.baseUrl ?? env.FLOWNAME_BASE_URL ?? (provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai' : undefined);
  const model = flags.model ?? env.FLOWNAME_MODEL ?? (provider === 'gemini' ? 'gemini-3.5-flash-lite' : undefined);
  const apiKey = flags.apiKey ?? env.FLOWNAME_API_KEY ?? (provider === 'gemini' ? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY : undefined);
  if (!baseUrl || !model || !apiKey) throw new Error('Set --base-url, --model/-m, --api-key/-k or FLOWNAME_BASE_URL, FLOWNAME_MODEL, FLOWNAME_API_KEY.');
  if (flags.timeoutMs !== undefined && (!Number.isSafeInteger(flags.timeoutMs) || flags.timeoutMs <= 0)) throw new Error('--timeout-ms must be a positive integer.');
  return new CompatibleProvider({ baseUrl, model, apiKey, timeoutMs: flags.timeoutMs });
}
