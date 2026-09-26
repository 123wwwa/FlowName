# FlowName vs. Humanify on one Cigar input

This is a **single direct run per tool on one identifier-anonymized JavaScript program**, followed by automated name review. The input had 411 lexical bindings and 1,757 physical lines (1,756 code lines); anonymized-input SHA-256: `9bdba857afadb315a6423fdb7a97b8ae6e95ab951de2c4c05ff5c80e5e90380f`. The original source and request/response logs are retained locally and are not published here. The [searchable HTML report](cigar-humanify-2026-09-27.html) contains names and derived labels, but no source excerpts, prompts or credentials.

Both tools used `gemini-3.5-flash-lite` through the same Gemini account. Humanify 3.1.1 used its default ladder JSON strategy, 500-character context and serial walker. FlowName 1.0.0 used its default single pass, compact prompts and bounded use excerpts, with concurrency 16. Request starts were limited to 60 per minute for both. The original author names were withheld from both naming tools.

| Measure | FlowName | Humanify |
| --- | ---: | ---: |
| API calls | 65, including one corrective call | 411 |
| Input tokens | 81,531 | 132,903 |
| Output tokens | 5,576 | 4,429 |
| **Total tokens** | **87,107** | **137,332** |
| Wall time | 67.1 s | 456.2 s |
| Changed names | 407 / 411 | 400 / 411 |
| Exact author-name matches | 46 / 411 | 31 / 411 |

FlowName used **84.18% fewer calls** and **36.57% fewer total tokens**. It used more output tokens but fewer input tokens. The observed wall-time difference was **85.30%**; serial versus concurrent execution is a major factor. Exact author-name matches are shown for transparency, not as a semantic-quality metric.

## Original-aware automated review

Each binding was aligned with the original source by structural AST path. The Jev 1.13 judge received the author's original name, bounded excerpts from the original declaration and references, and both candidate names in mixed A/B order. It was asked separately whether each candidate was useful; when both were useful, it judged preference. Exact spelling was not required. Tool identities were hidden from the judge. All 411 decisions completed, with no API errors.

The current, provisional label policy treats both candidates as useful when each usefulness score is at least 0.5 and pairwise preference confidence is below 0.5. A near-0.5 usefulness warning by itself does not trigger that label. This policy was replayed from recorded Jev responses without new calls. The thresholds are **uncalibrated heuristics**, not probabilities that the final label is correct.

| Automated label | Bindings |
| --- | ---: |
| FlowName better | 155 |
| Humanify better | 37 |
| Both useful | 90 |
| Both poor | 129 |
| Unsure | 0 |

Jev flagged 140 judgments for review. The [HTML report](cigar-humanify-2026-09-27.html) shows current and originally recorded labels, both usefulness scores and review notes. It also records whether Humanify's naming prompt contained the anonymized target spelling:

| Target in Humanify prompt | Bindings | FlowName better | Humanify better | Both useful | Both poor |
| --- | ---: | ---: | ---: | ---: | ---: |
| Present | 211 | 38 | 37 | 90 | 46 |
| Absent | 200 | 117 | 0 | 0 | 83 |

The overall preference is strongly associated with the missing-target subset. The target-visible subset is nearly tied on exclusive wins. This run therefore does **not** isolate the effect of relation-guided grouping or establish a general naming-quality advantage. Jev is an automated, uncalibrated judge; human ratings and more programs are needed. The tools also differ in prompt construction, response format, sampling settings and concurrency. Neither output underwent a runtime behavior-equivalence test.

The published HTML omits original code and raw provider traffic. Local audit files preserve those inputs, requests, responses and the previous blind review for further investigation.
