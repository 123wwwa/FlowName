# Changelog

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
