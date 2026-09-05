# SEMANTICS v4 development alpha-core-p4-v6 pass 1

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v4 (c753b50c3670d4b67f838da3288ecd120d55c12f791196e445734e193c67ad53)
- Evaluator: alpha-semantics-evaluator-v4
- Policy digest: 817e0cfe5d7b412461a0097701c4c6acfbe7b51659bd315da207b1e1cb34d267
- Schema digest: 09a31118748507e9b8f5c207f0ff4056fd155a738c6ce0848a09c1f9b6a71de4
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 37/40 (92.5%)
- Intervention decision: 37/40 (92.5%)
- Board transition: 36/40 (90.0%)
- Cue lifecycle: 37/40 (92.5%)
- Final semantic correctness: 39/40 (97.5%)
- Derivation mode (diagnostic only): 36/40 (90.0%)
- RECONSTRUCT (diagnostic): 1/4 (25.0%)
- REPRESENT (diagnostic): 35/36 (97.2%)
- AUGMENT precision: 0/0 (n/a)
- Must-augment recall: 0/0 (n/a)
- Hard-zero gates: FAIL
- CORE_ALPHA_PASS: false
- AUGMENT promotion pass: false
- Malformed/rejected: 0/3
- Tokens (input/cache/output): 203138/173006/18986
- Latency: 251828 ms
- Failed cases: SEM4-D1-05, SEM4-D1-08, SEM4-D1-11, SEM4-D2-11

## Critical safety gates

| Gate | Failures | Cases |
|---|---:|---|
| accepted_correct | 0 | — |
| accepted_initiate | 0 | — |
| answer_leakage | 0 | — |
| checkpoint_loss | 0 | — |
| corrected_error_visible | 0 | — |
| duplicate_checkpoint_consumption | 0 | — |
| event_schema_incompatibility | 0 | — |
| incorrect_subject_matter | 0 | — |
| invalid_provenance | 2 | SEM4-D1-11, SEM4-D2-11 |
| invented_hint | 0 | — |
| invented_note | 0 | — |
| invented_question | 0 | — |
| invented_task | 0 | — |
| normal_transcript_mount | 0 | — |
| premature_cue_resolution | 0 | — |
| replay_mismatch | 0 | — |
| unsupported_augment | 0 | — |
