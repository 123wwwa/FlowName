# Preliminary Axios experiment

[Documentation](README.md) · [Project README](../README.md)

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
