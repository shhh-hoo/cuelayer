# SEMANTICS v2 development alpha-augment-p4-v4 pass 6

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v2 (22d1456f1195dec9bf86023ab1d503ab0be025176bcf9d716ab940e028f52565)
- Evaluator: alpha-semantics-evaluator-v2
- Policy digest: 1aa261b295c0f7035d2c58bec88559217b57ce02c25e04baa8b634207f16213c
- Schema digest: 018a8a9d613ddb5eaf03b14b0d04333d6892e7575cf862674c4eea5e7df88af7
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 38/40 (95.0%)
- Intervention decision: 35/40 (87.5%)
- Board transition: 34/40 (85.0%)
- Cue lifecycle: 35/40 (87.5%)
- Contribution mode: 34/40 (85.0%)
- Semantic content: 37/40 (92.5%)
- RECONSTRUCT: 2/4 (50.0%)
- REPRESENT: 20/22 (90.9%)
- AUGMENT precision: 9/9 (100.0%)
- Must-augment recall: 9/10 (90.0%)
- Malformed/rejected: 0/2
- Tokens (input/cache/output): 197579/167992/18666
- Latency: 248573 ms
- Estimated cost: rates not configured
- Failed cases: SEM2-D1-02, SEM2-D2-02, SEM2-D1-03, SEM2-D2-06, SEM2-D1-07, SEM2-D2-08, SEM2-D2-13, SEM2-D2-17, SEM2-D1-18, SEM2-D2-18

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
| invented_task | 0 | — |
| later_speech_invalidated | 0 | — |
| normal_transcript_mount | 0 | — |
| premature_cue_resolution | 0 | — |
| replay_mismatch | 0 | — |
| unsupported_augment | 0 | — |
| unsupported_represent | 0 | — |
