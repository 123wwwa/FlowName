# How FlowName compares with Humanify

[Documentation](README.md) · [Project README](../README.md) · [Direct-run results](benchmarks/cigar-humanify-2026-09-27.md)

Both tools use static analysis to distinguish bindings and apply LLM-proposed names. FlowName also uses lightweight relations to decide which targets share a request and which evidence fits the prompt budget.

| Stage | Humanify | FlowName |
| --- | --- | --- |
| Implementation and analysis | Rust with Oxc | TypeScript with Babel |
| Identifier identity | Scopes and symbols | Scopes and lexical bindings |
| Request planning | Select context for one binding at a time | Group connected targets, with remaining targets from the same scope as a fallback |
| Evidence sent to the LLM | Selected source context and the target name | Target IDs, declaration excerpts, bounded use excerpts and in-group relation facts |
| LLM response | One proposed name | Proposed names keyed by target ID |
| Applying names | Symbol-based renaming with collision and reference-capture checks | Binding-based renaming with collision and reference-capture checks |

Humanify's Oxc layer parses the source, resolves symbols and emits renamed code; it does not perform structural deobfuscation in this naming pipeline. See its [rename implementation](https://github.com/jehna/humanify/blob/main/src/rename/walker.rs) and [LLM prompt](https://github.com/jehna/humanify/blob/main/src/llm/renamer.rs).

This table describes architecture. It does not by itself demonstrate comparative safety or performance. The separate [Cigar benchmark notes](benchmarks/cigar-humanify-2026-09-27.md) explain one live comparison, including the 411-binding input, API usage, automated name judgments and limitations.
