# Historical token measurements

[Documentation](README.md) · [Project README](../README.md)

## Current compact vs. historical local-500

The current compact run used **60.45% fewer total tokens** than the historical local-500 run on the full Axios input with 1,800 targets:

| Run | Total tokens | Targets left unresolved |
| --- | ---: | ---: |
| Historical local-500 prototype | 732,742 | 2 |
| Current compact library | 289,823 | 16 |

The reduction is calculated directly from recorded totals: `(732742 - 289823) / 732742 × 100 = 60.45%`, or 442,919 fewer tokens. Failed-response usage and, for compact, repair usage are included.

This is a comparison across separate runs and implementations, not a controlled measurement of one change. Grouping, context budgets and repair policies differ. The earlier 25.96% batching reduction and the later 29.32% compact-versus-verbose reduction have different baselines and are not added or compounded to obtain this figure. Equivalent semantic quality was not established, and successful response coverage differs. The observation is specific to this retired input; it is neither a guarantee for other code nor a direct benchmark against Humanify or JSIMPLIFIER.

## Compact vs. verbose

On September 24, 2026, the current library ran each prompt format once against the same identifier-anonymized Axios 1.20.0 browser distribution: 4,400 nonblank, noncomment input lines and 1,800 eligible bindings. Both initial plans had 399 requests with **identical target groups, source excerpts and relation facts**. The changed variable was prompt serialization, not the grouping algorithm.

Settings: `gemini-3.5-flash-lite`, temperature 0, one pass, maximum concurrency 32, RPM 600, maximum 1,000 calls per format, 12,000 prompt bytes and 16 targets per group. The existing bounded repair policy allowed one correction request per group. Maximum observed concurrent provider calls were 17 for compact and 16 during verbose recovery.

| Format | Initial calls | Repair calls | Input tokens | Output tokens | Total tokens | Unresolved targets |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Compact | 399 | 5 | 265,783 | 24,040 | **289,823** | 16 |
| Verbose | 399 | 2 | 385,780 | 24,242 | **410,022** | 0 |

Compact saved **120,199 total tokens (29.32%)** and **31.11% of input tokens**, including failed responses and repairs. Provider usage was reconciled against every recorded request and response. Both formats requested all 1,800 targets. One compact group still had invalid JSON after its correction attempt; those 16 targets remained unresolved. Receiving a valid identifier is not a semantic-quality score. Neither semantic quality nor behavioral equivalence was evaluated in this comparison; both recovered outputs parsed successfully.

Verbose was interrupted by a Windows `EPERM` error while replacing the live HTML report. All 248 submitted requests had saved responses, which were reused without additional API calls; only the remaining requests were sent. Timing is therefore not a valid comparison. The report-writer stability issue remains separate from the prompt-format result.

This observation supports keeping compact as the default and verbose as an optional format. It does not establish equal naming quality, universal savings, or improvement over external libraries. The earlier prototype results below use different budgets and should not be combined with this reduction percentage.

Local evidence is preserved in `release-audit/axios-formats-2026-09-24T14-11-41-387Z/`: `summary.json`, `metadata.json`, the original input snapshot, request/response journals and HTML name comparisons. These ignored artifacts are not shipped in the repository or npm package. Input SHA-256: `21bee36069241e4c5f16bdf8c3bb88b418402251719bbaff466e7d1798441849`.

## Retired benchmark input

Axios is no longer an active benchmark case. Its browser distribution mixes application code with transpiler helpers and originally short identifiers, making original-name comparisons difficult to interpret as semantic recovery quality. The active Axios corpus and dedicated execution tools have been removed; recorded results remain historical evidence. No replacement corpus or generalization claim is implied by this change.

## Earlier prototype comparison

An exploratory prototype experiment used the **entire Axios 1.20.0 browser distribution**, with identifier-only anonymization: **4,400 nonblank, noncomment input lines and 1,800 target bindings**. It included all scopes and transpiler helpers, not extracted function samples. Original names were retained for inspection but were not sent to the model.

Each method ran once with `gemini-3.5-flash-lite`, temperature 0, concurrency 32 and no retries. All three methods below were implemented in the FlowName research prototype; these are **not direct benchmarks of Humanify or JSIMPLIFIER**.

| Prototype method | API calls | Input tokens | Output tokens | Total tokens | Reduction vs. local-500 |
| --- | ---: | ---: | ---: | ---: | ---: |
| local-500 | 1,800 | 703,927 | 28,815 | 732,742 | Baseline |
| relation-guided | 936 | 562,099 | 26,867 | 588,966 | 19.62% |
| relation-guided-scope | 712 | 516,723 | 25,788 | 542,511 | **25.96%** |

- **local-500:** one target per request with a 500-character source window in total, plus prompt instructions. This is an analogous baseline, not an exact reproduction of Humanify.
- **relation-guided:** up to four related targets per request, with a 1,600-character source budget and relation metadata.
- **relation-guided-scope:** the same relation groups, with remaining singletons additionally batched within their lexical scope, up to four targets per request.

The scope-assisted method used **60.44% fewer calls** than local-500. Both input and output token totals decreased in this run. Request intervals were 53.360 seconds, 32.929 seconds and 22.797 seconds respectively; these are individual observations, not controlled latency guarantees.

Response validation failed for 2, 2 and 5 requests respectively, leaving 2, 8 and 16 targets without an applied response. Reported usage includes those failed responses; successful target coverage therefore differs. All three outputs passed the same fixed Axios public-API behavior checks, which do not prove full behavioral equivalence.

Manual inspection motivated continued development, but semantic naming quality and cross-variable consistency were not formally scored. Exact original-name matches are not a substitute: multiple names can describe the same role, and the original distribution itself contains single-letter names.

**These results support the initial batching hypothesis on one input.** They do not establish equivalent naming quality, general savings on other code, or the separate contribution of relation analysis versus simple batching. The current library adds different request budgets and planning behavior; the table describes the earlier prototype, not a benchmark of the current release. Research datasets and raw experiment logs are not included in this product repository.
