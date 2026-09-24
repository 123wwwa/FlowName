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

## Verification
npm test runs product-only offline tests, including web validation, disconnect cleanup and key redaction. npm run playground builds and serves locally at127.0.0.1:4173. npm pack stages the public dependency closure via scripts/build-package.mjs. Never publish automatically. Package name/license and public hosting are not finalized.

Web Stop terminates worker and fetch connections; provider billing may still apply to submitted calls. The library AbortSignal instead drains in-flight requests. Live proposals are provisional until final rename. Keys/source pass through the web host: do not claim browser-direct or zero-knowledge hosting. Use HTTPS and disable proxy request-body logs for public hosting.

Keep product sources/tests/scripts referenced by package.json tracked. Do not use ignored experimental sources as dependencies of product builds or tests. Historical quality/token claims are not guarantees. Current request requires website implementation, not publication.

## Language policy

All new or updated repository content must be written in English: README, documentation, code comments, UI text, CLI messages, generated report templates, examples, and tests. Keep the playground HTML language set to en. Preserve user-provided source code and historical experiment artifacts as data rather than translating them.

## Standalone project location

This directory is the product root. Run all npm commands here. Research data, old results and credentials remain in the parent workspace and are not required to build, test or package this project. The directory can be used as a standalone GitHub repository.
