# SEMANTICS v2 development alpha-core-p4-v3 pass 5

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v2 (22d1456f1195dec9bf86023ab1d503ab0be025176bcf9d716ab940e028f52565)
- Evaluator: alpha-semantics-evaluator-v2
- Policy digest: 
- Schema digest: 
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 0/40 (0.0%)
- Intervention decision: 0/40 (0.0%)
- Board transition: 0/40 (0.0%)
- Cue lifecycle: 0/40 (0.0%)
- Contribution mode: 0/40 (0.0%)
- Semantic content: 2/40 (5.0%)
- RECONSTRUCT: 0/4 (0.0%)
- REPRESENT: 0/22 (0.0%)
- AUGMENT precision: 0/0 (n/a)
- Must-augment recall: 0/0 (n/a)
- Malformed/rejected: 0/40
- Tokens (input/cache/output): 0/0/0
- Latency: 20134 ms
- Estimated cost: rates not configured
- Failed cases: SEM2-D1-01, SEM2-D2-01, SEM2-D1-02, SEM2-D2-02, SEM2-D1-03, SEM2-D2-03, SEM2-D1-04, SEM2-D2-04, SEM2-D1-05, SEM2-D2-05, SEM2-D1-06, SEM2-D2-06, SEM2-D1-07, SEM2-D2-07, SEM2-D1-08, SEM2-D2-08, SEM2-D1-09, SEM2-D2-09, SEM2-D1-10, SEM2-D2-10, SEM2-D1-11, SEM2-D2-11, SEM2-D1-12, SEM2-D2-12, SEM2-D1-13, SEM2-D2-13, SEM2-D1-14, SEM2-D2-14, SEM2-D1-15, SEM2-D2-15, SEM2-D1-16, SEM2-D2-16, SEM2-D1-17, SEM2-D2-17, SEM2-D1-18, SEM2-D2-18, SEM2-D1-19, SEM2-D2-19, SEM2-D1-20, SEM2-D2-20

## Critical safety gates

| Gate | Failures | Cases |
|---|---:|---|
| accepted_correct | 0 | — |
| accepted_initiate | 0 | — |
| answer_leakage | 0 | — |
| checkpoint_loss | 0 | — |
| corrected_error_visible | 4 | SEM2-D1-09, SEM2-D2-09, SEM2-D1-10, SEM2-D2-10 |
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
