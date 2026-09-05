# SEMANTICS v2 development alpha-augment-p4-v1 pass 2

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v2 (97cf71a190694c236ea3127be5e12b8edb3a87addfd598bdda6fa2aedae6abe2)
- Evaluator: alpha-semantics-evaluator-v2
- Policy digest: ac60860280b40d3c4d2bfc6a9c365610f6513967acb7b9d60eeb8006ac781eb1
- Schema digest: 018a8a9d613ddb5eaf03b14b0d04333d6892e7575cf862674c4eea5e7df88af7
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 30/40 (75.0%)
- Intervention decision: 24/40 (60.0%)
- Board transition: 25/40 (62.5%)
- Cue lifecycle: 25/40 (62.5%)
- Contribution mode: 22/40 (55.0%)
- Semantic content: 27/40 (67.5%)
- RECONSTRUCT: 1/4 (25.0%)
- REPRESENT: 16/22 (72.7%)
- AUGMENT precision: 1/1 (100.0%)
- Must-augment recall: 1/10 (10.0%)
- Malformed/rejected: 0/10
- Tokens (input/cache/output): 175056/149960/12423
- Latency: 141073 ms
- Estimated cost: rates not configured
- Failed cases: SEM2-D1-01, SEM2-D1-02, SEM2-D2-02, SEM2-D2-03, SEM2-D2-04, SEM2-D1-05, SEM2-D1-06, SEM2-D2-06, SEM2-D1-07, SEM2-D1-11, SEM2-D1-12, SEM2-D2-12, SEM2-D1-13, SEM2-D2-13, SEM2-D1-14, SEM2-D2-14, SEM2-D1-15, SEM2-D2-15, SEM2-D2-16, SEM2-D1-17, SEM2-D2-17, SEM2-D1-18, SEM2-D2-18, SEM2-D1-20

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
| fabricated_speech_quote | 4 | SEM2-D1-02, SEM2-D1-11, SEM2-D1-12, SEM2-D2-13 |
| history_reactivation | 0 | — |
| invented_hint | 0 | — |
| invented_note | 0 | — |
| invented_question | 0 | — |
| invented_task | 2 | SEM2-D1-01, SEM2-D2-02 |
| later_speech_invalidated | 0 | — |
| normal_transcript_mount | 0 | — |
| premature_cue_resolution | 0 | — |
| replay_mismatch | 0 | — |
| unsupported_augment | 0 | — |
| unsupported_represent | 0 | — |
