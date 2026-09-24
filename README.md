# FlowName

JavaScript identifier recovery with relation-aware request budgets and a live local HTML report.

**Alpha, not yet published to npm.** Node.js 22.8+ (tested on Node 24). The API preserves lexical bindings with scope-aware collision suffixes; it does not guarantee semantic name quality or full behavioral equivalence. Direct eval/with disables renaming. It never executes your JavaScript.

## Why FlowName exists

FlowName started with a question: **can we reduce the token cost of LLM-assisted identifier recovery by asking about related variables together?**

[Humanify](https://github.com/jehna/humanify#readme) documents one LLM call per identifier with a default surrounding context of 500 characters. This is a straightforward approach, but nearby identifiers can cause repeated source context and instructions to be sent across many requests. A fixed local window can also miss relevant uses elsewhere in the code. It does not explicitly group related identifiers for joint inference.

[JSIMPLIFIER](https://www.ndss-symposium.org/wp-content/uploads/2026-f2198-paper.pdf) is another inspiration: its identifier-renaming stage builds on Humanify's AST-based approach, with adapted context management and multiple providers. Its wider pipeline includes static and dynamic analysis. The paper does not establish the same 500-character request policy, so we do not attribute Humanify's exact settings or an absence of program analysis to JSIMPLIFIER.

FlowName addresses the repeated-request limitation through a lightweight semantic relation graph: lexical bindings, references, assignments, property accesses, arguments and return relations guide which identifiers share a request. Remaining singletons can be grouped within the same lexical scope. Request budgets bound group size and context, and AST renaming applies validated suggestions with collision handling. This is lightweight relation extraction, not complete JavaScript data-flow or alias analysis.

The goal is **useful names with less repeated context and fewer API calls**, rather than exact reconstruction of the author's original spelling. Each request and response is visible in the live HTML report or web playground, including proposed names, applied names and collision adjustments.

## Preliminary Axios experiment

An exploratory prototype experiment used the **entire Axios 1.20.0 browser distribution**, with identifier-only anonymization: **4,400 nonblank, noncomment input lines and 1,800 target bindings**. It included all scopes and transpiler helpers, not extracted function samples. Original names were retained for inspection but were not sent to the model.

Each method ran once with `gemini-3.5-flash-lite`, temperature 0, concurrency 32 and no retries. All three methods below were implemented in our research prototype; these are **not direct benchmarks of Humanify or JSIMPLIFIER**.

| Prototype method | API calls | Input tokens | Output tokens | Total tokens | Reduction vs. local-500 |
| --- | ---: | ---: | ---: | ---: | ---: |
| local-500 | 1,800 | 703,927 | 28,815 | 732,742 | Baseline |
| relation-guided | 936 | 562,099 | 26,867 | 588,966 | 19.62% |
| relation-guided-scope | 712 | 516,723 | 25,788 | 542,511 | **25.96%** |

- **local-500:** one target per request with a 500-character source window in total, plus prompt instructions. This is an analogous baseline, not an exact reproduction of Humanify.
- **relation-guided:** up to four related targets per request, with a 1,600-character source budget and relation metadata.
- **relation-guided-scope:** the same relation groups, with remaining singletons additionally batched within their lexical scope, up to four targets per request.

The scope-assisted method used **60.44% fewer calls** than local-500. Both input and output token totals decreased in this run. Request intervals were 53.360 seconds, 32.929 seconds and 22.797 seconds respectively; these are individual observations, not controlled latency guarantees.

Response validation failed for 2, 2 and 5 requests respectively, leaving 2, 8 and 16 targets without an applied response. Reported usage includes those failed responses; successful target coverage therefore differs. All three outputs passed the same fixed Axios public-API behavior checks, which do not prove full behavioral equivalence.

Manual inspection motivated continued development, but semantic naming quality and cross-variable consistency were not formally scored. Exact original-name matches are not a substitute: multiple names can describe the same role, and the original distribution itself contains single-letter names.

**These results support the initial batching hypothesis on one input.** They do not establish equivalent naming quality, general savings on other code, or the separate contribution of relation analysis versus simple batching. The current library adds different request budgets and planning behavior; the table describes the earlier prototype, not a benchmark of the current release. Research datasets and raw experiment logs are not included in this product repository.

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
- Custom providers implement `{ label, async infer(request) }`; see exported TypeScript types. Never embed a shared API key in browser bundles. The static playground accepts each visitor's own key for that session.
- `onEvent` receives plan/request/response/complete events. Request contexts and parsed responses are observable. Observer failure rejects the run and stops new work; in-flight work drains.
- AbortSignal/Ctrl+C stops scheduling and drains in-flight requests (provider timeout still applies). There are no automatic retries.
- Authentication/quota failures or three consecutive errors stop new work. Partial runs return `status: 'partial'`; missing names stay unchanged. Plan exceeding maxCalls fails before network requests.
- UTF-8 prompt byte budgets are a local proxy, not a tokenizer. Budgeted mode sends declaration excerpts and limited relation facts; omission counts are observable. Output has an explicit token cap. Long-source analysis has size/edge/cooperative-time limits, not a hard parser deadline.
- `rpm` controls request starts, not tokens per minute or dollar spending. Unknown token usage remains null.

## Development and packaging

`npm test` runs offline regression tests. `npm pack` builds an installable alpha tarball with only the public entrypoints' dependency closure. It does not publish. Experiment scripts, old data/results and credentials are excluded from this product repository and package.

Public npm name availability, license choice and npm publication remain release tasks. The playground supports GitHub Pages deployment; an official documentation site is a separate next step.


## Web playground

### GitHub Pages: browser-only hosting

The static build runs analysis and renaming in a Web Worker. API requests go directly from the visitor's browser to the selected provider. GitHub Pages serves the application assets; no FlowName backend receives the key or source. Keys are cleared from the form when submitted, kept in memory for the run, and never written to localStorage, files or analytics. Each visitor supplies their own key and pays their provider's API charges. Do not put an owner API key in the workflow, repository or build environment.

The UI streams per-request progress and suggestions. Stop terminates the worker, including its active connections, while retaining received suggestions on screen. Submitted API requests may still be billed. Source size is capped at 512 KB; each run allows four concurrent calls, 60 request starts per minute, 1,000 planned calls and 20 minutes. Parsing and AST processing consume the visitor's memory and CPU; the worker keeps this work off the UI thread but has no fixed memory quota.

Build and verify locally:

```sh
npm ci
npm test
npm run test:pages
```

Serve `pages-dist/` with any static HTTP server to preview it. Opening `index.html` as a `file://` URL is not supported because the app uses a module worker. Assets use relative paths, including the worker URL, so project URLs such as `https://<owner>.github.io/<repository>/` work without a custom domain.

To enable automatic deployment:

1. Push this product directory as the repository root, with `package.json` and `.github/` at the top level.
2. In the repository, select **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`, or run **Test and deploy playground** from the Actions tab. If your default branch differs, update both `main` conditions in `.github/workflows/pages.yml`.
4. Open the URL shown by the `github-pages` deployment after the workflow succeeds.

The workflow runs offline library and browser-bundle tests, uploads only `pages-dist/`, then deploys it. Pull requests run the same checks without publishing. It neither calls a paid model nor publishes the npm package. See [GitHub's custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) for repository configuration.

Browser-direct requests depend on the provider's CORS policy, available model and key restrictions. A network/CORS failure is displayed in the request log; the page does not silently relay through another server. Live provider access is not verified by the offline deployment tests. Use the local server mode below if a provider does not allow browser requests.

### Local Node server

Run `npm ci` then `npm run playground` and open http://127.0.0.1:4173. Visitors to a hosted instance need only a browser, their provider API key and a model ID. The UI streams per-request contexts and suggestions, then displays final collision-checked names and a JavaScript download. Stop aborts the connection and terminates its worker; completed suggestions stay visible. Already submitted provider calls may still be billed.

In this mode, keys and source pass through the Node host to an allowlisted provider endpoint; the application writes neither to disk or a database and never loads the host's API key. Use HTTPS when deploying publicly. Avoid request-body logging at your reverse proxy. `HOST` and `PORT` configure binding. Proxy buffering must be disabled for `/api/recover`. There are two concurrent sessions per process, 512 KB source and 20-minute per-session limits. Each session uses at most four in-flight calls, 60 RPM and 1,000 planned calls. Model IDs are editable; suggested IDs are not an availability guarantee.

The repository `.gitignore` is an allowlist of product sources, product tests, packaging files and the web app. Experiments, results, environment files, package artifacts, caches and generated builds stay local. Ignore rules do not remove files already tracked in an existing repository.
