# SEMANTICS v2 development alpha-augment-p4-v2 pass 4

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v2 (49eea74075c7e144321c0103c899bb823a7b7e25c73ecf9af7ec763740133b72)
- Evaluator: alpha-semantics-evaluator-v2
- Policy digest: 9df45be4631de23a59473a36de5e0bd4eafcc186e4a39a8d4f3b83a31743d7a6
- Schema digest: 018a8a9d613ddb5eaf03b14b0d04333d6892e7575cf862674c4eea5e7df88af7
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 29/40 (72.5%)
- Intervention decision: 23/40 (57.5%)
- Board transition: 22/40 (55.0%)
- Cue lifecycle: 26/40 (65.0%)
- Contribution mode: 21/40 (52.5%)
- Semantic content: 27/40 (67.5%)
- RECONSTRUCT: 2/4 (50.0%)
- REPRESENT: 16/22 (72.7%)
- AUGMENT precision: 2/5 (40.0%)
- Must-augment recall: 2/10 (20.0%)
- Malformed/rejected: 0/11
- Tokens (input/cache/output): 191567/162945/12010
- Latency: 148995 ms
- Estimated cost: rates not configured
- Failed cases: SEM2-D2-01, SEM2-D1-02, SEM2-D2-02, SEM2-D1-05, SEM2-D2-05, SEM2-D1-06, SEM2-D1-07, SEM2-D2-07, SEM2-D1-08, SEM2-D2-08, SEM2-D2-09, SEM2-D1-12, SEM2-D2-12, SEM2-D1-13, SEM2-D2-13, SEM2-D1-14, SEM2-D2-14, SEM2-D1-15, SEM2-D1-16, SEM2-D2-16, SEM2-D1-17, SEM2-D2-17, SEM2-D1-18, SEM2-D2-18, SEM2-D1-20

## Critical safety gates

| Gate | Failures | Cases |
|---|---:|---|
| accepted_correct | 0 | — |
| accepted_initiate | 0 | — |
| answer_leakage | 0 | — |
| checkpoint_loss | 0 | — |
| corrected_error_visible | 1 | SEM2-D2-09 |
| cue_augment | 0 | — |
| cue_domain_only | 0 | — |
| current_trigger_missing | 0 | — |
| duplicate_checkpoint_consumption | 0 | — |
| event_schema_incompatibility | 0 | — |
| fabricated_speech_quote | 4 | SEM2-D1-02, SEM2-D2-07, SEM2-D1-12, SEM2-D1-13 |
| history_reactivation | 0 | — |
| invented_hint | 0 | — |
| invented_note | 0 | — |
| invented_question | 0 | — |
| invented_task | 0 | — |
| later_speech_invalidated | 0 | — |
| normal_transcript_mount | 0 | — |
| premature_cue_resolution | 0 | — |
| replay_mismatch | 0 | — |
| unsupported_augment | 3 | SEM2-D2-14, SEM2-D1-16, SEM2-D1-17 |
| unsupported_represent | 0 | — |
