# Motivation and approach

[Documentation](README.md) · [Project README](../README.md)

## Why FlowName exists

FlowName is a personal project for inferring useful names for identifiers whose meaning has been lost. Its scope is semantic identifier recovery, not structural deobfuscation: it does not unpack bundles, undo control-flow flattening or execute input code. AST analysis supports binding identity, inexpensive grouping and safe name application.

**The design priority is useful naming at low token cost and low latency.** Additional context and inference stages have diminishing returns; maximizing naming quality regardless of expense is not the objective. Keep analysis lightweight, avoid repeated context, and require evidence that an added stage provides enough practical benefit to justify its calls, tokens and latency. Exact original-name recovery is not the goal.

FlowName started with a question: **can relation-aware joint inference reduce the token cost of LLM-assisted identifier recovery by asking about related variables together?**

[Humanify](https://github.com/jehna/humanify#readme) documents one LLM call per identifier with a default surrounding context of 500 characters. This is a straightforward approach, but nearby identifiers can cause repeated source context and instructions to be sent across many requests. A fixed local window can also miss relevant uses elsewhere in the code. It does not explicitly group related identifiers for joint inference.

### How JSIMPLIFIER sends naming requests

The source comparison uses the official [XingTuLab/JSIMPLIFIER implementation at commit `eaa72ae`](https://github.com/XingTuLab/JSIMPLIFIER/tree/eaa72ae63758957ac95b2f5e3391fefb96827987). Its OpenAI and Gemini naming paths work as follows:

1. **One target name per invocation, sequentially.** `visitAllIdentifiers` collects Babel binding-identifier paths, sorts them by enclosing context size (largest first), and awaits the rename callback inside a loop. It applies each rename before preparing the next context. There is no multi-identifier response map or relation-guided target batching in these paths.
2. **The default context setting is 1,000, not 500.** `scopeToString` stringifies a selected enclosing scope. If it is shorter than the setting, it sends it whole. For a longer non-program scope, it takes the first 1,000 JavaScript string units. For a longer program scope, it takes the first/last window near boundaries, otherwise slices from `identifier.start - 500` to `identifier.end + 500`. The central slice can therefore exceed 1,000 units by the identifier length; this is not a token budget.
3. **OpenAI:** `chat.completions.create` receives a system instruction naming the single target and requesting a descriptive replacement, plus one user message containing the selected source excerpt. A strict JSON schema requires one string field, `newName`.
4. **Gemini:** a system instruction names the single target; `generateContent(surroundingCode)` supplies the excerpt. JSON MIME type and an object response schema require `newName`.
5. **AST application:** the returned name is normalized with Babel `toIdentifier`; collisions are handled with `_` prefixes before `scope.rename`. Later requests can see earlier renames. The visited set is keyed by name text, not a unique binding ID, so invocation counts should not be equated with all lexical bindings.

These request builders send the target name and source text, without an explicit def-use graph or a related-target list. JSIMPLIFIER's broader deobfuscation pipeline still performs static and dynamic analysis. [Implementation details and pinned source links](jsimplifier-requests.md) cover context selection, provider payloads and the separate local-model helper.

### FlowName's approach

FlowName first resolves identifier occurrences to lexical bindings, so identical spellings in different scopes remain distinct targets. It then extracts syntactic relations from assignments, property accesses, call participants and returns. The request planner follows connections between targets and falls back to remaining bindings in the seed's scope, bounded by group size and prompt bytes. Each request contains target IDs, merged declaration excerpts and in-group relation facts. Reference locations are collected for analysis but are not all expanded into prompt context. This is lightweight relation extraction, not complete JavaScript data-flow or alias analysis.

For example, `const d = b.user; const e = d.permissions; c(e);` connects `d` to `b`, `e` to `d`, and callback `c` to argument `e`. Property facts retain `user` and `permissions` as evidence. This lets the planner ask for several related names together, rather than independently repeating nearby code for each target. The graph selects and describes evidence; the LLM still proposes the names, and AST renaming checks their application.

See the [worked example: source → bindings → relations → requests → applied names](relation-walkthrough.md), including exact IDs and grouping output verified with the current planner, and what changes when a group must be split.

The goal is **useful names with less repeated context and fewer API calls**, rather than exact reconstruction of the author's original spelling. Each request and response is visible in the live HTML report or web playground, including proposed names, applied names and collision adjustments.
