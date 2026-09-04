# SEMANTICS v2 development alpha-core-p4-v4 pass 6

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v2 (22d1456f1195dec9bf86023ab1d503ab0be025176bcf9d716ab940e028f52565)
- Evaluator: alpha-semantics-evaluator-v2
- Policy digest: ccc6f27785a8d8347c825dc7699407663c448b0ffaf736f0ac38b43d932ccb05
- Schema digest: 0f28469be469b9bdbcd60094e6215725c1f22cfecbe8a01f2364dcd6a9d622ed
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 35/40 (87.5%)
- Intervention decision: 33/40 (82.5%)
- Board transition: 32/40 (80.0%)
- Cue lifecycle: 33/40 (82.5%)
- Contribution mode: 34/40 (85.0%)
- Semantic content: 35/40 (87.5%)
- RECONSTRUCT: 2/4 (50.0%)
- REPRESENT: 20/22 (90.9%)
- AUGMENT precision: 0/0 (n/a)
- Must-augment recall: 0/0 (n/a)
- Malformed/rejected: 0/5
- Tokens (input/cache/output): 201428/170751/19528
- Latency: 250115 ms
- Estimated cost: rates not configured
- Failed cases: SEM2-D1-02, SEM2-D2-02, SEM2-D1-06, SEM2-D1-07, SEM2-D2-07, SEM2-D2-08, SEM2-D1-13, SEM2-D2-13, SEM2-D2-17, SEM2-D2-18

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
| fabricated_speech_quote | 2 | SEM2-D1-06, SEM2-D2-07 |
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
