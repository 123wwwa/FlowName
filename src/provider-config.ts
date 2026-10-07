import { CompatibleProvider, MockProvider } from './inference.js';
import type { Provider } from './types.js';

export interface ProviderFlags {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

type Values = Record<string,string|undefined>;

/** Parses KEY=VALUE lines; no interpolation or multiline values. */
export function parseDotenv(text: string): Record<string,string> {
  const values: Record<string,string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const quoted = /^(["'])(.*)\1$/.exec(match[2]!);
    values[match[1]!] = quoted ? quoted[2]! : match[2]!.replace(/\s+#.*$/, '');
  }
  return values;
}

/** CLI precedence: flags, then process environment, then the .env file. Differing values produce a warning that names the sources, never the values. */
export function resolveProviderFlags(flags: ProviderFlags, env: Values, dotenv: Values): { flags: ProviderFlags; warnings: string[] } {
  if (flags.provider === 'mock') return { flags, warnings: [] };
  const warnings: string[] = [];
  const pick = (setting: string, names: string[], flagName: string, flagValue?: string) => {
    const found: Array<{ source: string; value: string }> = [];
    if (flagValue) found.push({ source: flagName, value: flagValue });
    for (const [label, values] of [['environment', env], ['.env', dotenv]] as const) {
      const name = names.find(candidate => values[candidate]);
      if (name) found.push({ source: `${label} ${name}`, value: values[name]! });
    }
    if (new Set(found.map(entry => entry.value)).size > 1) warnings.push(`Warning: ${setting} differs between ${found.map(entry => entry.source).join(', ')}; using ${found[0]!.source}.`);
    return found[0]?.value;
  };
  const keyNames = ['FLOWNAME_API_KEY', ...(flags.provider === 'gemini' ? ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] : [])];
  return { flags: { ...flags,
    baseUrl: pick('base URL', ['FLOWNAME_BASE_URL'], '--base-url', flags.baseUrl),
    model: pick('model', ['FLOWNAME_MODEL'], '--model', flags.model),
    apiKey: pick('API key', keyNames, '--api-key', flags.apiKey),
  }, warnings };
}

export function createProvider(flags: ProviderFlags, env: Values = process.env): Provider {
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
  const missing = [
    !baseUrl && 'base URL (--base-url or FLOWNAME_BASE_URL)',
    !model && 'model (--model/-m or FLOWNAME_MODEL)',
    !apiKey && `API key (--api-key/-k or FLOWNAME_API_KEY${provider === 'gemini' ? ', GEMINI_API_KEY, GOOGLE_API_KEY' : ''})`,
  ].filter(Boolean);
  if (!baseUrl || !model || !apiKey) throw new Error(`Missing ${missing.join('; ')}.`);
  if (flags.timeoutMs !== undefined && (!Number.isSafeInteger(flags.timeoutMs) || flags.timeoutMs <= 0)) throw new Error('--timeout-ms must be a positive integer.');
  return new CompatibleProvider({ baseUrl, model, apiKey, timeoutMs: flags.timeoutMs });
}
