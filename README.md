# FlowName

**[Try FlowName in your browser →](https://123wwwa.github.io/FlowName/)** — bring your API key; no installation required.

FlowName is a lightweight **Semantic Identifier Recoverer** for JavaScript. It infers useful names for identifiers whose meaning has been lost, grouping related identifiers into LLM requests to reduce repeated context. The design prioritizes token cost and speed, with a live report showing each request, response and applied name.

Identifiers are resolved to lexical bindings, keeping identical spellings in different scopes distinct. Lightweight relations from assignments, property accesses, call participants and returns guide which targets share a request; remaining targets can be grouped within the same scope. Each request includes target IDs, declaration excerpts and in-group relation facts, bounded by target count and prompt bytes. This is lightweight relation extraction, not full data-flow or alias analysis. See the [approach](docs/approach.md) and [worked example from source to requests](docs/relation-walkthrough.md).

**Early evidence of lower token cost:** the current compact run used **60.45% fewer total tokens** than the earlier one-identifier-per-request, 500-character-context baseline on the full Axios input (289,823 vs. 732,742 tokens; 1,800 target bindings). This compares separate runs with different implementations, grouping budgets and repair policies; it does not isolate the effect of prompt format or establish equivalent naming quality. Compact left 16 targets unresolved, versus 2 in the earlier baseline. Compact is the default, retaining relation-guided grouping, target IDs, declaration offsets, source excerpts and relation facts with less metadata. See the [measurements and limits](docs/experiments.md#current-compact-vs-historical-local-500).

**Experimental alpha.** Requires Node.js 22.8+. APIs may change; review recovered code before using it.

## Web playground

Open the link above, provide your JavaScript, enter your API key and choose a model. Adjust concurrency, RPM, call limits and grouping budgets, then start recovery. Follow requests and proposed names live; use **Stop** to interrupt a run. API requests go directly from your browser to the provider. For the same playground locally, run `npm ci` then `npm run playground` and open http://127.0.0.1:4173.

Prompt format defaults to **Compact**, preserving IDs, source and relation facts with less metadata. Select **Verbose** for the previous format. Recovery defaults to one pass. Select **Two passes (experimental)** to propagate function/class names before inferring remaining names; this may increase cost.

## CLI

Run the alpha CLI without a global installation:

```sh
npx --package=flowname@alpha flowname input.js --out ./new-report --report --provider gemini --model gemini-3.5-flash-lite --concurrency 4 --rpm 60 --max-calls 1000 --passes 1 --prompt-format compact
```

Set `GEMINI_API_KEY` (or `FLOWNAME_API_KEY`) in your environment. The CLI does not automatically load `.env`. Use a new output directory. Progress appears in the terminal; add `--report` to save a live HTML report and print its browser link (refreshes every two seconds). Without `--report`, only `output.js` and `result.json` are saved. Set `--passes 2` to opt into experimental two-pass recovery.

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
