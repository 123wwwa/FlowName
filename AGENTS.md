# FlowName product workspace

Current goal: npm library, live HTML reports and install-free web playground. Experimental corpora/results stay local and are excluded by the root .gitignore allowlist. Do not run paid LLM experiments without authorization. Never print or commit API keys.

## Product entrypoints
- src/library.ts: recoverNames(source, options), provider interface, progress events.
- src/html-reporter.ts: self-refreshing local report and final output artifacts.
- src/product-cli.ts: installed flowname executable.
- src/lightweight.ts, request-budget.ts: lexical relations and bounded prompts.
- src/rename.ts: scope-aware collision handling; no source execution.
- web/server.mjs + worker.mjs: allowlisted upstreams, ephemeral keys, isolated per-session work, disconnect cancellation.
- web/index.html, app.js, style.css: browser playground; no localStorage/key persistence.
- web/browser-worker.js, browser-transport.js: static Pages mode, direct provider calls and worker termination on Stop.
- scripts/build-pages.mjs, .github/workflows/pages.yml: browser bundle and automatic Pages deployment; publish only pages-dist.

## Verification
npm test runs product-only offline tests, including web validation, disconnect cleanup and key redaction. npm run test:pages builds and tests the actual browser bundle with mocked API responses, including cancellation and no Node globals. npm run playground builds and serves Node mode locally at127.0.0.1:4173. npm pack stages the public dependency closure via scripts/build-package.mjs. Never publish npm automatically. Package name/license are not finalized. The user authorized automatic website deployment through GitHub Actions on main; repository Pages settings must select GitHub Actions.

Web Stop terminates worker and fetch connections; provider billing may still apply to submitted calls. The library AbortSignal instead drains in-flight requests. Live proposals are provisional until final rename. In Node mode keys/source pass through the host; use HTTPS and disable proxy body logs. In Pages mode keys/context go directly to the API provider from a browser worker; no FlowName backend or key persistence. Never embed a shared key in the bundle or Actions configuration. Browser-direct access depends on provider CORS; offline tests do not prove live model availability.

Keep product sources/tests/scripts referenced by package.json tracked. Do not use ignored experimental sources as dependencies of product builds or tests. Historical quality/token claims are not guarantees. The deployment workflow publishes the static playground after tests; PRs only validate. The flowname subdirectory is intended to become the GitHub repository root.

## Language policy

All new or updated repository content must be written in English: README, documentation, code comments, UI text, CLI messages, generated report templates, examples, and tests. Keep the playground HTML language set to en. Preserve user-provided source code and historical experiment artifacts as data rather than translating them.

## Standalone project location

This directory is the product root. Run all npm commands here. Research data, old results and credentials remain in the parent workspace and are not required to build, test or package this project. The directory can be used as a standalone GitHub repository.
