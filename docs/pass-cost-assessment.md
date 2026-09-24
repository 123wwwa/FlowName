# Cost assessment of two-pass propagation

[Back to README](../README.md) · [Recovery implementation](recovery-passes.md)

## What two passes actually do

The optional two-pass implementation separates eligible function/class bindings from all remaining eligible identifiers. It names the first set, applies accepted names with collision handling, rebuilds analysis, then names the second set using the updated source. Initial target sets are disjoint: a target is not deliberately named once in each pass. A corrective attempt may repeat unresolved targets once.

This does not imply that two passes are cost-neutral. Splitting a connected group can add requests, repeated instructions, target metadata and source excerpts. Longer inferred names can enlarge second-pass context. Group boundaries also change which relation facts are transmitted. The pass boundary adds local rename/parse/plan work and prevents pass-two calls from overlapping pass one. Sharing concurrency and RPM budgets bounds execution; it does not remove this overhead.

## API-free measurement

Measured locally on September 24, 2026, using the current planner and prompt template, with `maxTargets = 16` and `promptBytes = 12000`. The complete existing Axios anonymized input was read without sampling or edits: 132,630 UTF-8 bytes, 4,402 physical lines and 1,800 eligible bindings. Its SHA-256 is `21bee36069241e4c5f16bdf8c3bb88b418402251719bbaff466e7d1798441849`. The local research input is not shipped with the product.

No model API was invoked, no semantic outputs were generated, and no retry was simulated.

| Planning condition | Target count | Requests | Sum of rendered prompt bytes |
| --- | ---: | ---: | ---: |
| Single combined target set | 1,800 | 399 | 1,046,102 |
| Priority set only | 416 | 202 | 292,733 |
| Remaining set only, original source | 1,384 | 359 | 851,264 |
| Two sets combined, original source | 1,800 | 561 | 1,143,997 |
| Two passes with no name changes, including rename/reparse at the boundary | 1,800 | 561 | 1,143,997 |

Compared with the single combined plan, partitioning added **162 requests (+40.60%)** and **97,895 prompt bytes (+9.36%)**. The no-name-change boundary produced the same totals for this input. This isolates grouping overhead; it is neither a lower nor an upper bound on a real run with generated names.

The configured output-token allowances sum to 166,272 for the single plan and 187,008 for the split plan. These are limits, not generated output or billable usage. They follow `128 × requests + 64 × targets`. Actual output may be much smaller.

## What is still unknown

- Actual input tokens: UTF-8 bytes cannot establish the model tokenizer's counts. A 9.36% byte increase is not a measured 9.36% token increase.
- Actual output tokens: no model names were generated. Name lengths, omissions and repairs affect usage.
- Cost: input and output tokens can have different rates. Request count or total bytes alone do not establish money spent.
- Latency: more requests, RPM pacing and a pass dependency can increase elapsed time; this planning comparison did not measure an inference run.
- Benefit: neither semantic naming quality nor consistency was evaluated here. The previous single-run prototype results do not validate this new policy.

For an authorized comparison, use the same full input, model, request budgets, acceptance/retry policy and execution limits. Compare a combined target plan against the actual two-pass path. Record input/output usage, calls, repairs, completed target coverage and end-to-end elapsed time, including local work. Include usage from failed/partial attempts and retain unknown usage as unknown. Compare incremental quality only to the extent needed to judge whether the additional cost is worthwhile; exact original-name matches are not sufficient.

For measured usage, monetary change is `delta input tokens × input rate + delta output tokens × output rate`, with rates expressed per token. No fixed growth percentage should be assumed across codebases.

## Product decision

FlowName's objective is practical semantic naming at low cost and low latency, using lightweight analysis. This measurement establishes a tangible overhead for the current partitioning on one input; it does not establish a compensating benefit. Two-pass propagation remains an experimental implementation, not a proven default optimization. A combined single-pass plan is the cost baseline. Any decision to make propagation optional, conditional or the default should account for this tradeoff explicitly.

This assessment itself used no paid requests. Following this assessment, single-pass recovery became the default and two-pass propagation became opt-in through the web, CLI and library API. The recorded measurements describe the comparison at the time, not a fresh benchmark after each subsequent edit.
