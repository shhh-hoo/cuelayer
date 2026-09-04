# Alpha teaching semantics corpus

`alpha-sequences.jsonl` is the frozen, stateful corpus for the `SEMANTICS` work package. Each line contains an independently replayable lesson prefix, ordered new Evidence Checkpoints, designated provider batches, deterministic semantic constraints, and safety assertions.

`manifest.json` records the exact corpus hash, split membership, coverage counts, and expected policy/profile. Regenerate both files only from `scripts/build-semantics-corpus.ts`, before provider evaluation. Once locked-holdout evaluation begins, do not change holdout gold to match model output; any gold correction requires a separate commit, rationale, version/hash change, and affected reruns. Credential-free provider results and failure replays are retained under `results/`.

The normal test suite validates structure and hashes without provider credentials. `npm run eval:semantics:validate` performs the complete deterministic corpus check. `npm run eval:semantics:live -- --split development` or `--split holdout --pass <n>` invokes the configured production provider once per designated batch and writes results beneath `resources/semantics/results/`.

P4 is fixed. This corpus does not contain context-projection variants or model-judge labels.
