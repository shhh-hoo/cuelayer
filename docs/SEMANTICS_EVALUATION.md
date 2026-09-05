# SEMANTICS evaluation record

**Current status:** `OFFLINE_SEMANTICS_PASS`
**Current promotion:** `AUGMENT_ENABLED` for exact frozen profile `alpha-augment-p4-v7`
**Live gate:** not `LIVE_SEMANTICS_PASS`  
**Current frozen baseline commit:** `fdd22f05bea764b900e5d3af31813361054e755e`
**Current evaluation date:** September 5, 2026

The v5 decision is authoritative for the current branch. The v1 and v2 records below remain unchanged historical evidence of earlier failed gates; the final v5 record appears at the end of this document.

## Frozen authority and configuration

- Work package: `SEMANTICS`
- Context baseline: fixed P4 (`E + J + S + W`); no P0–P4 ablation was introduced.
- Provider/model: OpenAI / `gpt-5.6-luna`.
- Active live profile: `alpha-core-p4-v1` (`RECONSTRUCT` + `REPRESENT`; autonomous correction/initiation disabled).
- Candidate profile: `alpha-augment-p4-v1` (adds Board-only `AUGMENT`; Cue remains `RECONSTRUCT` + `REPRESENT`).
- Policy version: `bounded-agent-p4-semantics-v1`.
- Active-core policy digest: `6432f70f184032b86cb9a63f0b3c270dcfdd19686db2b81882abea72acee5760`.
- Active-core schema digest: `0f28469be469b9bdbcd60094e6215725c1f22cfecbe8a01f2364dcd6a9d622ed`.
- Candidate policy digest: `ac60860280b40d3c4d2bfc6a9c365610f6513967acb7b9d60eeb8006ac781eb1`.
- Candidate schema digest: `018a8a9d613ddb5eaf03b14b0d04333d6892e7575cf862674c4eea5e7df88af7`.
- Corpus: `alpha-semantics-corpus-v5`, 60 cases (40 development / 20 locked holdout).
- Corpus SHA-256: `beeab817fdf90bda679a2ca74bb1b888d10f437638850a37e1c4ab23915e594d`.
- Holdout began only after the frozen baseline was committed. No policy, profile, schema, evaluator, corpus, or gold changed during or after locked evaluation.

The provider was called once per designated batch. There was no JSON repair, semantic retry, fallback model, second evaluator model, or model-based judging. Estimated cost is unavailable because token rates were not configured; raw input, cached-input, and output token counts are retained for every pass.

## Development tuning

| Pass | Corpus | Parse | Accepted | Decision | Board | Cue | Mode | RECONSTRUCT | REPRESENT | AUGMENT precision | Must-augment recall | Critical failures |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Candidate 1 | v1 | 40/40 | 40/40 | 32/40 | 33/40 | 38/40 | 31/40 | 2/6 | 8/10 | 0/0 | 0/0 | invented learner action: 1 |
| Candidate 2 | v2 | 40/40 | 40/40 | 35/40 | 37/40 | 38/40 | 39/40 | 5/6 | 9/10 | 1/1 | 1/1 | invented learner action: 2 |
| Candidate 3 | v3 | 40/40 | 39/40 | 38/40 | 38/40 | 39/40 | 39/40 | 4/6 | 10/10 | 1/1 | 1/1 | current trigger: 1; checkpoint loss: 1 |
| Candidate 4 | v4 development split | 40/40 | 40/40 | 38/40 | 38/40 | 40/40 | 40/40 | 6/6 | 10/10 | 1/1 | 1/1 | zero |

Development pass 4 met the core targets and the development AUGMENT target. Its two remaining non-critical action disagreements were `SEM-D034` and `SEM-D038`, both Board `SET_ACTIVE` versus frozen `ADD_SUPPORT`/`KEEP` expectations. The development cases and policy were unchanged when the final holdout-only case was strengthened and the corpus advanced from v4 to v5.

### Causal fixes

| Cases | Observed failure | Root cause | Change and compatibility impact |
|---|---|---|---|
| D008, D009 | Correct Unicode Chemistry was scored as missing | Normalization handled subscripts incompletely and missed superscript digits/subscript letters | Deterministic normalization now treats harmless glyph variants equivalently while retaining identity and charge. No event change. |
| D010, D011 | Damaged terms were kept or malformed | Policy under-specified phonetic reconstruction and state-reference requirements; the state-context fixture was too vague | Added bounded examples and explicit `stateRefs` rule; clarified the development fixture. Persisted vocabulary unchanged. |
| D013 | No development case could exercise eligible AUGMENT | The original boundary gold contradicted its own learner-visible proposition and left AUGMENT recall at 0/0 | Added a development-only explicit formula-gap positive control and versioned the corpus. No holdout output had been generated. |
| D022 | “may” was dropped | Policy did not make preservation of epistemic force operational enough | Made qualifier preservation explicit. No persisted-shape impact. |
| D023, D032, D035, D036, D038 | Teacher actions were missed, mis-typed, or labeled RECONSTRUCT | Cue policy and gold did not cleanly separate intact teacher actions from damaged speech; evaluator did not assert Cue kind | Clarified teacher-originated Cue semantics and added deterministic Cue-kind/final-state checks. |
| D024, D027, D034 | Expected Support was promoted to Active | Several initial states did not actually establish the parent object; policy allowed concise reformulations to appear central | Repaired development setup and clarified same-thread Support. No runtime compatibility impact. |
| D015 | A sequence representation also became a TASK | Imperative corpus wording was ambiguous classroom activity evidence | Changed only the development utterance to declarative sequence wording. |
| D020, D024 | Semantically correct abbreviations/synonyms failed exact fragments | Allowed canonical variants existed in gold but the evaluator ignored them | Evaluator now checks explicit alternative groups, symbols, conditions, and answer-material constraints deterministically. |
| D036 | Teacher HINT was duplicated onto Board | Policy did not state the channel exclusivity rule | Added Cue-only learner-action guidance unless speech independently establishes a Board proposition. |

Every corpus/gold correction occurred before holdout, in a separate visible commit with a new corpus version/hash. Earlier development outputs remain committed.

## Locked holdout results

| Profile/pass | Parse | Accepted | Malformed / rejected | Decision | Board | Cue | Mode | RECONSTRUCT | REPRESENT | AUGMENT precision | Must-augment recall | Tokens in/cache/out | Latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| AUGMENT 1 | 20/20 | 19/20 | 0 / 1 | 16/20 | 14/20 | 19/20 | 18/20 | 0/0 | 1/2 | 0/0 | 0/1 | 74,867 / 65,200 / 4,299 | 56,024 ms |
| AUGMENT 2 | 20/20 | 20/20 | 0 / 0 | 13/20 | 13/20 | 18/20 | 16/20 | 0/0 | 1/2 | 0/0 | 0/1 | 74,867 / 65,200 / 4,483 | 55,594 ms |
| CORE 1 | 20/20 | 19/20 | 0 / 1 | 15/20 | 14/20 | 18/20 | 18/20 | 0/0 | 1/2 | n/a | n/a | 74,467 / 61,579 / 4,464 | 55,976 ms |
| CORE 2 | 20/20 | 18/20 | 0 / 2 | 13/20 | 13/20 | 17/20 | 17/20 | 0/0 | 1/2 | n/a | n/a | 74,467 / 64,820 / 4,561 | 57,772 ms |

The holdout has no positive RECONSTRUCT denominator, so it cannot establish the required ≥95% locked RECONSTRUCT gate. This was discovered after lock and was not repaired against output.

### Critical safety failures by locked pass

All unlisted critical gates were 0/20 in all four passes, including accepted CORRECT, accepted INITIATE, Cue AUGMENT, domain-only Cue, fabricated quote, invented QUESTION/HINT/NOTE, answer leakage, unsupported REPRESENT/AUGMENT, corrected error remaining visible, premature resolution, history reactivation, duplicate consumption, replay mismatch, normal transcript mount, and silent schema incompatibility.

| Gate | AUGMENT 1 | AUGMENT 2 | CORE 1 | CORE 2 |
|---|---:|---:|---:|---:|
| `checkpoint_loss` | 1 | 0 | 1 | 2 |
| `current_trigger_missing` | 2 | 1 | 2 | 3 |
| `incorrect_chemistry` (frozen deterministic judge) | 2 | 1 | 1 | 1 |
| `invented_task` | 0 | 2 | 1 | 1 |

Failure JSONL and complete replay event files are stored beside each Markdown/JSON pass report in `resources/semantics/results/`.

### Locked-evaluation diagnosis (not tuned)

- `SEM-H051` never produced an accepted AUGMENT. One pass proposed the formula as REPRESENT with invalid `SPEECH_AND_STATE` provenance and an extra TASK; deterministic validation rejected it. Candidate recall therefore remained 0/1 on both passes.
- `SEM-H050` preserved the exothermic condition in learner-visible wording but failed the frozen lexical condition assertion. It remains a deterministic failure; the gold was not weakened.
- `SEM-H041` says “identify the error yourselves,” which is classroom evidence for a teacher-originated TASK, while its frozen gold expects no Cue. The resulting `invented_task` count is retained as judged and recorded as corpus debt.
- `SEM-H059` and `SEM-H060` expose a frozen sequence-final-state defect: their gold derives preservation from the final action even though an earlier step changed Active. `SEM-H060` also requires trigger references from a later KEEP checkpoint although the current-trigger rule applies to non-KEEP changes. Results remain unchanged.
- Action selection was unstable across locked passes, especially KEEP versus Board change and teacher TASK detection.

These defects do not justify a PASS. They require a new, independently versioned corpus/evaluator iteration and a fresh untouched holdout, not edits to these locked results.

## Decision

`AUGMENT_DISABLED`: both candidate passes failed must-augment recall (0/1), critical gates, core metrics, and stability. `ACTIVE_ALPHA_SEMANTIC_PROFILE` remains `ALPHA_CORE_P4`; no verifier was added.

`REVISE`: both core passes are below the ≥95% decision, Board, Cue, REPRESENT, and mode targets, lack a positive locked RECONSTRUCT denominator, and contain critical failures. `CORE_ALPHA_PASS` is not claimed.

## Automated and browser verification

- `npm ci`: completed.
- `npm run typecheck`: passed.
- `npm test`: 141/141 passed across 32 files.
- `npm run build`: passed (Vite production build).
- `npm run eval:semantics:validate`: passed; 60 cases, 40/20 split, frozen hash matched.
- `git diff --check`: passed.
- Chrome `/session` smoke: rendered the learner presentation stage and controls with no visible error overlay and no normal transcript.
- Firefox `/session` smoke: rendered the same learner presentation stage and controls with no normal transcript.
- Trace volume: no new trace event type or audio-path write was introduced. Existing request/contract snapshots gained only stable profile/version metadata; no material amplification was observed in the static change. A live trace-volume measurement was not available.

## Missing live gates

A real semantic microphone dogfood was not executed, so `LIVE_SEMANTICS_PASS` is not claimed. The following remain unverified with authorized microphone audio through Speechmatics and the production provider:

1. the full 17-part spoken semantic script;
2. real Board `SET_ACTIVE` and `ADD_SUPPORT`/retained transitions reaching the rendered learner surface;
3. teacher-originated Cue creation, persistence through Board updates, and explicit resolution;
4. real-time absence of CORRECT, INITIATE, invented actions, leakage, checkpoint loss, and duplicate consumption;
5. selected profile/policy correlation through live audit trace;
6. reload equivalence after a real accepted live event without another model call;
7. Firefox live-microphone performance before/after the known baseline issue;
8. measured live trace volume.

Teacher approval/override UI, intervention-level controls, personality, avatar, voice, proactive timers, student-response triggers, and slide-understanding triggers remain future work. `teacher_override.applied` remains contract-only.

---

## V2 benchmark and evaluation — September 5, 2026

This section is a separate evaluation record. The v1 narrative above remains historical evidence, but v1 is invalid as a final release gate because its locked gold/evaluator defects are documented in the [v1 → v2 benchmark defect ledger](../resources/semantics/v2/BENCHMARK_DEFECT_LEDGER.md). No v1 corpus, manifest, hash, provider-result, or failure-replay artifact was rewritten.

### Frozen v2 authority

- Corpus: `alpha-semantics-corpus-v2`, 60 cases (40 development / 20 locked holdout).
- Final corpus SHA-256: `22d1456f1195dec9bf86023ab1d503ab0be025176bcf9d716ab940e028f52565`.
- Evaluator: `alpha-semantics-evaluator-v2`.
- Benchmark/runtime freeze commit: `3dad179`.
- Final policy/config freeze commit: `fcc284f`.
- Active profile: `alpha-core-p4-v4`, policy `bounded-agent-p4-semantics-v4`.
- Candidate profile: `alpha-augment-p4-v4`; it adds Board-only AUGMENT and remains inactive.
- Core policy digest: `ccc6f27785a8d8347c825dc7699407663c448b0ffaf736f0ac38b43d932ccb05`.
- Core schema digest: `0f28469be469b9bdbcd60094e6215725c1f22cfecbe8a01f2364dcd6a9d622ed`.
- Candidate policy digest: `1aa261b295c0f7035d2c58bec88559217b57ce02c25e04baa8b634207f16213c`.
- Candidate schema digest: `018a8a9d613ddb5eaf03b14b0d04333d6892e7575cf862674c4eea5e7df88af7`.
- Provider/model: OpenAI / `gpt-5.6-luna`, low reasoning, no temperature parameter.
- No retry, repair model, fallback model, or second LLM verifier was used.

V2 uses profile-specific gold, exact final Active/Support/retained/Cue expectations, and structured semantic predicates for entities, polarity, conditions, causal/transformation direction, uncertainty, quantities, propositions, and answer leakage. A checkpoint is lost only when it is neither consumed nor pending. Current-trigger judging examines accepted non-KEEP steps only. Deterministic integration tests own replay, duplicate-consumption, schema-compatibility, later-speech, and checkpoint-preservation invariants.

The final holdout has multiple positive RECONSTRUCT, REPRESENT, QUESTION, TASK, HINT, NOTE, ADD_SUPPORT, SET_ACTIVE, topic-shift, correction, Cue-persistence, and Cue-resolution cases. Candidate AUGMENT has five materially distinct positive holdout cases and three negative traps. Every holdout scenario is paired with two development cases using different wording.

### V2 development record

Provider-backed development results before each benchmark/policy correction are retained under `resources/semantics/v2/results/`. The durable ledger records all development-derived corpus/evaluator corrections. No holdout result informed any correction.

The final frozen-policy development passes were:

| Profile/pass | Parse | Accepted | Decision | Board | Cue | Mode | Semantic | RECONSTRUCT | REPRESENT | AUGMENT precision | Must-augment recall | Critical failures | Tokens in/cache/out | Latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| CORE 6 | 40/40 | 35/40 | 33/40 | 32/40 | 33/40 | 34/40 | 35/40 | 2/4 | 20/22 | n/a | n/a | fabricated quote: 2 | 201,428 / 170,751 / 19,528 | 250,115 ms |
| AUGMENT 6 | 40/40 | 38/40 | 35/40 | 34/40 | 35/40 | 34/40 | 37/40 | 2/4 | 20/22 | 9/9 | 9/10 | zero | 197,579 / 167,992 / 18,666 | 248,573 ms |

Low reasoning materially improved exactness and candidate AUGMENT behavior, at the cost of higher latency/output tokens. Core development still remained below the 95% release gates, so the locked holdout was expected to be diagnostic rather than promotable.

### V2 locked holdout results

The final corpus/evaluator and policy/config were unchanged across all four locked runs. Each pass is reported separately.

| Profile/pass | Parse | Accepted | Decision | Board | Cue | Mode | Semantic | RECONSTRUCT | REPRESENT | AUGMENT precision | Must-augment recall | Critical failures | Tokens in/cache/out | Latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| CORE 1 | 20/20 | 18/20 | 15/20 | 17/20 | 15/20 | 16/20 | 18/20 | 0/2 | 10/11 | n/a | n/a | fabricated quote: 1; invented task: 2 | 100,157 / 87,192 / 9,882 | 123,674 ms |
| CORE 2 | 20/20 | 18/20 | 16/20 | 16/20 | 16/20 | 17/20 | 18/20 | 1/2 | 10/11 | n/a | n/a | corrected error visible: 1; invented task: 1 | 100,155 / 87,192 / 9,182 | 121,237 ms |
| AUGMENT 1 | 20/20 | 20/20 | 18/20 | 17/20 | 18/20 | 19/20 | 20/20 | 1/2 | 11/11 | 5/5 | 5/5 | invented task: 1 | 100,635 / 87,648 / 8,888 | 96,276 ms |
| AUGMENT 2 | 20/20 | 19/20 | 16/20 | 17/20 | 16/20 | 17/20 | 19/20 | 0/2 | 11/11 | 5/5 | 5/5 | invented task: 2 | 96,831 / 83,996 / 8,823 | 127,601 ms |

All four passes had zero accepted autonomous CORRECT/INITIATE, checkpoint loss, duplicate consumption, replay mismatch, Cue AUGMENT, domain-only Cue, answer leakage, premature Cue resolution, history reactivation, unsupported REPRESENT, and normal-transcript/schema failures. Candidate passes also had zero unsupported or irrelevant accepted AUGMENT.

Remaining real failures are concentrated in:

- RECONSTRUCT mode selection (`SEM2-H-01`, `SEM2-H-02`), including formula speech treated as a learner task and fragmented speech represented rather than reconstructed;
- QUESTION answer placement/lifecycle (`SEM2-H-06`);
- topic/Cue action selection (`SEM2-H-11`, `SEM2-H-12`);
- symbol mode/provenance (`SEM2-H-16`, `SEM2-H-17`);
- negative-trap Cue handling (`SEM2-H-19`, `SEM2-H-20`);
- retained correction on core pass 2 (`SEM2-H-10`).

Complete JSON, failure JSONL, Markdown, and replay artifacts are stored under `resources/semantics/v2/results/`.

### V2 decision and live gates

`CORE_ALPHA_PASS = false`. Although structured parse was 100% and deterministic integrity gates were clean, both core holdout passes missed the ≥95% intervention, Board, Cue, contribution-mode, RECONSTRUCT, and REPRESENT requirements and contained genuine critical safety failures.

`AUGMENT_ENABLED = false`. Candidate AUGMENT precision and must-augment recall were 100% in both locked passes with five positive cases, but the candidate regressed/fell below the required core gates and produced invented learner tasks. `ACTIVE_ALPHA_SEMANTIC_PROFILE` therefore remains `ALPHA_CORE_P4`; the candidate is not promoted.

Status remains `REVISE` and `AUGMENT_DISABLED`. Because the valid offline v2 evaluation did not pass, real microphone/Speechmatics dogfood and Chrome/Firefox live regression were intentionally not run as compensating evidence. `LIVE_SEMANTICS_PASS` is not claimed. The live gates listed in the v1 record remain outstanding.

---

## V5 corrected contract and locked evaluation — September 5, 2026

V3–v5 replace the defective source-transformation and quote-copying assumptions without rewriting any prior corpus or result. Teacher-originated imperative cognitive actions are Cue `TASK`s, including “write NH4+”, “read the heading”, and “predict”. `RECONSTRUCT` versus `REPRESENT` is diagnostic when the final learner-visible semantics, provenance, profile permissions, and state transition are correct. The provider returns checkpoint IDs; deterministic code resolves accepted references to complete immutable canonical checkpoint text and rejects nonexistent IDs. A valid `SET_ACTIVE` may retain its primary Active contribution while dropping only an invalid optional Support with `board_support_dropped`.

### Frozen v5 authority

- Corpus: `alpha-semantics-corpus-v5`, 60 cases (40 development / 20 locked holdout).
- Corpus SHA-256: `107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c`.
- Evaluator: `alpha-semantics-evaluator-v5`.
- Benchmark/runtime/policy freeze commit: `fdd22f05bea764b900e5d3af31813361054e755e`.
- Core: `alpha-core-p4-v7`; policy digest `7875409eb044a9e8e657434841e0c1b96cab5f13ee94ed383be4624c08826ce4`.
- Candidate: `alpha-augment-p4-v7`; policy digest `aa6335f586197f38a21fbd75bcf3048dc881cbe3835f33b1d1e29b2d9a08514d`.
- Provider/model: OpenAI / `gpt-5.6-luna`, low reasoning, no temperature, repair, retry, fallback, or model judge.
- Structured-output checkpoint IDs are request-scoped enums, so each holdout request intentionally has its own recorded schema digest.
- No corpus, gold, evaluator, policy, profile, or schema changed after the freeze and before the four locked runs.

### Development audit

The final core development run passed the core Alpha gate: 40/40 parse and acceptance, 39/40 intervention and Board, 38/40 Cue, and 40/40 final semantics, with every hard-zero gate clean. The candidate development run was retained as a genuine non-passing audit: 40/40 parse, 39/40 accepted, 38/40 intervention, 35/40 Board, 37/40 Cue, 39/40 semantics, and 10/10 AUGMENT precision/recall. It did not trigger post-freeze tuning; promotion depended on the two locked candidate runs and their explicit core non-regression gates.

### Locked v5 results

| Profile/pass | Parse | Accepted | Decision | Board | Cue | Semantic | Mode diagnostic | AUGMENT precision | Must-augment recall | Hard zeros | Failed cases |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| CORE 1 | 20/20 | 20/20 | 20/20 | 20/20 | 20/20 | 20/20 | 18/20 | n/a | n/a | PASS | none |
| CORE 2 | 20/20 | 19/20 | 19/20 | 19/20 | 19/20 | 19/20 | 18/20 | n/a | n/a | PASS | `SEM5-H-06` |
| AUGMENT 1 | 20/20 | 20/20 | 20/20 | 19/20 | 20/20 | 20/20 | 18/20 | 5/5 | 5/5 | PASS | `SEM5-H-16` Board transition only |
| AUGMENT 2 | 20/20 | 20/20 | 20/20 | 20/20 | 20/20 | 20/20 | 19/20 | 5/5 | 5/5 | PASS | none |

All four runs had zero accepted autonomous CORRECT/INITIATE, invalid provenance, invented Cue, Cue AUGMENT, incorrect subject matter, answer leakage, unsupported AUGMENT, corrected error visibility, premature Cue resolution, checkpoint loss, duplicate consumption, replay mismatch, event-schema incompatibility, and normal transcript mount. Complete JSON, Markdown, failure JSONL, and replay artifacts are stored under `resources/semantics/v5/results/`.

### V5 decision and remaining live gate

`CORE_ALPHA_PASS = true` on both locked core runs. Both locked candidate runs also passed every core gate, achieved 100% AUGMENT precision and 100% must-augment recall across five positives, and had zero safety violations. `AUGMENT_ENABLED = true`; `ACTIVE_ALPHA_SEMANTIC_PROFILE` therefore points to the exact frozen `ALPHA_AUGMENT_CANDIDATE_P4` (`alpha-augment-p4-v7`).

This is an offline semantics pass, not a live-product pass. The real `/session` page loaded and rendered correctly in Chrome and Firefox on September 5, and the server successfully obtained a Speechmatics realtime token without exposing it. An authorized Chrome microphone run connected to Speechmatics and entered the recording state, but unavoidable environmental noise prevented a usable spoken semantic script; the capture was stopped and is not counted as semantic evidence. Firefox microphone execution was not attempted under the same unsuitable audio conditions. `LIVE_SEMANTICS_PASS` remains unclaimed until usable microphone audio traverses Speechmatics and the production provider in both browsers, including accepted state, Cue persistence/resolution, replay after reload, safety checks, and trace-volume evidence.


---

## Live acceptance — September 5, 2026, 12:23–12:37 UTC

`LIVE_SEMANTICS_PASS = false`. The real fixed Chrome speaker-to-microphone script ran, followed by the shorter Firefox run and a pre-PR15 Firefox baseline comparison. Frozen offline authority and exact `alpha-augment-p4-v7` promotion remain unchanged.

Chrome accepted 14 requests, rejected two HINT replacements over an unresolved TASK, then hit 16 consecutive six-second timeouts; 36 of 51 committed checkpoints remained pending. It rendered NH₄⁺, catalyst Active/Support, and a teacher TASK, but did not complete the required Cue lifecycle, answer, AUGMENT, or correction sequence. All accepted contributions had valid canonical provenance, matching evaluated policy/request-scoped schemas, and correlated request-to-render traces. Normal-route reload reconstructed the same state without provider re-invocation; the full reload gate still lacks a completed live Cue lifecycle.

Firefox accepted one Board update but no Cue; ASR severely distorted the fixed script. The same physical setup also distorted speech on the pre-PR15 baseline. Both Firefox runs had continuous acknowledgements, no sequence gaps, and no observed UI freeze; no PR15 performance regression was demonstrated, but Firefox acceptance remains incomplete.

Measured capture trace volume: Chrome 3,728,244 bytes / 323.100 seconds = 0.692 MB/min; Firefox 1,665,572 / 148.968 = 0.671 MB/min; baseline Firefox 1,393,172 / 174.389 = 0.479 MB/min. Snapshot counts were bounded per attempt; Chrome timeout retries amplified request volume. No checkpoint loss or duplicate consumption was found.

See the [complete setup, 18-step outcomes, hashes, correlation checks, baseline comparison, and remaining limitations](../resources/semantics/live-acceptance-2026-09-05/README.md). Raw traces are preserved locally, with hashes in the report package. No semantic configuration or runtime changes were made. A longer-timeout diagnostic resend of one captured request to OpenAI awaits specific approval after automatic approval review blocked renewed disclosure. Typecheck, 158 tests, build, v5 validation, and diff checks passed. Keep PR15 open, Draft, and unmerged.
