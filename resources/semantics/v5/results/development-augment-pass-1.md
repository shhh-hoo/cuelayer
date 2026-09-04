# SEMANTICS v5 development alpha-augment-p4-v7 pass 1

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v5 (107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c)
- Evaluator: alpha-semantics-evaluator-v5
- Policy digest: aa6335f586197f38a21fbd75bcf3048dc881cbe3835f33b1d1e29b2d9a08514d
- Schema digests: c40e6725f8983759e4478ff4813736a0e038eb1ad015b9153b5b0cf580cb0c5a, 730f69cc2987151710caee9d85b29698264bd9b4a855f95f1a632cea2f65d115, 69e3669d0075c79062630401d061dfeb6573827d2f9231fa95e6a43818edeee4, b95a54d60b3fa36847b67a2e907877a3634767696e8c67ba7e1a10a19a8db648, 65b606eee3fb5773c213ad31d767243e14355045b8ba7a526b32ca92137a7a49, 4b1cf4d9fcf9d5b699cc47d70a587c99eee8ef2ed05e9d910ae8b96b499674e3, 12ee5573642d56b4e36a7c22004099d50fa4754d407aab25e82bd265ec975134, f1e683a23a7e1cd6cd8b0ea12c83e387942c84cb1473482a81816f188ca22ab9, 75c2eff14540bb80e119326e0d0e946e3d518fa5bd896c3063aff9db45c5f3cb, ba7b44b3316fdebd5a418fd04db4be3a0216894ed3917839fa2187bf1bf52017, 0a34347465e7a3016ddc6b185941bf8d5b18b6291fcf3d56c4efebf6ed8ae06a, 68e66e1f0365fbcf7a89447b52c76b3122e5e2b6e5e890f182d691ad785e604e, 9e71eeafd15c218820b7e82708b4992e564f2ce81704f3801c0c6665fb7b3f8a, b667ac4bbecdf962c804db261bc1c5e8b5447ff93e7aa3d4a874094449a635af, c05eae084a63724d01d2692943c1fd9a62846ff8ea6437093931e951e02ccfb1, c0b61cb881845c92cdbef2ab9365789ee923131bb97fbcc2971ce1be9c98ef76, e121e795cabd8357ce2afc089b64fd1626a114e1db9adcb7106fe47832636666, e81579d3fdf71f00f034260f18a8f87011041155e450fd82f75acfee4f73baed, 0336ec134fa442a2e953de1af3ebef701ee25daf1de6586a37ab260c311cb8d6, a6bb09e7fbb9c2df5f1329223092f697b4417ac064dbb52ba54593b2a13ddca9, a9aae278179ece7ba64e0b9fb1989b6ad3873a9af52dbdcf2ab5c178ff983aa3, 4e9b04151f0a257f8b79cf50e152e9fe45e9bf93469ae17ba9f6e75a9ae4048f, 6daa5a1a7579a9f219c1b361a958c1ce714fd82a9d9764c2ab722ad0387c365e, 59b7bca3bfc38235c9dcc5c91a5d85b773d25a887372cbe9a51af55560d6f90e, e387c023d11e74fef690215f12e52f2a89c1010d516be3da19f087b34904a377, 9f40d9e18f0878317d6fe80a2b2ed250ce579082a8e566224818e97108fd8dcf, fcc6c01df8c316da1f0fec698faf9d4cdb09cff07445b5c6f07546385d0e0e3b, 9a56058ccf7c514c440301939f83efea18df07cfa1c957bc6e811127c4d8bc01, e4172d109d143736219b1a0bbd5b4ebf596fb46033daed80a5c7e2273c053bef, cf712423d3d4f144043f7be043d044a9b008cda4263b803a45148ae5d3fd59ce, 38c4ba2b564a1997d891c922af66113becfbf015759ccdc8620f22caa962026a, a742be82c3d1a1811fab588aa5c45ac2860faffeb8b79622be27f8a9d8c83743, c85062be81870c13697a30c75d9e9a6817a1634767ac59490b182c5b8592f999, eedd4cc730e80346519703bc22faf7e9474dba92355bef34df6bac8139453c87, f19af847a791ce5cb07a5d1d872eba0d6adbcba5eb97152366cc7803b9eba2b0, 4a71ed63eaa84c9a41ad11029d9a0b87a61c5b9a75d46bd6d6ac6241abbeecbc, 40d67aadd470fdca127af9a974071d0ad8b5e2a0f44293285a26db3b8b2dead5, 7d89f744e24fcbd6aec1301111d09acb5df9093f03c8184a4ccc0220657574f4, ab713f1c926f298b4bf7e8cd5deda1dda8202fc2002ba0c215e49771878fb2a1, a32d34717986ee4de16b52a4caabb4d691598291284ea973dd71290aa44fa20f
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 39/40 (97.5%)
- Intervention decision: 38/40 (95.0%)
- Board transition: 35/40 (87.5%)
- Cue lifecycle: 37/40 (92.5%)
- Final semantic correctness: 39/40 (97.5%)
- Derivation mode (diagnostic only): 34/40 (85.0%)
- RECONSTRUCT (diagnostic): 0/4 (0.0%)
- REPRESENT (diagnostic): 34/36 (94.4%)
- AUGMENT precision: 10/10 (100.0%)
- Must-augment recall: 10/10 (100.0%)
- Hard-zero gates: PASS
- CORE_ALPHA_PASS: false
- AUGMENT promotion pass: false
- Malformed/rejected: 0/1
- Tokens (input/cache/output): 220391/0/18662
- Latency: 231407 ms
- Failed cases: SEM5-D1-01, SEM5-D1-03, SEM5-D1-07, SEM5-D1-08, SEM5-D1-12, SEM5-D2-18

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
