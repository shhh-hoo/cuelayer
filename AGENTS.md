# Repository working rules

- Read `docs/PRODUCT_CHARTER.md` and `docs/LIVE_TEACHING_SYSTEM_SPEC.md` for current product/execution authority. `docs/SEMANTICS_BASELINE.md` identifies the current frozen evaluation and limitations; `docs/LIVE_TEACHING_ROADMAP.md` owns status/PR mappings.
- Update current contracts in place. Do not add repair diaries, historical amendment stacks, per-run reports or old benchmark genealogies as permanent docs. Put operational steps in the existing runbook and unresolved findings in the baseline.
- Track implementation, reviewed synthetic regression fixtures, and `resources/semantics/current/` corpus/manifest. Generated evaluation results, model outputs, real captions, session traces, timing/integrity summaries and experiment notes belong in ignored `.cuelayer/` or `artifacts/`.
- Keep one canonical evaluator/CLI. Do not copy versioned evaluators/build scripts or regenerate frozen gold as part of routine fixes. Corpus and evaluator changes require scoped review and offline equivalence checks where applicable.
- Production model, semantic policy, schema, deadlines, batching, retries and reducer behavior must not change incidentally during tooling/documentation cleanup. Historical event replay compatibility is production behavior, not disposable benchmark history.
- Paid provider calls, microphone/video playback and private trace uploads require explicit task authorization. Offline tests do not establish live product acceptance.
- Work on a feature branch via PR. Do not merge, deploy or rewrite shared history without authorization. Preserve uncommitted user work.
- Run typecheck, tests, build, `eval:semantics:validate`, diff check and `check:repo`. CI runs `check:repo -- --clean` to ensure validation does not write source-tree outputs.
