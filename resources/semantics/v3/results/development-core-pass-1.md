# SEMANTICS v3 development alpha-core-p4-v5 pass 1

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v3 (7c544afb77acf6574c439ce98e667de7208de7c0941746f4d7373cb05a19440d)
- Evaluator: alpha-semantics-evaluator-v3
- Policy digest: 1b9033178a34a3b2d1dca20d7171814d3ca65918148ee6a2a887c0da8616e427
- Schema digest: 09a31118748507e9b8f5c207f0ff4056fd155a738c6ce0848a09c1f9b6a71de4
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 36/40 (90.0%)
- Intervention decision: 34/40 (85.0%)
- Board transition: 34/40 (85.0%)
- Cue lifecycle: 33/40 (82.5%)
- Final semantic correctness: 36/40 (90.0%)
- Derivation mode (diagnostic only): 32/40 (80.0%)
- RECONSTRUCT (diagnostic): 1/4 (25.0%)
- REPRESENT (diagnostic): 31/36 (86.1%)
- AUGMENT precision: 0/0 (n/a)
- Must-augment recall: 0/0 (n/a)
- Hard-zero gates: PASS
- CORE_ALPHA_PASS: false
- AUGMENT promotion pass: false
- Malformed/rejected: 0/4
- Tokens (input/cache/output): 190534/161955/18018
- Latency: 221269 ms
- Estimated cost: rates not configured
- Failed cases: SEM3-D2-01, SEM3-D1-05, SEM3-D1-06, SEM3-D1-07, SEM3-D2-08, SEM3-D2-11, SEM3-D1-12, SEM3-D2-18

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
