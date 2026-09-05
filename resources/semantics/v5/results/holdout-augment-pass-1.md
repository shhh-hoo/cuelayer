# SEMANTICS v5 holdout alpha-augment-p4-v7 pass 1

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v5 (107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c)
- Evaluator: alpha-semantics-evaluator-v5
- Policy digest: aa6335f586197f38a21fbd75bcf3048dc881cbe3835f33b1d1e29b2d9a08514d
- Schema digests: fcb6c9426ce928a843cef5de9b557e60c13ebf7c0bb45a9da61e20b83c0f58f1, 8d6fe13f30b07b541846413569856a76a507925697e8e281cd389e00cc2bf681, 9aacd3acaa68b0df2caae946ee1757c541c8a699f676eba3f466cf9ab4ffe76b, 517a7d0d7bc26eb6419fe67f9d7c9a5f6fc25b0d264dce0abad3c19afbf9f0b8, 0a30021da1875a2cbf1f61aeff42af1cee51e975e29f21c0fe94fdc6493115ef, 0ebde0d7cb13f9496d9c779042c966cc1449feaed8ffe0503874e912bf1ba164, a5745f022e8af671ee6c5eff6e9aa8ab1605c2e3a688dde2b81cea5a621e5a93, 4d41fa3f9bcf6baae4a47388ce2d9b9ed6107977a1e531751109fb97fb281563, dba498c63ef04b87e5ca7d5ce205a2a80f8f3348c492728f8474b7254e6d260c, 66e314e0080afdcd4194215e7e6ab01e5fbf25d87b1ba4e7bd5740c79b5d9475, 35502e61aa25a4f915721b3dc4e259b0eb0dec811b9f3fdcaacb49ad300d4ecb, 9a220f51339986a470393a554d4f57b30ad20d20120cf87cc92016817d54bc57, db3c17087df4848ab69429332aad4a8803f6b38d5a1919a4d8d6b50d2214861c, c9e1bfc7dbdf5bbb07231654239b617375023eaa7f7bed153ff00b9aaa6bee09, 03a7b5cc6b499412050b95b8a767c19b016bd249feee9934267ebf2970ded977, e570c89ff22c0e70ddffbc3befae3022c65d3ebb67f1fd38ce07871b2608a581, 010b47187be16be068c58ef49b5e12e104ddb1a72372543c3de29420dac8dcaf, 7ca01b23747a040aa7d9f6d0ca3d7e6dc884636df9cdea792c5575bd27363f0e, b1794497e810b30c5844349eb11581de26887d3ec74869b56f4090e22d03218f, ee5093f589666b9ac7a168d98834e2e08aaa672af2224fccdf8db755476231f5
- Structured parse: 20/20 (100.0%)
- Accepted/conflict-handled: 20/20 (100.0%)
- Intervention decision: 20/20 (100.0%)
- Board transition: 19/20 (95.0%)
- Cue lifecycle: 20/20 (100.0%)
- Final semantic correctness: 20/20 (100.0%)
- Derivation mode (diagnostic only): 18/20 (90.0%)
- RECONSTRUCT (diagnostic): 0/2 (0.0%)
- REPRESENT (diagnostic): 18/18 (100.0%)
- AUGMENT precision: 5/5 (100.0%)
- Must-augment recall: 5/5 (100.0%)
- Hard-zero gates: PASS
- CORE_ALPHA_PASS: true
- AUGMENT promotion pass: true
- Malformed/rejected: 0/0
- Tokens (input/cache/output): 109435/0/8993
- Latency: 123512 ms
- Failed cases: SEM5-H-16

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
