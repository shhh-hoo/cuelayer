# SEMANTICS v5 development alpha-core-p4-v7 pass 1

- Model: gpt-5.6-luna
- Corpus: alpha-semantics-corpus-v5 (107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c)
- Evaluator: alpha-semantics-evaluator-v5
- Policy digest: 7875409eb044a9e8e657434841e0c1b96cab5f13ee94ed383be4624c08826ce4
- Schema digests: e58007c0cfba1f20ce88c0061ed49b18f630a4645ecd05a12dd5ab34c2a7e24e, 09fbdbb3138a7e76ab171bb1b8264fa28ec7059bd423e05343fae1f347dda358, 8dc3c95990def48231766ae89317ba323bb129427835508f429530b84772a989, ec40c08e7952c072999e5d691d3c9b93ee3305c5015174019cb248cc64996ab1, 074fd676cab12853cdf6bd86af859c2a728dccfc061c6c60c4ed28207a6deace, 1a6e99f5c288be9d2dc42d8c265c34092a2b6bd21dba63b198421c980967ef29, 3a138206e8976114df1154f5f5855c934374084920ae14a051209d631b021c11, aa220992db4cf408df98b66fdeeca7158a31f01785cb2962ce9b2e7b4ba56a4f, 2f5fdec47d7c0d7d7ed873450c975cb2e64fcd1025cb681bf3d1c20c9b25568b, de0491f01b382e4b200f76c43fdc94baba5b30666cee22013793373bc89cb0d2, 4095d9afac61fd007a379af84cb2a7b03fb323b899d3442649ac80767cec316f, d89434157245a921b8de49549da1367b797e0bc59ecf49084d32cd1fde17ad25, 8ca2039bb93155445e48b1d6a3d95be2daeb2d39187c53bb0b8bc0ad994f3b64, 20c2494c7a53522d71c959e69086e9053a83c8162f06f127fd80713b276e9878, 40e17905a005e7584fe611ea47d48fcce65501d94bd267ac1359191cc46d57a1, 56095db34942b48aa2e2d66fc9d0f97551851a91eac7180a1cf1ac45faad8356, 69dee8fb108cb0256b279083925f5f82becf074343913495f2c4be4b34951bbb, 1b032fe5596bf3fa38604421cc6042e5d8d78e05534b4fc5048b9cbf367cc317, c44f2a68405abf88cc60973420727531d36d4a214454eab31b9319ed989e9a4a, 94638124e74dd2ab5467cf9be02e5e195198587cfcbc6dc34e41bff2a15dbc82, 5e45532333d9a6aa7b6916202ebdd2373d86d8ce9c81c25d25edfa0b56322abd, c52b62c4ebbf65ce56aca1822f022227fab307716b8f55a164925249cd8c1efe, ab68f7d8d87e8a00063e090d91bd45e82cafacd73749540bf073b31986c73389, bf95efcb9e2ee72a1ca99fdf1883d739b16332ef25db426a268dad71e5f90cc7, c348b2769223c9a3bf14e49701af00d619c4a7e79d955826b2a44af891176c65, 2caf746b30c1f013a2e6f960fe6a8b2d566db88da8f2f5780651a03c0318e7dc, 4782cb27a8e2460f9744f89605eae34a9941adec2f2ec4240b30cadbdaa79807, 0147607d744210070684e082a00614a08dd520e52bffe21cdd8d963a3b06a67f, 18df2ae93c15255d9b746dbba4efb1d7507a6701df17a775685b3ad6c6172aad, 9a790dcffbfe71b2843224d93e9aad8a708133259e8fe2a84912249ce25d7821, d1f15cbf6ad19b2808fa0618079c7338002014c449518360c58e0cb4742992ec, 3b642951e77d324c5606b139ab0ac06a0c0f9d214f84e8780d40cf8f08d4c9ec, 20b81da543cb4c93a094d6d1992c7f15537d1fc9cbeef1d0bf21e1539116e4ef, 3c1753721b14f11fefad49ab089d1c0f9946fbf5f774a0860b3063cfe74a1fc0, 6a03d57edb0fa537b8330407a65558792d99cf1b93e86eeeb12b74bc17ffb8af, e2fcec8f9b7e85f2c22af330be79dde813f5891864f64139938c969f2a0ac733, 5f3b7a262883208d5eb4912a020865d39fcadbc392b09b3a8f73285a01e49084, b592030c35f7e9740ad7d624739a6512b3f662fcd6d05ba2bb9cbb48787f0f2c, 2d311d03425d46a39a6c740b157c29234d3e1d18d0df0e299982baa7a64c059b, 1a19d0a68f49d980e72deb130cd846183d685540a5dccd5fb4cb5f84d301f161
- Structured parse: 40/40 (100.0%)
- Accepted/conflict-handled: 40/40 (100.0%)
- Intervention decision: 39/40 (97.5%)
- Board transition: 39/40 (97.5%)
- Cue lifecycle: 38/40 (95.0%)
- Final semantic correctness: 40/40 (100.0%)
- Derivation mode (diagnostic only): 37/40 (92.5%)
- RECONSTRUCT (diagnostic): 2/4 (50.0%)
- REPRESENT (diagnostic): 35/36 (97.2%)
- AUGMENT precision: 0/0 (n/a)
- Must-augment recall: 0/0 (n/a)
- Hard-zero gates: PASS
- CORE_ALPHA_PASS: true
- AUGMENT promotion pass: false
- Malformed/rejected: 0/0
- Tokens (input/cache/output): 219565/0/18671
- Latency: 238089 ms
- Failed cases: SEM5-D2-03, SEM5-D1-12, SEM5-D2-18

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
