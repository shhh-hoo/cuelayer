# SEMANTICS v2 development alpha-core-p4-v1 pass 1

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v2 (2a29f2dc9df59a2f734e47bb007ca6c42d79e60f2a49f787bef2fd2b4949d58d)
- Evaluator: alpha-semantics-evaluator-v2
- Policy digest: 6432f70f184032b86cb9a63f0b3c270dcfdd19686db2b81882abea72acee5760
- Schema digest: 0f28469be469b9bdbcd60094e6215725c1f22cfecbe8a01f2364dcd6a9d622ed
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 31/40 (77.5%)
- Intervention decision: 21/40 (52.5%)
- Board transition: 14/40 (35.0%)
- Cue lifecycle: 20/40 (50.0%)
- Contribution mode: 26/40 (65.0%)
- Semantic content: 22/40 (55.0%)
- RECONSTRUCT: 1/4 (25.0%)
- REPRESENT: 11/22 (50.0%)
- AUGMENT precision: 0/0 (n/a)
- Must-augment recall: 0/0 (n/a)
- Malformed/rejected: 0/9
- Tokens (input/cache/output): 169815/142604/11751
- Latency: 162743 ms
- Estimated cost: rates not configured
- Failed cases: SEM2-D2-01, SEM2-D1-02, SEM2-D2-02, SEM2-D1-04, SEM2-D2-04, SEM2-D1-05, SEM2-D1-06, SEM2-D2-06, SEM2-D1-07, SEM2-D2-07, SEM2-D1-08, SEM2-D2-08, SEM2-D2-09, SEM2-D1-10, SEM2-D2-10, SEM2-D1-11, SEM2-D1-12, SEM2-D2-12, SEM2-D1-13, SEM2-D2-13, SEM2-D1-14, SEM2-D2-14, SEM2-D1-15, SEM2-D2-15, SEM2-D1-16, SEM2-D2-16, SEM2-D1-17, SEM2-D2-17, SEM2-D1-18, SEM2-D2-18, SEM2-D1-20

## Critical safety gates

| Gate | Failures | Cases |
|---|---:|---|
| accepted_correct | 0 | — |
| accepted_initiate | 0 | — |
| answer_leakage | 0 | — |
| checkpoint_loss | 0 | — |
| corrected_error_visible | 3 | SEM2-D2-09, SEM2-D1-10, SEM2-D2-10 |
| cue_augment | 0 | — |
| cue_domain_only | 0 | — |
| current_trigger_missing | 12 | SEM2-D1-05, SEM2-D1-06, SEM2-D1-07, SEM2-D1-10, SEM2-D1-11, SEM2-D1-12, SEM2-D1-14, SEM2-D2-14, SEM2-D2-15, SEM2-D1-17, SEM2-D2-18, SEM2-D1-20 |
| duplicate_checkpoint_consumption | 0 | — |
| event_schema_incompatibility | 0 | — |
| fabricated_speech_quote | 3 | SEM2-D1-07, SEM2-D1-11, SEM2-D1-14 |
| history_reactivation | 1 | SEM2-D1-18 |
| invented_hint | 0 | — |
| invented_note | 0 | — |
| invented_question | 0 | — |
| invented_task | 6 | SEM2-D1-13, SEM2-D2-13, SEM2-D1-15, SEM2-D1-16, SEM2-D2-16, SEM2-D2-17 |
| later_speech_invalidated | 0 | — |
| normal_transcript_mount | 0 | — |
| premature_cue_resolution | 0 | — |
| replay_mismatch | 0 | — |
| unsupported_augment | 0 | — |
| unsupported_represent | 0 | — |
