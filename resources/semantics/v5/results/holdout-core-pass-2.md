# SEMANTICS v5 holdout alpha-core-p4-v7 pass 2

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v5 (107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c)
- Evaluator: alpha-semantics-evaluator-v5
- Policy digest: 7875409eb044a9e8e657434841e0c1b96cab5f13ee94ed383be4624c08826ce4
- Schema digests: 0b59f42f43dba763263d54c5b0409b029d5085fada96b3ae07c3217a8ec84773, 102c49f986ee1ee79a159528ac38a7744b26dd6e243031396cc4fdb642fdde41, 4f8849d10b9feaa2ca30bf353b6666d6caee701a048896d3d718a02e2f3128d0, 7d176144dd81bacd37ff9ad9fe14dfd9820253fea6813d03ee130a10e90d5cb0, 07709e1470fcee2fca22884371fa9885bbe09a1e22ce72100cead57685562bbe, a3dc58fb57c35361f4ef26e3d5cf39da5a5497fcf811c4889aa17f15f657a2ce, a62550170a34398e91be8cfd76aadaa75d35e320a7c0af01c6c192b4b647a54c, 1508193d6a53c8b24d30eb0e1f513dc404c07903677667c1394d4fd2a0fa4378, 2a705e6bc56dfd91c7d404a5c048c239b433cde5416912c50a48f1e4c345387d, 044190871adfc3daf3b415510c9d52791a71e3310c79ccb37a0c7257df5ecda4, c76f80e357e8b48c947659e7aa7680aba004f791af833bc2eab89b01f034815c, 7006a6e369cda30ded623f7d58596c73fe941636f3aff7781bfb5ee0cf22c196, 7f6699858fa7118d038a76a4ad33428af50b5ddd58ed25ac86804e7accffb8e9, abfdcc78f6d1a957b1690d9ea082983d0275b09eeb1c96e509565936974a5827, 5ab5a6c2119489fdc507fb2dec1ef16ee650c33017e3787abc3ced9625e0343c, 0e8e430b99ffeffe981e665cf730fa0d30996d6c616efabb4bb5ad5945c40118, ce3f807a7d34fedc132b131f1bd83ff16eeb3334bebf6b7ec5c459f4142a2a67, 294c8183521f5febea05a66f2b31da64122e8bd7f2413c056dee999fef4e2af1, 59f60b1d84c668f8f2155972a3e7f008b2130af7eb4b4382597f667b0598ea9b, 95c1b81cf79f9dc3ef2e96008f453589ce9d46d36ea0c5118497a71ea5ccc0fa
- Structured parse: 20/20 (100.0%)
- Accepted/conflict-handled: 19/20 (95.0%)
- Intervention decision: 19/20 (95.0%)
- Board transition: 19/20 (95.0%)
- Cue lifecycle: 19/20 (95.0%)
- Final semantic correctness: 19/20 (95.0%)
- Derivation mode (diagnostic only): 18/20 (90.0%)
- RECONSTRUCT (diagnostic): 1/2 (50.0%)
- REPRESENT (diagnostic): 17/18 (94.4%)
- AUGMENT precision: 0/0 (n/a)
- Must-augment recall: 0/0 (n/a)
- Hard-zero gates: PASS
- CORE_ALPHA_PASS: true
- AUGMENT promotion pass: false
- Malformed/rejected: 0/1
- Tokens (input/cache/output): 109039/95784/10015
- Latency: 142918 ms
- Failed cases: SEM5-H-06

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
