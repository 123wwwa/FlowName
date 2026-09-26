# Changelog

## 1.0.0

FlowName's first non-prerelease version packages JavaScript identifier recovery as a Node library and CLI, with an install-free browser playground and optional live HTML report.

- Default recovery uses one pass, compact prompts, lightweight relation-guided groups, same-scope fallback and bounded usage excerpts.
- Responses are validated per target. Parseable names are retained; missing or invalid entries receive at most one corrective request, subject to shared budgets.
- Renaming resolves lexical bindings and checks collisions and reference capture. Dynamic constructs and observable name behavior still limit safety; see [limitations](docs/limitations.md).
- Two-pass recovery and linked request propagation are available as opt-in experiments, without demonstrated quality or cost benefits.
- Historical token results are [documented with their limits](docs/experiments.md); they are not a direct benchmark against other libraries.
