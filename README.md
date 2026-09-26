# FlowName

**[Try FlowName in your browser →](https://123wwwa.github.io/FlowName/?utm_source=gemini)** — bring your API key; no installation required.

**FlowName** is a next-generation Semantic Identifier Recoverer for obfuscated JavaScript. By using AST-based static analysis to group logically related variables into budgeted LLM requests, FlowName eliminates the context-loss hallucinations common in naive text-window approaches.

In a direct benchmark against a leading symbol-based tool (Humanify) on a 411-binding obfuscated scope, FlowName delivered:

* ⚡ **85% Faster Execution** (67.1s vs 456.2s) through relation-guided request batching (65 vs 411 API calls).
* 💰 **36% Lower Token Cost** (87k vs 137k total tokens) by eliminating overlapping context bloat.
* 🎯 **Higher Semantic Precision** (155 vs 37 win-rate in Original-aware evaluation) and 50% more exact original-name matches, proving that guaranteed AST context prevents LLM hallucinations.

**Version 1.0.** Requires Node.js 22.8+. See the [supported contract and limitations](https://www.google.com/search?q=docs/guide.md%2523contract-and-limits&utm_source=gemini) and [release notes](CHANGELOG.md).

---

## Web playground

Open the link above, provide your JavaScript, enter your API key and choose a model. Adjust concurrency, RPM, call limits and grouping budgets, then start recovery. Follow requests, actual token usage and proposed names live; use **Stop** to interrupt a run. API requests go directly from your browser to the provider. For the same playground locally, run `npm ci` then `npm run playground` and open [http://127.0.0.1:4173](http://127.0.0.1:4173?utm_source=gemini).

Prompt format defaults to **Compact**, preserving IDs, source and relation facts with less metadata. Select **Verbose** for the previous format. Recovery defaults to one pass. Select **Two passes (experimental)** to propagate function/class names before inferring remaining names; this may increase cost.

**Names between requests** defaults to **Independent**. Choose **Linked names (experimental)** to let related later groups receive bounded name suggestions from earlier responses while unrelated groups remain parallel. This may increase tokens and latency. CLI: `--request-propagation linked`; library: `requestPropagation: 'linked'`. See the [propagation policy](https://www.google.com/search?q=docs/guide.md%2523linked-request-propagation-experimental&utm_source=gemini).

## CLI

Run the published CLI without a global installation:

```sh
npx --yes --package=flowname@latest flowname input.js

```

Set `GEMINI_API_KEY` (or `FLOWNAME_API_KEY`) in your environment first; the CLI does not automatically load `.env`. No flags are required. Defaults are Gemini 3.5 Flash-Lite, concurrency 4, RPM 60, up to 10,000 calls, one pass, compact prompts and bounded use context. `FLOWNAME_MODEL` and `FLOWNAME_BASE_URL` can override the model and endpoint.

Each run creates a unique `flowname-output-TIMESTAMP-ID` folder in the current directory containing `output.js` and `result.json`. Add `--report` for a live HTML report and its browser link:

```sh
npx --yes --package=flowname@latest flowname input.js --report

```

Use flags only to override defaults, for example `--out ./my-output`, `--model MODEL` or `--max-calls 1000`. An explicitly selected output directory must be new. See `flowname --help` and the [CLI guide](https://www.google.com/search?q=docs/guide.md%2523cli-defaults-and-optional-live-report&utm_source=gemini).

## Library

Install the published release:

```sh
npm install flowname

```

For a local checkout, `npm pack` produces an installable tarball.

```js
import { readFile } from 'node:fs/promises';
import { recoverNames, createProvider } from 'flowname';
import { createHtmlReporter } from 'flowname/html';

const sourceCode = await readFile('./input.js', 'utf8');
const reporter = await createHtmlReporter('./new-report-directory');
const provider = createProvider({
  provider: 'gemini', model: 'gemini-3.5-flash-lite',
  apiKey: process.env.GEMINI_API_KEY,
});
const result = await recoverNames(sourceCode, {
  provider, passes: 1, promptFormat: 'compact', concurrency: 4, rpm: 60, maxCalls: 1000,
  promptBytes: 12000, maxTargets: 16,
  onEvent: reporter.onEvent,
});
console.log(result.status, result.code);

```

The reporter requires a new directory with an existing parent. Open its `index.html` while running; it refreshes every two seconds. Reports contain source code, responses and recovered output. Set `passes: 2` to opt into experimental two-pass recovery. After installation, the CLI is also available through `npx flowname input.js ...` in that project.

---

## Where it fits & How it works

Use FlowName at the identifier-naming stage of JavaScript recovery. For obfuscated code, first use a tool such as [webcrack](https://github.com/j4k0xb/webcrack?utm_source=gemini) to remove supported obfuscation patterns. For bundled code, use [Wakaru](https://github.com/pionxzh/wakaru?utm_source=gemini) or webcrack to extract supported bundles into modules. Then pass the resulting JavaScript files to FlowName to infer useful variable and function names.

Identifiers are resolved to lexical bindings, keeping identical spellings in different scopes distinct. Lightweight relations from assignments, property accesses, call participants and returns guide which targets share a request; remaining targets can be grouped within the same scope.

Each request includes target IDs, declaration excerpts and in-group relation facts. By default, short use excerpts are added within the remaining prompt budget after grouping; group membership stays unchanged. This ensures the LLM **always** sees the target usage. See the [approach](https://www.google.com/search?q=docs/approach.md&utm_source=gemini) and [worked example from source to requests](https://www.google.com/search?q=docs/relation-walkthrough.md&utm_source=gemini).

## Prior work and evaluation scope

The idea of using relationships to infer names together predates LLMs. [JSNice (2015)](https://www.sri.inf.ethz.ch/publications/raychev2015predicting?utm_source=gemini) represents program properties for joint prediction with conditional random fields; its applications include JavaScript identifier names. [JSNaughty](https://www.cs.ucdavis.edu/~devanbu/jsnaughty.pdf) explored statistical machine translation for minified names, while [JSNeat](https://arxiv.org/abs/1906.03488?utm_source=gemini) used usage contexts and relationships between variables to search a source-code corpus. FlowName applies this established joint-context intuition to **budgeted LLM requests** rather than claiming to introduce relational naming.

For binary decompilation, [LmPa (2023, original version)](https://arxiv.org/pdf/2306.02546v1?utm_source=gemini) combines program analysis with multiple LLM queries and propagates useful names into later queries. FlowName's optional linked requests likewise pass earlier suggestions as separate, unverified hints; its lightweight JavaScript analysis, grouping policy and cost goals differ from LmPa's iterative binary analysis.

## How FlowName compares with Humanify

Both tools use static analysis to distinguish bindings and apply LLM-proposed names. FlowName also uses lightweight relations to decide which targets share a request and which evidence fits the prompt budget.

| Stage | Humanify | FlowName |
| --- | --- | --- |
| Implementation and analysis | Rust with Oxc | TypeScript with Babel |
| Identifier identity | Scopes and symbols | Scopes and lexical bindings |
| Request planning | Select context for one binding at a time | Group connected targets, with remaining targets from the same scope as a fallback |
| Evidence sent to the LLM | Selected source context and the target name | Target IDs, declaration excerpts, bounded use excerpts and in-group relation facts |
| LLM response | One proposed name | Proposed names keyed by target ID |
| Applying names | Symbol-based renaming with collision and reference-capture checks | Binding-based renaming with collision and reference-capture checks |

Humanify's Oxc layer parses the source, resolves symbols and emits renamed code; it does not perform structural deobfuscation in this naming pipeline. See its [rename implementation](https://github.com/jehna/humanify/blob/main/src/rename/walker.rs?utm_source=gemini) and [LLM prompt](https://github.com/jehna/humanify/blob/main/src/llm/renamer.rs?utm_source=gemini). This is an architectural comparison, not a comparative safety or performance benchmark.

See the **[documentation](https://www.google.com/search?q=docs/README.md&utm_source=gemini)** for the approach, architecture, limitations, preliminary experiment results and detailed usage.

Licensed under [MIT](https://www.google.com/search?q=LICENSE&utm_source=gemini).
