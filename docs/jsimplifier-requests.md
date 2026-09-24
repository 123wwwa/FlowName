# JSIMPLIFIER naming requests

[Back to README](../README.md)

This source inspection covers the official XingTuLab/JSIMPLIFIER repository at commit `eaa72ae63758957ac95b2f5e3391fefb96827987`, inspected on September 24, 2026. It describes implementation behavior, not a measured comparison or a claim about every released version. The project is JSIMPLIFIER, as identified by the [paper's repository reference](https://arxiv.org/html/2512.14070v1#bib.bib17).

## Target traversal and context

[`visit-all-identifiers.ts`](https://github.com/XingTuLab/JSIMPLIFIER/blob/eaa72ae63758957ac95b2f5e3391fefb96827987/src/plugins/variable-rename/visit-all-identifiers.ts) parses with Babel and collects `BindingIdentifier` paths. It measures their enclosing blocks and sorts in descending size order. A `for...of` loop awaits one rename callback per visited target; this is sequential within a file, not a parallel batch of target names.

`closestSurroundingContextPath` finds an ancestor that is a program or exposes the target through `getOuterBindingIdentifiers`, then uses that ancestor's scope path, falling back to the target's own scope path. `scopeToString` renders that selected path as source and applies these rules, with `N = contextWindowSize`:

| Condition | Source sent |
| --- | --- |
| Rendered context length < N | Entire rendered context |
| Longer context, not a Program | `code.slice(0, N)` |
| Program and identifier end < N / 2 | `code.slice(0, N)` |
| Program and identifier start > rendered length − N / 2 | `code.slice(-N)` |
| Other Program case | `code.slice(start - N / 2, end + N / 2)` |

The [default is 1,000](https://github.com/XingTuLab/JSIMPLIFIER/blob/eaa72ae63758957ac95b2f5e3391fefb96827987/src/commands/default-args.ts), and the [deobfuscate command](https://github.com/XingTuLab/JSIMPLIFIER/blob/eaa72ae63758957ac95b2f5e3391fefb96827987/src/commands/deobfuscate.ts) passes its `--contextSize` setting to the providers. Length and slicing use JavaScript UTF-16 string units, not bytes or tokens. The central Program slice includes the identifier span in addition to N units. The implementation uses identifier node offsets against regenerated context text; it does not recompute those offsets for that rendered text.

After each callback, a changed suggestion is normalized with `toIdentifier`. The code prefixes `_` while the name occurs in the run's rename set or `scope.hasBinding`, then invokes `scope.rename`. Subsequent context is rendered from the updated AST. A name-text visited set skips already-seen names, so the exact number of invocations is not necessarily the number of distinct bindings. No separate conversation history is supplied by the two cloud request builders.

## OpenAI-compatible path

[`openai-rename.ts`](https://github.com/XingTuLab/JSIMPLIFIER/blob/eaa72ae63758957ac95b2f5e3391fefb96827987/src/plugins/openai/openai-rename.ts) creates an OpenAI SDK client with `apiKey` and `baseURL`. Each callback invokes `client.chat.completions.create` with:

- The configured model.
- A system message identifying one target name, asking for a descriptive name based on usage, and instructing against reusing a previously mentioned name.
- One user message containing only `surroundingCode`.
- `response_format.type = json_schema`, schema name `rename`, and strict validation for an object with the required string property `newName` and no additional properties.

It reads `response.choices[0].message.content`, parses JSON, and returns `.newName` to the traversal. The request builder sets neither temperature nor an explicit output-token limit. Invocation counts here refer to application-level SDK calls; SDK transport retries are not established by this inspection. The wrapper records returned token usage, elapsed time and estimated cost in a JSONL file when usage exists.

## Gemini path

[`gemini-rename.ts`](https://github.com/XingTuLab/JSIMPLIFIER/blob/eaa72ae63758957ac95b2f5e3391fefb96827987/src/plugins/gemini-rename.ts) uses `@google/generative-ai`. Per callback, it obtains a model with the configured model ID and a system instruction naming one target and asking for a descriptive replacement. Its generation configuration requests `application/json` and an object schema with a required string `newName`. It calls `model.generateContent(surroundingCode)` and returns the parsed `.newName`. It does not supply a target array, a def-use graph, temperature or an output-token limit in this wrapper.

## Separate local-model helper

The repository also contains [`local-llm-rename.ts`](https://github.com/XingTuLab/JSIMPLIFIER/blob/eaa72ae63758957ac95b2f5e3391fefb96827987/src/plugins/variable-rename/local-llm-rename.ts). This is a different request sequence, not the OpenAI/Gemini path described above:

1. [`define-filename.ts`](https://github.com/XingTuLab/JSIMPLIFIER/blob/eaa72ae63758957ac95b2f5e3391fefb96827987/src/plugins/variable-rename/define-filename.ts) uses two prompt calls to summarize the first 400 source units and propose a filename.
2. For each visited identifier, [`unminify-variable-name.ts`](https://github.com/XingTuLab/JSIMPLIFIER/blob/eaa72ae63758957ac95b2f5e3391fefb96827987/src/plugins/variable-rename/unminify-variable-name.ts) first asks for a role description using the filename and surrounding code, then asks for a name from that description. Outputs are grammar-constrained.

The inspected `deobfuscate` model dispatch selects OpenAI, Gemini or no LLM; it imports the local helper but does not select it in those branches. Its presence should not be described as the default cloud behavior.

## Comparison scope

The verified difference is in naming-request construction: JSIMPLIFIER's inspected cloud paths pass one target name and scope-derived source text; FlowName groups targets using lightweight relations and scope fallback, sending bounded source excerpts and relation facts. This does not mean JSIMPLIFIER lacks static or dynamic analysis elsewhere. FlowName's Axios table compares its own prototype configurations, not executions of JSIMPLIFIER.
