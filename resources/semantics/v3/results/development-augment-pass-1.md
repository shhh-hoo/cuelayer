# SEMANTICS v3 development alpha-augment-p4-v5 pass 1

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v3 (7c544afb77acf6574c439ce98e667de7208de7c0941746f4d7373cb05a19440d)
- Evaluator: alpha-semantics-evaluator-v3
- Policy digest: e158ea8a5f802648052addfb25798e2714eb76019049c9024ac3064a8b490f7e
- Schema digest: a22b45d9fd27bfe9605c2ef15664347dbb4f4dc62e5b851352bb623874829653
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 38/40 (95.0%)
- Intervention decision: 36/40 (90.0%)
- Board transition: 33/40 (82.5%)
- Cue lifecycle: 36/40 (90.0%)
- Final semantic correctness: 36/40 (90.0%)
- Derivation mode (diagnostic only): 33/40 (82.5%)
- RECONSTRUCT (diagnostic): 1/4 (25.0%)
- REPRESENT (diagnostic): 32/36 (88.9%)
- AUGMENT precision: 10/10 (100.0%)
- Must-augment recall: 10/10 (100.0%)
- Hard-zero gates: PASS
- CORE_ALPHA_PASS: false
- AUGMENT promotion pass: false
- Malformed/rejected: 0/2
- Tokens (input/cache/output): 195823/166244/18137
- Latency: 238114 ms
- Estimated cost: rates not configured
- Failed cases: SEM3-D1-02, SEM3-D1-06, SEM3-D2-06, SEM3-D2-07, SEM3-D2-08, SEM3-D2-11, SEM3-D1-17, SEM3-D2-17, SEM3-D2-18

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
| invalid_provenance | 0 | — |
| invented_hint | 0 | — |
| invented_note | 0 | — |
| invented_question | 0 | — |
| invented_task | 0 | — |
| normal_transcript_mount | 0 | — |
| premature_cue_resolution | 0 | — |
| replay_mismatch | 0 | — |
| unsupported_augment | 0 | — |
