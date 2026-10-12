#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile, mkdir, writeFile, open, rm} from 'node:fs/promises';
import {text} from 'node:stream/consumers';
import {resolve, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import type {RecoveryEvent} from './library.js';
import {recoverNames, planRecovery, createProvider} from './library.js';
import {parseDotenv, resolveProviderFlags} from './provider-config.js';
import {createHtmlReporter} from './html-reporter.js';

const HELP = `Usage: flowname <INPUT> [options]

INPUT is a JavaScript file, or - to read standard input.

Output
  (default)              Create flowname-output-TIMESTAMP-ID in the current directory with output.js and result.json.
  --out NEW_DIRECTORY    Use this new directory instead.
  -o, --output FILE      Write only the recovered code to a new FILE, or to standard output with -.
                         No directory is created unless --out or --report is also given.
  --report               Write a live HTML report to the output directory and print its file URL.
  -q, --quiet            Hide progress lines. Warnings, failed requests and the summary remain.
  -v, --verbose          Print the resolved configuration and every applied rename to standard error.

Provider
  --provider gemini|compatible   Default gemini.
  -m, --model MODEL              Default gemini-3.5-flash-lite, or FLOWNAME_MODEL.
  --base-url URL                 OpenAI-compatible endpoint, or FLOWNAME_BASE_URL.
  -k, --api-key KEY              Or GEMINI_API_KEY / FLOWNAME_API_KEY.
  Flags take precedence, then the environment, then .env in the current directory; differing values print a warning.
  A key passed as a flag may be visible in shell history and process listings.

Cost and limits
  --dry-run              Print the planned API calls and prompt bytes, then exit. Needs no API key and sends nothing.
  --sample-requests N    Trial run: send only the first N planned requests.
  --max-calls N          Default 10000. A larger plan stops before sending any request.
  --concurrency N        Default 4.
  --rpm N                Default 60.

Recovery
  --passes 1|2                        Default 1. Two passes are experimental.
  --prompt-format compact|verbose     Default compact.
  --context-mode usage|declarations   Default usage (bounded use context).
  --request-propagation off|linked    Default off. Linked waits for related earlier groups and adds bounded
                                      name hints; it may increase tokens and latency.

  -h, --help       Show this help.
  -V, --version    Show the version.

One corrective retry for model JSON/ID errors within budgets. A rate-limit response whose Retry-After is at
most 60 seconds is retried once; there are no other transport retries. Failed requests print the provider error.`;

async function main() {
  const {values: v, positionals} = parseArgs({allowPositionals: true, options: {
    'request-propagation': {type: 'string', default: 'off'}, 'context-mode': {type: 'string', default: 'usage'},
    'prompt-format': {type: 'string', default: 'compact'}, passes: {type: 'string', default: '1'},
    help: {type: 'boolean', short: 'h'}, version: {type: 'boolean', short: 'V'},
    report: {type: 'boolean', default: false}, out: {type: 'string'}, output: {type: 'string', short: 'o'},
    quiet: {type: 'boolean', short: 'q', default: false}, verbose: {type: 'boolean', short: 'v', default: false},
    provider: {type: 'string', default: 'gemini'}, model: {type: 'string', short: 'm'},
    'api-key': {type: 'string', short: 'k'}, 'base-url': {type: 'string'},
    'dry-run': {type: 'boolean', default: false}, 'sample-requests': {type: 'string'},
    concurrency: {type: 'string', default: '4'}, rpm: {type: 'string', default: '60'}, 'max-calls': {type: 'string', default: '10000'},
  }});
  if (v.version) { console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version); return; }
  if (v.help || !positionals.length) { console.log(HELP); return; }
  if (positionals.length !== 1) throw new Error('Supply exactly one input file.');
  const promptFormat = v['prompt-format']; if (promptFormat !== 'compact' && promptFormat !== 'verbose') throw new Error('--prompt-format must be compact or verbose.');
  const contextMode = v['context-mode']; if (contextMode !== 'usage' && contextMode !== 'declarations') throw new Error('--context-mode must be usage or declarations.');
  const requestPropagation = v['request-propagation']; if (requestPropagation !== 'off' && requestPropagation !== 'linked') throw new Error('--request-propagation must be off or linked.');
  const passes = Number(v.passes); if (passes !== 1 && passes !== 2) throw new Error('--passes must be 1 or 2.');
  const sampleRequests = v['sample-requests'] === undefined ? undefined : Number(v['sample-requests']);
  const options = {passes, promptFormat, contextMode, requestPropagation, sampleRequests, concurrency: Number(v.concurrency), rpm: Number(v.rpm), maxCalls: Number(v['max-calls'])} as const;
  const code = positionals[0] === '-' ? await text(process.stdin) : await readFile(resolve(positionals[0]!), 'utf8');

  if (v['dry-run']) {
    const plan = planRecovery(code, options);
    console.log('Dry run: no requests sent.');
    console.log(`Identifiers to name: ${plan.identifiers}`);
    console.log(`Planned API calls: ${plan.calls}${plan.calls > options.maxCalls ? ` (exceeds --max-calls ${options.maxCalls}; a run would stop before sending)` : ''}`);
    console.log(`Prompt bytes: ${plan.promptBytes} total, ${plan.largestPromptBytes} largest (UTF-8 bytes, not tokens)`);
    if (passes === 2) console.log('Pass two is replanned after pass one is applied, so its share can change.');
    for (const warning of plan.warnings) console.log('Warning: ' + warning);
    return;
  }

  let dotenv: Record<string,string> = {};
  try { dotenv = parseDotenv(await readFile(resolve('.env'), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const settings = resolveProviderFlags({provider: v.provider, model: v.model, apiKey: v['api-key'], baseUrl: v['base-url'], timeoutMs: 60000}, process.env, dotenv);
  for (const warning of settings.warnings) console.error(warning);
  const provider = createProvider(settings.flags);
  if (v.verbose) {
    console.error(`Provider: ${v.provider} | model: ${provider.label} (${settings.sources.model ?? 'default'}) | endpoint: ${settings.flags.baseUrl ?? 'provider default'} (${settings.sources['base URL'] ?? 'default'})`);
    console.error(`API key: ${settings.sources['API key'] ?? 'none'}`);
    console.error(`Passes ${passes} | prompt ${promptFormat} | context ${contextMode} | propagation ${requestPropagation} | concurrency ${options.concurrency} | rpm ${options.rpm} | max calls ${options.maxCalls}${sampleRequests === undefined ? '' : ` | sample ${sampleRequests}`}`);
  }

  // Recovered code on standard output must not be mixed with status lines.
  const codeToStdout = v.output === '-';
  const say = codeToStdout ? console.error : console.log;
  const outputFile = v.output !== undefined && !codeToStdout ? resolve(v.output) : undefined;
  const useDirectory = v.output === undefined || v.out !== undefined || v.report;
  // Reserve the file before any request so a paid run can always be saved.
  if (outputFile !== undefined) await mkdir(dirname(outputFile), {recursive: true});
  const outputHandle = outputFile === undefined ? undefined : await open(outputFile, 'wx').catch(error => {
    throw (error as NodeJS.ErrnoException).code === 'EEXIST' ? new Error(`Output file already exists: ${outputFile}`) : error;
  });
  let written = false;
  const controller = new AbortController();
  const stop = () => { console.error('\nStopping new requests; draining in-flight calls.'); controller.abort(); };
  try {
    const directory = useDirectory ? resolve(v.out ?? `flowname-output-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`) : undefined;
    if (directory) await mkdir(dirname(directory), {recursive: true});
    const reporter = v.report ? await createHtmlReporter(directory!) : undefined;
    if (directory && !reporter) await mkdir(directory, {recursive: false});
    if (directory) say('Output directory: ' + directory);
    if (reporter) say('Live report (open in your browser): ' + pathToFileURL(reporter.path).href);

    let total = 0, done = 0, active = 0, failed = 0, retries = 0, input = 0, output = 0, unknown = false;
    const originalNames = new Map<string,string>();
    const clearLine = () => { if (process.stderr.isTTY && !v.quiet) { process.stderr.clearLine(0); process.stderr.cursorTo(0); } };
    const progress = (event: RecoveryEvent) => {
      for (const target of event.request?.targets ?? []) originalNames.set(target.id, target.name);
      if (event.type === 'response') {
        const label = `Request ${(event.index ?? 0) + 1}`;
        clearLine();
        if (!v.quiet) console.error(`${label}: actual tokens in/out: ${event.inputTokens ?? 'Unknown'} / ${event.outputTokens ?? 'Unknown'}`);
        if (event.error) console.error(`${label} failed: ${event.error}`);
      }
      if (event.total !== undefined) total = event.total;
      if (event.type === 'request') { active++; if ((event.attempt ?? 1) > 1) retries++; }
      if (event.type === 'response') {
        active = Math.max(0, active - 1); done++; if (event.error) failed++;
        if (event.inputTokens == null || event.outputTokens == null) unknown = true;
        input += event.inputTokens ?? 0; output += event.outputTokens ?? 0;
      }
      if (event.type === 'complete' || v.quiet) return;
      const line = 'Progress: ' + done + '/' + total + ' responses | ' + active + ' in flight | ' + failed + ' response errors | ' + retries + ' retries | tokens in/out: ' + input + '/' + output + (unknown ? ' (known usage only; some unavailable)' : '');
      if (process.stderr.isTTY) { clearLine(); process.stderr.write(line); }
      else if (event.type !== 'request') console.error(line);
    };

    process.once('SIGINT', stop);
    const result = await recoverNames(code, {provider, ...options, signal: controller.signal, onEvent: async event => { progress(event); await reporter?.onEvent(event); }})
      .finally(() => { if (process.stderr.isTTY && !v.quiet) process.stderr.write('\n'); })
      .catch(async error => { await reporter?.fail(error).catch(() => {}); throw error; });
    if (directory && !reporter) { await writeFile(join(directory, 'output.js'), result.code); await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2)); }
    if (outputHandle) { await outputHandle.writeFile(result.code); written = true; }
    if (codeToStdout) process.stdout.write(result.code.endsWith('\n') ? result.code : result.code + '\n');
    if (v.verbose) {
      const position = (id: string) => Number(id.slice(1));
      for (const [id, name] of Object.entries(result.accepted).sort(([a], [b]) => position(a) - position(b))) {
        console.error(`  ${originalNames.get(id) ?? id} -> ${name}${result.adjustments[id] ? ` (adjusted: ${result.adjustments[id]})` : ''}`);
      }
      for (const [id, reason] of Object.entries(result.rejected)) console.error(`  ${originalNames.get(id) ?? id}: rejected (${reason})`);
    }
    for (const warning of result.warnings) console.error('Warning: ' + warning);
    if (directory) say('Output: ' + join(directory, 'output.js'));
    if (outputFile) say('Output: ' + outputFile);
    say(`${result.status}: ${result.calls} calls, ${Object.keys(result.accepted).length} renames`);
    // A sample is partial by design; it fails only when a request did.
    const expectedPartial = sampleRequests !== undefined && result.status === 'partial' && result.failedCalls === 0;
    if (result.status !== 'completed' && !expectedPartial) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    await outputHandle?.close();
    if (outputFile && !written) await rm(outputFile, {force: true});
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
