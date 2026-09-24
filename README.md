# FlowName

JavaScript identifier recovery with relation-aware request budgets and a live local HTML report.

**Alpha, not yet published to npm.** Node.js 22.8+ (tested on Node 24). The API preserves lexical bindings with scope-aware collision suffixes; it does not guarantee semantic name quality or full behavioral equivalence. Direct eval/with disables renaming. It never executes your JavaScript.

## Library

```js
import { recoverNames, createProvider } from 'flowname';
import { createHtmlReporter } from 'flowname/html';

const reporter = await createHtmlReporter('./new-report-directory');
const provider = createProvider({
  provider: 'gemini', model: 'gemini-3.5-flash-lite',
  apiKey: process.env.GEMINI_API_KEY,
});
const result = await recoverNames(sourceCode, {
  provider, concurrency: 4, rpm: 60, maxCalls: 1000,
  promptBytes: 12000, maxTargets: 16,
  onEvent: reporter.onEvent,
});
console.log(result.status, result.code);
```

`createHtmlReporter` requires a new directory with an existing parent. Open its `index.html` while running: the file refreshes every two seconds, preserves search/open request cards, and displays suggested names. Applied names appear after the complete scope check. No server or CDN is needed. Events, recovered code and the final JSON result remain on disk. Reports contain source code and suggestions; share them deliberately.

## CLI

Build locally with `npm run build`, then:

```sh
node dist/product-cli.js input.js --out ./new-report --provider gemini --model gemini-3.5-flash-lite --concurrency 4 --rpm 60 --max-calls 1000
```

Set `GEMINI_API_KEY` (or `FLOWNAME_API_KEY`) in your environment. The product does not automatically load `.env`. After installation from a tarball the same command is `flowname input.js ...`.

## Contract and limits

- `recoverNames(source, options)` returns code, proposed/accepted/rejected/adjusted mappings, status, calls, nullable token usage and analysis warnings.
- Custom providers implement `{ label, async infer(request) }`; see exported TypeScript types. Never expose API keys in browser code.
- `onEvent` receives plan/request/response/complete events. Request contexts and parsed responses are observable. Observer failure rejects the run and stops new work; in-flight work drains.
- AbortSignal/Ctrl+C stops scheduling and drains in-flight requests (provider timeout still applies). There are no automatic retries.
- Authentication/quota failures or three consecutive errors stop new work. Partial runs return `status: 'partial'`; missing names stay unchanged. Plan exceeding maxCalls fails before network requests.
- UTF-8 prompt byte budgets are a local proxy, not a tokenizer. Budgeted mode sends declaration excerpts and limited relation facts; omission counts are observable. Output has an explicit token cap. Long-source analysis has size/edge/cooperative-time limits, not a hard parser deadline.
- `rpm` controls request starts, not tokens per minute or dollar spending. Unknown token usage remains null.

## Development and packaging

`npm test` runs offline regression tests. `npm pack` builds an installable alpha tarball with only the public entrypoints' dependency closure. It does not publish. Experiment scripts, old data/results and credentials are excluded from the package. The repository retains research history for reference; those scripts are not the product API.

Public npm name availability, license choice and npm publication remain release tasks. A hosted playground and official documentation site are separate next steps.


## Web playground

Run `npm ci` then `npm run playground` and open http://127.0.0.1:4173. Visitors to a hosted instance need only a browser, their provider API key and a model ID. The UI streams per-request contexts and suggestions, then displays final collision-checked names and a JavaScript download. Stop aborts the connection and terminates its worker; completed suggestions stay visible. Already submitted provider calls may still be billed.

This is a Node-hosted website, not a static-only page. Keys and source pass through the host to an allowlisted provider endpoint; the application writes neither to disk or a database and never loads the host's API key. Use HTTPS when deploying publicly. Avoid request-body logging at your reverse proxy. `HOST` and `PORT` configure binding. Proxy buffering must be disabled for `/api/recover`. There are two concurrent sessions per process, 512 KB source and 20-minute per-session limits. Each session uses at most four in-flight calls, 60 RPM and 1,000 planned calls. Model IDs are editable; suggested IDs are not an availability guarantee.

The repository `.gitignore` is an allowlist of product sources, product tests, packaging files and the web app. Experiments, results, environment files, package artifacts, caches and generated builds stay local. Ignore rules do not remove files already tracked in an existing repository.
