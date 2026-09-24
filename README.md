# FlowName

**[Try FlowName in your browser →](https://123wwwa.github.io/flowname/)** — bring your API key; no installation required.

JavaScript identifier recovery with relation-aware request budgets and a live local HTML report.

**Alpha, not yet published to npm.** Node.js 22.8+ (tested on Node 24). The API preserves lexical bindings with scope-aware collision suffixes; it does not guarantee semantic name quality or full behavioral equivalence. Direct eval/with disables renaming. It never executes your JavaScript.

## Why FlowName exists

FlowName started with a question: **can we reduce the token cost of LLM-assisted identifier recovery by asking about related variables together?**

[Humanify](https://github.com/jehna/humanify#readme) documents one LLM call per identifier with a default surrounding context of 500 characters. This is a straightforward approach, but nearby identifiers can cause repeated source context and instructions to be sent across many requests. A fixed local window can also miss relevant uses elsewhere in the code. It does not explicitly group related identifiers for joint inference.

### How JSIMPLIFIER sends naming requests

We inspected the official [XingTuLab/JSIMPLIFIER implementation at commit `eaa72ae`](https://github.com/XingTuLab/JSIMPLIFIER/tree/eaa72ae63758957ac95b2f5e3391fefb96827987). Its OpenAI and Gemini naming paths work as follows:

1. **One target name per invocation, sequentially.** `visitAllIdentifiers` collects Babel binding-identifier paths, sorts them by enclosing context size (largest first), and awaits the rename callback inside a loop. It applies each rename before preparing the next context. There is no multi-identifier response map or relation-guided target batching in these paths.
2. **The default context setting is 1,000, not 500.** `scopeToString` stringifies a selected enclosing scope. If it is shorter than the setting, it sends it whole. For a longer non-program scope, it takes the first 1,000 JavaScript string units. For a longer program scope, it takes the first/last window near boundaries, otherwise slices from `identifier.start - 500` to `identifier.end + 500`. The central slice can therefore exceed 1,000 units by the identifier length; this is not a token budget.
3. **OpenAI:** `chat.completions.create` receives a system instruction naming the single target and requesting a descriptive replacement, plus one user message containing the selected source excerpt. A strict JSON schema requires one string field, `newName`.
4. **Gemini:** a system instruction names the single target; `generateContent(surroundingCode)` supplies the excerpt. JSON MIME type and an object response schema require `newName`.
5. **AST application:** the returned name is normalized with Babel `toIdentifier`; collisions are handled with `_` prefixes before `scope.rename`. Later requests can see earlier renames. The visited set is keyed by name text, not a unique binding ID, so invocation counts should not be equated with all lexical bindings.

These request builders send the target name and source text, without an explicit def-use graph or a related-target list. JSIMPLIFIER's broader deobfuscation pipeline still performs static and dynamic analysis. [Implementation details and pinned source links](docs/jsimplifier-requests.md) cover context selection, provider payloads and the separate local-model helper.

### FlowName's approach

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

## Documentation

- [Architecture and execution diagrams](docs/architecture.md)
- [Contract, limits, development and deployment](docs/guide.md)
- [JSIMPLIFIER request implementation and source references](docs/jsimplifier-requests.md)
