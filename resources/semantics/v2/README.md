# SEMANTICS benchmark v2

V2 is a separate, versioned benchmark. It does not replace, rewrite, or reinterpret the frozen v1 corpus, manifest, provider results, failure replays, or evaluation narrative.

## Freeze boundary

- Corpus: `alpha-semantics-corpus-v2`
- Evaluator: `alpha-semantics-evaluator-v2`
- Split: 40 development cases and 20 untouched holdout cases
- Pairing: every holdout scenario has two semantically matched development cases with distinct wording
- Gold: profile-specific `goldByProfile.core` and `goldByProfile.augment`
- Runtime path: production P4 projection, provider schema, proposal validation, event reducer, and replay

The manifest pins the corpus hash and both profile contract digests. Any change to the JSONL after freeze invalidates validation. Any correction after a v2 holdout run requires a new benchmark version and a fresh holdout.

## Evaluator rules

Semantic content is assessed with structured predicates for entities, propositions, polarity, conditions, causal and transformation direction, uncertainty, quantities, exact symbolic forms, forbidden propositions, and answer leakage. Final-state gold specifies Active, Support, retained/invalidation, and Cue state after the complete sequence.

A committed checkpoint is preserved if it is consumed exactly once or remains pending. Current-trigger credit comes only from accepted non-KEEP interventions. Deterministic integration tests own checkpoint preservation, duplicate rejection, replay equality, persisted broad-schema compatibility, and later-speech validity.

## Commands

- `npm run eval:semantics:v2:freeze` regenerates the corpus and manifest before freeze.
- `npm run eval:semantics:v2:validate` verifies the frozen corpus and writes offline validation evidence.
- `npm run eval:semantics:v2:live -- --split development --profile core --pass 1` runs provider evaluation.

Do not run holdout until the evaluator and corpus are committed, development failures are classified, genuine development defects are fixed, and the policy is frozen. Holdout is then limited to two or three fresh passes per profile.
