# Usage and deployment guide

[Back to README](../README.md)

## Contract and limits

- `recoverNames(source, options)` returns code, proposed/accepted/rejected/adjusted mappings, status, calls, nullable token usage and analysis warnings.
- Custom providers implement `{ label, async infer(request) }`; see exported TypeScript types. Never embed a shared API key in browser bundles. The static playground accepts each visitor's own key for that session.
- `onEvent` receives plan/request/response/pass-complete/complete events. Request contexts and parsed responses are observable. Observer failure rejects the run and stops new work; in-flight work drains.
- AbortSignal/Ctrl+C stops scheduling and drains in-flight requests (provider timeout still applies). Model-content JSON/schema failures allow one corrective retry per group, subject to call and prompt budgets; other errors are not automatically retried.
- Authentication/quota failures or three consecutive errors stop new work. Partial runs return `status: 'partial'`; missing names stay unchanged. Plan exceeding maxCalls fails before network requests.
- UTF-8 prompt byte budgets are a local proxy, not a tokenizer. Budgeted mode sends declaration excerpts and limited relation facts; omission counts are observable. Output has an explicit token cap. Long-source analysis has size/edge/cooperative-time limits, not a hard parser deadline.
- `rpm` controls request starts, not tokens per minute or dollar spending. Unknown token usage remains null.

## Development and packaging

`npm test` runs offline regression tests. `npm pack` builds an installable alpha tarball with only the public entrypoints' dependency closure. It does not publish. Experiment scripts, old data/results and credentials are excluded from this product repository and package.

Public npm name availability, license choice and npm publication remain release tasks. The playground supports GitHub Pages deployment; an official documentation site is a separate next step.


## Web playground

### GitHub Pages: browser-only hosting

The static build runs analysis and renaming in a Web Worker. API requests go directly from the visitor's browser to the selected provider. GitHub Pages serves the application assets; no FlowName backend receives the key or source. Keys are cleared from the form when submitted, kept in memory for the run, and never written to localStorage, files or analytics. Each visitor supplies their own key and pays their provider's API charges. Do not put an owner API key in the workflow, repository or build environment.

The UI streams per-request progress and suggestions. Stop terminates the worker, including its active connections, while retaining received suggestions on screen. Submitted API requests may still be billed. Source size is capped at 512 KB; each run defaults to 16 concurrent calls, 60 request starts per minute and 1,000 planned calls, with a fixed 20-minute time limit. The web form exposes `concurrency` (1–32), `rpm` (1–6,000), `maxCalls` (1–10,000), `promptBytes` (1,024–1,048,576; default 12,000) and `maxTargets` (1–64; default 16). Settings are validated before API access and locked during a run. RPM paces request starts independently of concurrency. Parsing and AST processing consume the visitor's memory and CPU; the worker keeps this work off the UI thread but has no fixed memory quota.

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

In this mode, keys and source pass through the Node host to an allowlisted provider endpoint; the application writes neither to disk or a database and never loads the host's API key. Use HTTPS when deploying publicly. Avoid request-body logging at your reverse proxy. `HOST` and `PORT` configure binding. Proxy buffering must be disabled for `/api/recover`. There are two concurrent sessions per process, 512 KB source and 20-minute per-session limits. Each session uses the same configurable options and defaults as the static playground. Model IDs are editable; suggested IDs are not an availability guarantee.

The repository `.gitignore` is an allowlist of product sources, product tests, packaging files and the web app. Experiments, results, environment files, package artifacts, caches and generated builds stay local. Ignore rules do not remove files already tracked in an existing repository.

## Partial responses and two-pass recovery

Single-pass recovery is the default. With `passes: 2` (CLI `--passes 2` or web Recovery mode), recovery first handles eligible function/class bindings, applies their accepted names, then replans remaining targets from the rewritten source. Inputs without both target categories use one pass. IDs remain tied to original bindings; source offsets reflect the current pass. Both passes share all execution budgets.

Parseable responses retain valid entries per ID. Unknown IDs are ignored and logged. Only unresolved entries receive one corrective attempt; invalid JSON is not mined for fragments. Partial progress resets the consecutive no-progress failure streak. Pass-two budget/identity-check failures preserve first-pass output and return partial status with warnings.

See [the detailed recovery policy](recovery-passes.md) for pass selection, call reservations, stable IDs, cancellation and event accounting. A completed run can have failedCalls greater than zero when repair succeeds. Unknown usage remains null. Log cards show pass, group, attempt, unresolved reasons and ignored IDs.

## Selecting a recovery mode

Use **Single pass (default)** for a combined, cost-focused plan. **Two passes (experimental)** names functions/classes before remaining identifiers and can increase tokens and elapsed time. Both modes retain partial acceptance and bounded repairs. The selection is locked during an active web run.

CLI: `flowname input.js --out ./new-report --passes 2`. Library: `recoverNames(source, {provider, passes: 2})`. Omit the option or use `1` for single-pass execution. The standalone HTML report is an observer of the selected run; its mode is selected when starting the CLI, not changed inside an already-running report.
