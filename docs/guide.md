# Usage and deployment guide

[Back to README](../README.md)

## Contract and limits

- `recoverNames(source, options)` returns code, proposed/accepted/rejected/adjusted mappings, status, calls, nullable token usage and analysis warnings.
- In the 1.x line, the documented `flowname` and `flowname/html` imports, exported TypeScript types, CLI command and documented flags are the compatibility surface. Changes to these interfaces follow semantic versioning. Inferred names and the exact grouping plan are model- and input-dependent outputs, not compatibility guarantees. Two-pass recovery and linked request propagation remain opt-in experiments; their naming quality and efficiency are not established.
- Custom providers implement `{ label, async infer(request) }`; see exported TypeScript types. Never embed a shared API key in browser bundles. The static playground accepts each visitor's own key for that session.
- `onEvent` receives plan/request/response/pass-complete/complete events. Request contexts and parsed responses are observable. Observer failure rejects the run and stops new work; in-flight work drains.
- AbortSignal/Ctrl+C stops scheduling and drains in-flight requests (provider timeout still applies). Model-content JSON/schema failures allow one corrective retry per group, subject to call and prompt budgets; other errors are not automatically retried.
- Authentication/quota failures or three consecutive errors stop new work. Partial runs return `status: 'partial'`; missing names stay unchanged. Plan exceeding maxCalls fails before network requests.
- UTF-8 prompt byte budgets are a local proxy, not a tokenizer. Budgeted mode sends declaration excerpts and limited relation facts; omission counts are observable. Output has an explicit token cap. Long-source analysis has size/edge/cooperative-time limits, not a hard parser deadline.
- `rpm` controls request starts, not tokens per minute or dollar spending. Unknown token usage remains null.

## Development and packaging

`npm test` runs offline regression tests. `npm pack` builds an installable tarball with only the public entrypoints' dependency closure. It does not publish. Experiment scripts, old data/results and credentials are excluded from this product repository and package.

FlowName uses the [MIT license](../LICENSE). npm package publication is separate from the GitHub Pages workflow; check the registry version and `latest` dist-tag after each release. The playground supports GitHub Pages deployment; an official documentation site is a separate next step.

`npm run test:package` builds a fresh tarball, installs it into an isolated temporary project and checks imports, strict TypeScript declarations without ambient Node types, the installed CLI, HTML reports and license inclusion. It installs test dependencies but never calls a model or publishes. Package staging is cleaned before packing. CI runs this check on Node 22.8.0 and Node 24; Pages deployment waits for these checks as well as the existing library/browser tests.


## Web playground

### GitHub Pages: browser-only hosting

The static build runs analysis and renaming in a Web Worker. API requests go directly from the visitor's browser to the selected provider. GitHub Pages serves the application assets; no FlowName backend receives the key or source. Keys are cleared from the form when submitted, kept in memory for the run, and never written to localStorage, files or analytics. Each visitor supplies their own key and pays their provider's API charges. Do not put an owner API key in the workflow, repository or build environment.

The UI streams per-request progress and suggestions. Stop terminates the worker, including its active connections, while retaining received suggestions on screen. Submitted API requests may still be billed. Source size is capped at 8 MiB (8,388,608 UTF-8 bytes); each run defaults to 16 concurrent calls, 60 request starts per minute and 1,000 planned calls, with a fixed 20-minute time limit. The web form exposes `concurrency` (1–32), `rpm` (1–6,000), `maxCalls` (1–10,000), `promptBytes` (1,024–1,048,576; default 12,000) and `maxTargets` (1–64; default 16). Settings are validated before API access and locked during a run. RPM paces request starts independently of concurrency. Source, key, model and provider errors are reported separately before a run starts. Oversized input reports actual and allowed UTF-8 bytes; input is never truncated. Validation failures retain the entered key and previous results so they can be corrected without starting a run. An 8 MiB size allowance does not guarantee that every source fits the relation, analysis-time or browser-memory limits. Parsing and AST processing consume the visitor's memory and CPU; the worker keeps this work off the UI thread but has no fixed memory quota.

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

Browser-direct requests depend on the provider's CORS policy, available model and key restrictions. A network/CORS failure is displayed in the request log; the page does not silently relay through another server. Live provider access is not verified by the offline deployment tests. The local preview has the same browser CORS requirements.

### Local browser preview

Run `npm ci` then `npm run playground` and open http://127.0.0.1:4173. This builds the same `pages-dist/` assets deployed to GitHub Pages and serves them with a small static Node server. `HOST` and `PORT` configure binding. Restart the command after source changes to rebuild.

Analysis, API calls, live events and Stop all run through the same browser worker as the hosted playground. The local server only serves HTML, JavaScript and CSS; it has no recovery endpoint and does not receive the submitted source or API key. Provider CORS requirements, run limits and cancellation behavior are identical to the hosted version. Model IDs are editable; suggested IDs are not an availability guarantee.

The repository `.gitignore` is an allowlist of product sources, product tests, packaging files and the web app. Experiments, results, environment files, package artifacts, caches and generated builds stay local. Ignore rules do not remove files already tracked in an existing repository.

## Partial responses and two-pass recovery

Single-pass recovery is the default. With `passes: 2` (CLI `--passes 2` or web Recovery mode), recovery first handles eligible function/class bindings, applies their accepted names, then replans remaining targets from the rewritten source. Inputs without both target categories use one pass. IDs remain tied to original bindings; source offsets reflect the current pass. Both passes share all execution budgets.

Parseable responses retain valid entries per ID. Unknown IDs are ignored and logged. Only unresolved entries receive one corrective attempt; invalid JSON is not mined for fragments. Partial progress resets the consecutive no-progress failure streak. Pass-two budget/identity-check failures preserve first-pass output and return partial status with warnings.

See [the detailed recovery policy](recovery-passes.md) for pass selection, call reservations, stable IDs, cancellation and event accounting. A completed run can have failedCalls greater than zero when repair succeeds. Unknown usage remains null. Log cards show pass, group, attempt, unresolved reasons and ignored IDs.

## Linked request propagation (experimental)

Independent requests remain the default (`requestPropagation: 'off'`). Enable `requestPropagation: 'linked'` in the library, `--request-propagation linked` in the CLI, or **Names between requests → Linked names (experimental)** in the playground.

The initial groups and source excerpts stay unchanged. A later group waits only for selected earlier groups whose targets have a direct extracted relation to its own targets and a declaration or reference occurrence inside its submitted source ranges. Matching uses binding IDs and source offsets, not shared spelling or scope alone. Edges point from earlier to later plan indices, so cycles in source relations cannot cause a scheduling deadlock. Dependencies are selected in plan order, not by semantic confidence or model completion time. Waiting groups consume no worker slots; other ready groups run concurrently under the existing concurrency, RPM and call limits.

After each predecessor finishes its initial attempt and any permitted repair, valid proposals can be attached as `previousNames` entries containing `id`, original `name`, the visible occurrence offset `at`, and `suggested`. These are unverified hints, not final applied names or additional rename targets. The source is not rewritten between requests. Final collision checks may change or reject a suggestion; wrong early interpretations can bias later names.

At most 16 candidate bindings are selected per group. The hints and their instruction may add at most 1,024 UTF-8 prompt bytes and must fit the remaining total `promptBytes` budget. Existing source evidence is never removed to make room. Missing, unchanged or oversized suggestions are omitted; a dependency may therefore yield no hints. This mode does not add initial calls or regroup targets, but may increase input tokens and latency and change repair outcomes. No quality or efficiency improvement is established.

Failed predecessors do not prevent dependent groups from using their original context unless the run's existing stop policy is triggered. Partial valid responses remain usable. Repairs retain the same hints and still obey the byte and call budgets. Cancellation stops new groups and drains active library calls; the browser Stop button terminates the worker. With two-pass recovery, dependencies are rebuilt within each pass; the existing collision-checked application boundary still separates passes.

Request logs include the exact prompt, `previousNames`, and `propagation` metadata (`dependsOn` as zero-based group indices, included/omitted candidate counts, added prompt bytes). Omitted counts cover the selected candidates, not every relation discarded by the 16-candidate cap. The HTML report and playground expose these in request details. Custom providers must use `previousNames` themselves or use `promptFor`-equivalent prompt construction to benefit; receiving the field alone does not force a provider to transmit it.

## Selecting a recovery mode

Use **Single pass (default)** for a combined, cost-focused plan. **Two passes (experimental)** names functions/classes before remaining identifiers and can increase tokens and elapsed time. Both modes retain partial acceptance and bounded repairs. The selection is locked during an active web run.

CLI: `flowname input.js --out ./new-report --passes 2`. Library: `recoverNames(source, {provider, passes: 2})`. Omit the option or use `1` for single-pass execution. The standalone HTML report is an observer of the selected run; its mode is selected when starting the CLI, not changed inside an already-running report.

## CLI defaults and optional live report

The CLI always shows completed responses, in-flight calls, response errors, retries and observed input/output tokens in the terminal. Missing usage is marked as unavailable rather than counted as zero. TTY output updates in place; redirected output uses progress lines on stderr.

Run `flowname input.js` with your API key in `GEMINI_API_KEY` or `FLOWNAME_API_KEY`; no flags are required. The CLI does not load `.env` automatically. It creates a unique `flowname-output-TIMESTAMP-ID` directory relative to the current working directory and prints the absolute path. Repeated runs create separate directories and do not overwrite the input. Use `--out ./new-output` to choose a new directory explicitly. By default, only `output.js` and `result.json` are saved. Add `--report` to also write `events.jsonl` and a live `index.html`. The CLI prints a `file:///` URL you can open in your browser; no HTTP server or automatic browser launch is needed. The report refreshes every two seconds during recovery and remains available afterward. An explicit output directory must be new in both modes.

| Option | Default |
| --- | --- |
| Provider / model | Gemini / `gemini-3.5-flash-lite` |
| Concurrency / RPM | 4 / 60 |
| Maximum calls | 10,000 |
  | Passes | 1 |
| Prompt format / source context | `compact` / `usage` |
| Prompt bytes / targets per request | 12,000 / 16 |
| HTML report | Off; enable with `--report` |

`FLOWNAME_MODEL` and `FLOWNAME_BASE_URL` override the default model and endpoint; explicit flags take precedence. Default call limits are ceilings, not an instruction to spend that many calls. Use `--max-calls` for a smaller limit. Run `flowname --help` for optional overrides.

## Prompt format

`recoverNames(source, {provider, promptFormat: 'compact'})` is the default. CLI: `--prompt-format compact|verbose`. The web **Prompt format** selector exposes the same choice. Invalid values fail before model access.

Compact targets contain only `id`, `name` and `at`, the declaration start UTF-16 offset in the current pass source matching the excerpt range markers. Explicit positions distinguish same-spelled bindings and still work when earlier renames move declarations. Relation facts keep `from`, `to`, `kind` and optional `property`; their spans are omitted. Source excerpts remain unchanged. Target scope/kind/eligibility/reference metadata and the empty def-use/definition arrays are not sent. Verbose reproduces the previous full serialization and prompt instructions. Both formats retain the existing `{ "names": { "symbolId": "suggestedName" } }` response contract.

The graph traversal and scope fallback rules are unchanged. The planner and corrective retries measure the rendered prompt in the selected format. Compact requests may fit more targets or retain more relation facts within the same byte limit; `maxTargets` and `maxCalls` still apply. This is not a measured token-saving or quality guarantee. To compare serialization alone, render both formats for the same fixed request, rather than comparing independently generated groups.

Request events include `prompt`, the exact naming prompt used by the built-in compatible provider. The web request card and CLI HTML report show it separately from internal analysis/budget metadata. Custom providers may implement their own prompt construction; the event is not proof of what such a provider transmits. Both recovery passes and repair requests retain the selected format.

## Actual token usage

The CLI, web playground and HTML report display provider-reported input/output tokens per response and running totals, including corrective attempts. Missing usage remains unknown, with known subtotals shown separately. No pre-request token or monetary cost estimate is provided. Internal output limits remain in force for provider requests; they are not predictions of usage.

The HTML reporter retries file replacement up to four attempts for EPERM, EACCES and EBUSY. If the file remains locked, it records a report-warning in events.jsonl and warns on stderr without failing inference. The page may remain stale until a later successful refresh; final output.js and result.json are saved independently. Journal or result-write failures and unrelated filesystem errors still propagate. The reporter's warnings array exposes refresh warnings to library callers.

## Source context selection

Use `contextMode: "usage"` (default), CLI `--context-mode usage`, or the web Source context selector to add bounded use excerpts after the normal declaration-based grouping plan. Choose `declarations` for the prior baseline. Both modes retain exactly the same initial groups and relation facts for the same input and settings.

The additive allowance is at most 2,048 UTF-8 prompt bytes per request and never exceeds promptBytes. It can increase billed tokens even though the initial request count stays fixed. At most two uses per target are considered in round-robin order; entries that do not fit are skipped. Short switch expressions and case values identify the enclosing syntax without transmitting the case body; fallthrough remains possible. Overlapping use ranges and shared labels are deduplicated within a request. Metadata records included/omitted selections and added bytes, not token estimates. Corrective retries still obey the total byte limit and may be skipped if the correction suffix cannot fit.

No API evaluation has yet established a naming-quality benefit for this mode.
