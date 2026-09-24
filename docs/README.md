# FlowName documentation

- [Pre-release edge-case audit](edge-case-audit.md): test coverage, reproduced failures and their fixes.

[Project introduction and quick start](../README.md)

- [Motivation and approach](approach.md): design goals, related tools and relation-guided requests.
- [Relation walkthrough](relation-walkthrough.md): source, bindings, graph, prompts and applied names in a worked example.
- [Architecture](architecture.md): execution diagrams and module responsibilities.
- [Limitations and response recovery](limitations.md): missing context, cross-request consistency and bounded repairs.
- [Historical token measurements](experiments.md): compact vs. verbose, earlier prototype results and the retired Axios benchmark.
- [Usage, contracts and deployment](guide.md): options, budgets, packaging and web hosting.
- [Partial acceptance and recovery passes](recovery-passes.md): response validation and optional name propagation.
- [Two-pass cost assessment](pass-cost-assessment.md): API-free planning measurements, not measured model tokens.
- [JSIMPLIFIER request implementation](jsimplifier-requests.md): precise behavior and pinned source references.
