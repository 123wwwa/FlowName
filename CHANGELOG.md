# Changelog

## Unreleased

- Apply names with one edit pass over each binding's own nodes instead of one scope traversal per binding. On a synthetic source with 5,001 bindings (1,001 at the top level) the rename step fell from about 112 seconds to under one second; output matched the previous implementation on 564 comparisons over 141 files. Collision checks are indexed by name.
- Keep the first 100,000 relations of a very large file and add a warning, instead of failing the analysis.
- Rewrite the live HTML report at most about once per second and less often as it grows; `events.jsonl` still records every event. `reporter.fail(error)` marks a run that ended before producing a result, and the CLI calls it.
- Add `planRecovery` and the CLI `--dry-run` for an API-free preview of planned calls and prompt bytes, and `sampleRequests` / `--sample-requests N` for a trial run.
- Repeat a rate-limited request once when the provider sends a `Retry-After` of at most 60 seconds. Other HTTP 429 responses still end the run.
- CLI: read standard input with `-`, write code to a new file or standard output with `-o`, `-q`, `-v`, `-V`, print result warnings, and end the progress line before the summary.
- Remove the unused research CFG analyzer and request builders from the published sources.
- Run tests before `npm publish` and on Windows in CI.

## 1.0.2

- Add CLI API key flags (`--api-key` / `-k`) and the `-m` model alias.
- Load CLI provider settings from `.env`, with flags taking precedence over the environment and `.env`.
- Warn about conflicting configuration sources without displaying their values.
- Show provider error details and missing configuration settings in CLI diagnostics.

## 1.0.1

- Add the FlowName banner and concise Humanify comparison to the README.
- Include README SVG assets in the npm package so the images render on npm.

## 1.0.0

FlowName's first non-prerelease version packages JavaScript identifier recovery as a Node library and CLI, with an install-free browser playground and optional live HTML report.

- Default recovery uses one pass, compact prompts, lightweight relation-guided groups, same-scope fallback and bounded usage excerpts.
- Responses are validated per target. Parseable names are retained; missing or invalid entries receive at most one corrective request, subject to shared budgets.
- Renaming resolves lexical bindings and checks collisions and reference capture. Dynamic constructs and observable name behavior still limit safety; see [limitations](docs/limitations.md).
- Two-pass recovery and linked request propagation are available as opt-in experiments, without demonstrated quality or cost benefits.
- Historical token results are [documented with their limits](docs/experiments.md); they are not a direct benchmark against other libraries.
