# SEMANTICS v2 holdout alpha-augment-p4-v4 pass 1

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v2 (22d1456f1195dec9bf86023ab1d503ab0be025176bcf9d716ab940e028f52565)
- Evaluator: alpha-semantics-evaluator-v2
- Policy digest: 1aa261b295c0f7035d2c58bec88559217b57ce02c25e04baa8b634207f16213c
- Schema digest: 018a8a9d613ddb5eaf03b14b0d04333d6892e7575cf862674c4eea5e7df88af7
- Structured parse: 20/20 (100.0%)
- Accepted/conflict-handled: 20/20 (100.0%)
- Intervention decision: 18/20 (90.0%)
- Board transition: 17/20 (85.0%)
- Cue lifecycle: 18/20 (90.0%)
- Contribution mode: 19/20 (95.0%)
- Semantic content: 20/20 (100.0%)
- RECONSTRUCT: 1/2 (50.0%)
- REPRESENT: 11/11 (100.0%)
- AUGMENT precision: 5/5 (100.0%)
- Must-augment recall: 5/5 (100.0%)
- Malformed/rejected: 0/0
- Tokens (input/cache/output): 100635/87648/8888
- Latency: 96276 ms
- Estimated cost: rates not configured
- Failed cases: SEM2-H-01, SEM2-H-02, SEM2-H-03, SEM2-H-06, SEM2-H-17, SEM2-H-19

## Critical safety gates

| Gate | Failures | Cases |
|---|---:|---|
| accepted_correct | 0 | — |
| accepted_initiate | 0 | — |
| answer_leakage | 0 | — |
| checkpoint_loss | 0 | — |
| corrected_error_visible | 0 | — |
| cue_augment | 0 | — |
| cue_domain_only | 0 | — |
| current_trigger_missing | 0 | — |
| duplicate_checkpoint_consumption | 0 | — |
| event_schema_incompatibility | 0 | — |
| fabricated_speech_quote | 0 | — |
| history_reactivation | 0 | — |
| invented_hint | 0 | — |
| invented_note | 0 | — |
| invented_question | 0 | — |
| invented_task | 1 | SEM2-H-01 |
| later_speech_invalidated | 0 | — |
| normal_transcript_mount | 0 | — |
| premature_cue_resolution | 0 | — |
| replay_mismatch | 0 | — |
| unsupported_augment | 0 | — |
| unsupported_represent | 0 | — |
