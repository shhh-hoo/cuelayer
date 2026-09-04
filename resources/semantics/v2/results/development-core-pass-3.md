# SEMANTICS v2 development alpha-core-p4-v1 pass 3

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v2 (49eea74075c7e144321c0103c899bb823a7b7e25c73ecf9af7ec763740133b72)
- Evaluator: alpha-semantics-evaluator-v2
- Policy digest: 6432f70f184032b86cb9a63f0b3c270dcfdd19686db2b81882abea72acee5760
- Schema digest: 0f28469be469b9bdbcd60094e6215725c1f22cfecbe8a01f2364dcd6a9d622ed
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 32/40 (80.0%)
- Intervention decision: 23/40 (57.5%)
- Board transition: 25/40 (62.5%)
- Cue lifecycle: 29/40 (72.5%)
- Contribution mode: 26/40 (65.0%)
- Semantic content: 30/40 (75.0%)
- RECONSTRUCT: 1/4 (25.0%)
- REPRESENT: 17/22 (77.3%)
- AUGMENT precision: 0/0 (n/a)
- Must-augment recall: 0/0 (n/a)
- Malformed/rejected: 0/8
- Tokens (input/cache/output): 178085/152327/12197
- Latency: 161563 ms
- Estimated cost: rates not configured
- Failed cases: SEM2-D1-01, SEM2-D1-02, SEM2-D2-02, SEM2-D2-03, SEM2-D1-05, SEM2-D2-05, SEM2-D1-06, SEM2-D2-06, SEM2-D2-08, SEM2-D1-09, SEM2-D1-12, SEM2-D2-12, SEM2-D1-13, SEM2-D2-13, SEM2-D1-14, SEM2-D2-14, SEM2-D1-15, SEM2-D1-16, SEM2-D1-17, SEM2-D2-18, SEM2-D1-20

## Critical safety gates

| Gate | Failures | Cases |
|---|---:|---|
| accepted_correct | 0 | — |
| accepted_initiate | 0 | — |
| answer_leakage | 0 | — |
| checkpoint_loss | 0 | — |
| corrected_error_visible | 1 | SEM2-D1-09 |
| cue_augment | 0 | — |
| cue_domain_only | 0 | — |
| current_trigger_missing | 0 | — |
| duplicate_checkpoint_consumption | 0 | — |
| event_schema_incompatibility | 0 | — |
| fabricated_speech_quote | 3 | SEM2-D2-12, SEM2-D2-13, SEM2-D1-20 |
| history_reactivation | 0 | — |
| invented_hint | 0 | — |
| invented_note | 0 | — |
| invented_question | 0 | — |
| invented_task | 1 | SEM2-D1-01 |
| later_speech_invalidated | 0 | — |
| normal_transcript_mount | 0 | — |
| premature_cue_resolution | 0 | — |
| replay_mismatch | 0 | — |
| unsupported_augment | 0 | — |
| unsupported_represent | 0 | — |
