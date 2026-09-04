# SEMANTICS evaluation record

**Status:** `REVISE`  
**Promotion:** `AUGMENT_DISABLED`  
**Live gate:** not `LIVE_SEMANTICS_PASS`  
**Frozen baseline commit:** `e149f15e2583084b89c2cfc4588de2175896fe9a`  
**Evaluation date:** September 4, 2026

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
