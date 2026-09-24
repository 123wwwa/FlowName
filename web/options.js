export const optionSpecs = {
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
    if (!Number.isSafeInteger(value) || value < spec.min || value > spec.max) {
      throw new Error(`${key} must be an integer from ${spec.min} to ${spec.max}.`);
    }
    result[key] = value;
  }
  return result;
}
