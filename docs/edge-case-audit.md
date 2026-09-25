# Pre-release edge-case audit

Date: 2026-09-24. The initial audit added tests without implementation changes. The user subsequently authorized fixes for all three reproduced failures; those fixes and additional regressions are now included. No live model calls were made.

## Execution

- `npm run test:edges`: builds and runs the new edge-case suite.
- `npm test`: includes the new suite alongside existing product tests.
- `npm run test:pages`: checks the actual browser bundle with mocked network responses.

The initial suite contained 35 tests and reproduced 3 failures. After fixes and 3 additional regression tests, all 38 edge-case tests and all 64 combined product tests pass. All 8 browser tests pass. Original failing assertions remain enabled; none were skipped or weakened.

Only authored, bounded fixtures are executed in a VM. Behavioral checks compare returned values, side effects captured in the fixture result, or exception types. These tests do not prove equivalence for arbitrary JavaScript and are not token-efficiency or semantic-quality benchmarks.

## Coverage added

- Binding identity: simultaneous cyclic renames, duplicate proposals, opposite response completion orders, recursive expressions, function/parameter name reuse, catch shadowing and loop closures.
- Syntax: nested destructuring/defaults/rest, reassignment patterns, generator bindings, private fields, inheritance and outer references in default arguments.
- Modules and JSX: import aliases, default and named export identity, re-exports, JSX member properties and intrinsic tags.
- Provider responses: reserved identifiers, invalid values and types, long names, raw duplicate JSON IDs, hostile but valid identifiers and malformed custom-provider output.
- Execution: cancellation with an active request, observer failure and draining, shared retry caps, transport timeout classification, pre-aborted signals and unsupported TypeScript syntax before networking.
- Reporting: source/error HTML escaping, event-journal completeness and consistency between event usage and final usage.

Existing tests additionally cover partial acceptance, missing IDs, bounded format repair, HTTP quota handling, byte limits and pass-boundary cancellation.

## Reproduced failures and resolutions

### Re-export incorrectly protects an unrelated local binding

```js
const value = 1;
export { value } from 'external-module';
console.log(value);
```

The re-export refers to the external module, not the local `value`. Nevertheless, `lightweight` marks the local binding ineligible because its ExportSpecifier visitor looks up the local name without checking the export source.

Resolution: the ExportSpecifier visitor now ignores re-exports when determining which local bindings are protected.

Original impact: legitimate recovery targets were silently omitted. The fixture does not establish a behavior-changing rewrite. Suggested correction: distinguish local exports from re-exports before protecting bindings.

### Duplicate response IDs silently select the last value

```json
{"names":{"s6":"first","s6":"second"}}
```

The compatible provider uses `JSON.parse`, which collapses duplicate keys before per-ID validation. Recovery accepts `second` and reports `completed` after one call.

Resolution: after syntax validation, an iterative structural scan checks decoded keys per object before the parsed response is accepted. Duplicate keys (including Unicode-escaped equivalents and duplicate `names` containers) cause a format error and use the existing single repair budget. Identical keys in separate objects and key-like string contents remain valid. The ambiguous response is rejected as a whole; this check applies to the model content, not the HTTP envelope.

Original impact: an ambiguous response was accepted despite the prompt requiring each target exactly once. This is a response-contract hardening gap, not evidence that every duplicate response corrupts program behavior. The new test requires rejecting repeated target IDs and allowing the existing single repair; repeated ambiguity should leave the target unresolved. A fix should parse duplicates structurally, not rely on a regular expression over escaped JSON text.

### Known token usage is lost in malformed-response events

A custom provider returns `{names: null, inputTokens: 7, outputTokens: 3}`. The final result correctly preserves 7/3 tokens, but the response event reports null/null after conversion to a format error.

Resolution: the custom-provider format error carries the already-recorded usage into response events, retaining the guard against double counting. Both a terminal failure and a successful repair are covered.

Original impact: the event journal and terminal progress disagreed with the final result. Final billing totals are not lost in this reproduction. Suggested correction: preserve the recorded usage on the error/event path without counting it twice.

## Limits and next step

The timeout fixture injects a transport TimeoutError; it verifies retry and usage behavior, not real elapsed-time timeout enforcement. JSX classification is checked structurally here; this is not a browser rendering suite. No new claims are made about reflection, indirect eval or classic-script global properties, which remain documented limitations.

All three fixes were authorized and verified. The local initial failure output remains in `release-audit/edge-suite-output.txt` as a historical record, not the current test status; it is not part of the published package.

## September 25: analysis and source-coverage regressions

- Both lexical and CFG analyzers now protect potential direct eval even when the callee has a local binding. An authored fixture passes the intrinsic evaluator as a parameter and verifies that the protected result still returns 42 without model calls.
- The CFG analyzer checks constantViolations as well as referencePaths for cross-function access. Write-only closure assignments, updates, compound/destructuring writes and loop targets force conservative reaching definitions; same-function assignments retain the structured path. The lexical product path makes no reaching-definition claim.
- CFG export protection now matches the lexical path: public bindings remain protected, parameters and implementation locals stay eligible, and re-exports do not protect unrelated locals.
- Declaration coverage uses structured source ranges, never markers parsed from source comments. Full-source and excerpt requests preserve literal marker-like comments; budget reduction removes complete excerpts and their ranges together. Coverage ranges are internal metadata and are excluded from model prompt serialization.
