# FlowName

**[Try FlowName in your browser →](https://123wwwa.github.io/FlowName/)** — bring your API key; no installation required.

**Use FlowName at the identifier-naming stage of JavaScript recovery.** For obfuscated code, first use a tool such as [webcrack](https://github.com/j4k0xb/webcrack) to remove supported obfuscation patterns. For bundled code, use [Wakaru](https://github.com/pionxzh/wakaru) or webcrack to extract supported bundles into modules. Then pass the resulting JavaScript files to FlowName to infer useful variable and function names. Choose preprocessing steps for your input; code that only needs identifier renaming can go directly to FlowName.

FlowName is a lightweight **Semantic Identifier Recoverer** for JavaScript, focused on useful names, bounded LLM requests and scope-aware renaming. It groups related identifiers into compact prompts to reduce repeated context, with token cost and speed as design priorities. A live report makes each request, response and applied name visible. Use it as an npm library, a CLI or an install-free browser playground.

**Why grouped requests?** [Humanify](https://github.com/jehna/humanify#note-on-token-usage) documents one LLM call per identifier with a configurable context window of 500 characters by default. This can repeat instructions and overlapping source context across requests. FlowName groups related identifiers into compact, budgeted requests to reduce that repetition. [Preliminary experiments](docs/experiments.md) show lower token usage against an internal per-identifier baseline; they are not a direct Humanify benchmark and do not establish lower latency or equivalent naming quality.

Identifiers are resolved to lexical bindings, keeping identical spellings in different scopes distinct. Lightweight relations from assignments, property accesses, call participants and returns guide which targets share a request; remaining targets can be grouped within the same scope. Each request includes target IDs, declaration excerpts and in-group relation facts. By default, short use excerpts are added within the remaining prompt budget after grouping; group membership stays unchanged. This is lightweight relation extraction, not full data-flow or alias analysis. See the [approach](docs/approach.md) and [worked example from source to requests](docs/relation-walkthrough.md).

**Early evidence of lower token cost:** a historical compact run used **60.45% fewer total tokens** than the earlier one-identifier-per-request, 500-character-context baseline on the full Axios input (289,823 vs. 732,742 tokens; 1,800 target bindings). This compares separate runs with different implementations, grouping budgets and repair policies; it does not isolate the effect of prompt format or establish equivalent naming quality. Compact left 16 targets unresolved, versus 2 in the earlier baseline. Compact is the default, retaining relation-guided grouping, target IDs, declaration offsets, source excerpts and relation facts with less metadata. See the [measurements and limits](docs/experiments.md#current-compact-vs-historical-local-500).

**Experimental alpha.** Requires Node.js 22.8+. APIs may change; review recovered code before using it.

## Web playground

Open the link above, provide your JavaScript, enter your API key and choose a model. Adjust concurrency, RPM, call limits and grouping budgets, then start recovery. Follow requests, actual token usage and proposed names live; use **Stop** to interrupt a run. API requests go directly from your browser to the provider. For the same playground locally, run `npm ci` then `npm run playground` and open http://127.0.0.1:4173.

Prompt format defaults to **Compact**, preserving IDs, source and relation facts with less metadata. Select **Verbose** for the previous format. Recovery defaults to one pass. Select **Two passes (experimental)** to propagate function/class names before inferring remaining names; this may increase cost.

## CLI

Run the alpha CLI without a global installation:

```sh
npx --package=flowname@alpha flowname input.js
```

Set `GEMINI_API_KEY` (or `FLOWNAME_API_KEY`) in your environment first; the CLI does not automatically load `.env`. No flags are required. Defaults are Gemini 3.5 Flash-Lite, concurrency 4, RPM 60, up to 10,000 calls, one pass, compact prompts and bounded use context. `FLOWNAME_MODEL` and `FLOWNAME_BASE_URL` can override the model and endpoint.

Each run creates a unique `flowname-output-TIMESTAMP-ID` folder in the current directory containing `output.js` and `result.json`. Add `--report` for a live HTML report and its browser link:

```sh
npx --package=flowname@alpha flowname input.js --report
```

Use flags only to override defaults, for example `--out ./my-output`, `--model MODEL` or `--max-calls 1000`. An explicitly selected output directory must be new. See `flowname --help` and the [CLI guide](docs/guide.md#cli-defaults-and-optional-live-report).

## Library

Install the alpha explicitly:

```sh
npm install flowname@alpha
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

See the **[documentation](docs/README.md)** for the approach, architecture, limitations, preliminary experiment results and detailed usage.

Licensed under [MIT](LICENSE).
