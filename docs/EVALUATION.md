# CueLayer Evaluation Contract

This document owns reproducible evaluation definitions and current compatibility facts. It is not a product authority, execution diary, or archive of model runs.

## What belongs here

Track only artifacts required to reproduce or interpret the current evaluation surface:

- canonical evaluator and CLI identity;
- frozen reviewed corpus / manifest identity;
- supported semantic profiles used by that corpus;
- commands for offline validation and explicitly authorized live evaluation;
- known compatibility gaps that materially affect interpretation of results.

Generated model output, paid-run reports, real captions, session traces, latency exports, and experiment notebooks belong in ignored `.cuelayer/` or `artifacts/`, or in an explicitly managed external evidence archive.

## Current frozen semantic corpus

- Corpus: `resources/semantics/current/corpus.jsonl`
- Corpus identity: `alpha-semantics-corpus-v5`
- Cases: 60 total, 40 development / 20 holdout
- SHA-256: `107d2315cf4f64c42256955c05f24e6a7c15508a30def82039c69fcf9e43355c`
- Evaluator: `server/teaching/semantic-evaluation.ts`
- Evaluator identity: `alpha-semantics-evaluator-v5`
- CLI: `scripts/evaluate-semantics.ts`

The corpus, gold, manifest, and evaluator identity remain frozen unless a scoped evaluation change deliberately updates them.

## Compatibility warning

The frozen v5 benchmark evaluates legacy semantic profiles (`alpha-core-p4-v7`, `alpha-augment-p4-v7`, `bounded-agent-p4-semantics-v7`). The historical legacy runtime uses a later continuous/bounded profile and retains the Board-slot ontology for compatible restoration. New production sessions use the separate Core path.

Therefore:

- a passing v5 benchmark does not certify the live runtime;
- the existing corpus must not be silently reinterpreted as proof of the Core/Canvas model;
- the Core-domain migration requires a new reviewed evaluation contract rather than mutating frozen gold in place;
- historical benchmark identities may remain readable for comparison, but they do not define future product semantics.

## Commands

### Offline Core interpretation contract

The Core evaluator is separate from the frozen legacy evaluator above:

- Historical corpus: `resources/semantics/core/corpus.jsonl`; identity `core-interpretation-corpus-v1`. The adjacent manifest pins its hash and split counts.
- Evaluator: `server/teaching/core/semantic-evaluation.ts`; identity `core-interpretation-evaluator-v1`.
- CLI: `scripts/evaluate-core-semantics.ts`.
- Current provider schema: `core-interpretation-proposal-v4`; policy: `alpha-core-interpretation-v7`.
- Current context: `core-interpretation-context-v3`. Durable events remain `lesson-event-v5-core`.

Synthetic exemplars are authored independently for PR review. They are neither translated legacy gold nor outputs from a model run. Corpus validation checks strict case schemas, identity/hash, development/holdout presence, scenario coverage, reference selector resolution, actual Core normalization/acceptance, expected semantic predicates and deterministic replay. It does not establish that a model can produce those exemplars. Human review of corpus semantics remains part of PR review.

Keep four evidence layers separate:

1. Deterministic contract tests: malformed references, capabilities, temporal ordering, atomicity, historical provenance, conflict domains, no-op and non-accepting `NEEDS_CONTEXT` behavior.
2. `npm run eval:core:validate`: offline corpus/exemplar validation, zero provider calls.
3. `verificationRequests[]`: best-effort orchestration sidecars returned alongside an accepted `PROPOSE`. They are not model scores, semantic events, durable state, or factual authority; invalid sidecars may be dropped without changing otherwise valid semantic acceptance.
4. `npm run eval:core -- --assess PATH`: assess saved provider responses. Any future live run must use a separately reviewed autonomy/correction-aware dataset and explicit user authorization; the two frozen M2 datasets below are closed to further live evaluation.

Each model turn sees only evidence committed through that turn. Examples are not sent to the provider. A response may contain multiple ordered steps; each step has ordered knowledge mutations and one Cue mutation. The offline adapter returns candidate events only after all response steps validate, without publishing intermediate candidates. Verification sidecars are normalized separately from the semantic transaction. This is not production persistence or a response-wide durable transaction.

The evaluator checks Core counts/identity, current mainline, independently matched object/relation/Support predicates, prohibited claims, Cue lifecycle, operation/step coverage, domain provenance and replay. Alias groups allow reviewed wording variants. Lexical predicates are limited semantic diagnostics, not proof of general entailment, intervention timing, correction evidence quality or subject-matter truth; broader paraphrases and nuanced cases require review. There is no model performance threshold. Failed cases are individually reported; corpus validation and model performance are not interchangeable.

### Core projection and provenance configuration

`CORE_CONTEXT_BUDGETS` bounds serialized context to 32,000 JSON characters and 48 entities, with at most three candidate Parked Cores, 18 optional roots, six recent evidence checkpoints, four recent change records, eight unresolved phrases, four optional priors and eight explicit domain rules. Mandatory structural closure is admitted before optional context; a root and required endpoints/targets are included together or blocked/omitted. Automatic candidates require a positive discriminative lexical signal from a valid accepted proposition. Retrieval compares exact normalized tokens, retains numeric tokens regardless of length, and weights matches by inverse Core frequency. Vocabulary present in every historical candidate Core cannot alone establish relevance when there is more than one candidate. A single historical Core remains retrievable by a positive exact lexical match. This is a retrieval ranking mechanism, not a semantic Core-boundary classifier. Candidate Core identity, anchor, metadata and Core append/refocus capability are admitted atomically; budget failure rolls them back together. Zero-score candidates never fill unused quota. These are configurable implementation budgets, not semantic capacities or Core-boundary thresholds.

The provider envelope separately checks `ceil(JSON characters / 4) + 8,192 output reserve <= 24,000 estimated tokens`, including policy and structured schema. This character estimator is conservative configuration, not an exact tokenizer. Oversized mandatory input blocks without consumption or clipping. Request schema limits are eight steps, 24 knowledge operations per step, 16 references per field, four verification requests per response, and 1,200 characters per generated fact/request text field. No corresponding capacity is imposed on durable Core state.

Projection declares Core-identity coverage, per-Core content completeness, authoritative empty knowledge, and absent/included/omitted Cue. Structural dependencies and explicitly required references default to reference-only. Complete valid objects, relations and Support intentionally admitted as semantic roots or candidate anchors receive `factual_basis`; explicit host `factualBasis` targets provide the same authority. Merely adding a dependency does not grant it factual authority. Core containers and Cues cannot receive factual-basis capability. `readRefs` still uses `reference`, while factual `provenance.state` requires `factual_basis` in addition to unchanged validity and Core-container rejection. Mutation authorization does not itself imply factual authority. Host-supplied `writable` targets explicitly authorize unit revise/invalidate/supersede or Cue revision; `required` only requests projection. The current Core receives append capability and remains current without refocusing. Refocus is granted only to successfully grounded Parked candidates, which also receive append capability; `readOnly` overrides grants. The offline corpus adapter intentionally authorizes its reviewed named reference selectors as mutation targets and, for eligible factual units, factual bases, independently of exemplar/provider operations; this is fixture target scope, not a production working-window heuristic. Corpus bytes and semantic expectations remain unchanged. A Core container is not a substitute for a proposition's provenance. Accepted facts can terminate provider-visible provenance closure; their historical lineage is resolved locally against recorded channel revisions, never current text under an old ID. Origin labels retain `speech`, `accepted_state`, `domain`, and `ai_correction` distinctions. AI-correction trigger speech is validated against immutable evidence but is not presented as factual speech support for the corrected proposition. Historical ancestry is not serialized as dangling provider references. Bounded recent knowledge-change records carry action/target handles and supersession replacement handles into the projected accepted state, plus consumed sequences and an explicit completeness flag. Unprojected changes are omitted from those records and mark them incomplete; they cannot pull arbitrary historical Cores back into context. No summaries or second durable state are created.

Creation aliases are response-local, unique across steps, and mapped to M1 identities from lesson/request/step/kind/operation index. Same-step creations may be structural targets; only earlier accepted steps' creations can become accepted-state provenance. Current triggers and ordered consumption are distinct from factual attribution. Explicit `reads` guards cover channel-level dependencies including absence and no-ops; entity provenance/targets impose additional mechanical dependencies. Semantic completeness of declared reads remains a provider/evaluation responsibility.

`NEEDS_CONTEXT` accepts only supplied new-evidence handles and an exact evidence phrase as the retrieval query. It remains the only top-level non-accepting outcome and produces no event, no consumption, no semantic revision, and no automatic retry.

A `PROPOSE` provider response now carries required `verificationRequests` on the wire (use `[]` when none). Each request may name current evidence handles, an exact evidence query phrase, the claim to inspect, and model-surfaced `candidateEvidence`. The semantic steps still cover and consume the request's evidence normally. Sidecars are normalized best-effort after semantic acceptance: malformed/ungrounded requests may be dropped and cannot roll back otherwise valid semantic steps. Candidate evidence must not be persisted as learner truth or reused as trusted correction provenance without independent host/verifier validation.

Current settled correction authority remains deliberately narrow: `aiCorrection.evidenceRule` must reference a host-supplied domain/trusted rule whose exact text equals the corrected proposition. Acceptance records the rule basis in durable correction provenance and rejects missing/mismatched evidence. Model confidence is not represented as factual authority. This provides a safe verifier seam without pretending that a second LLM agreeing with the first is independent evidence.

Cue authority remains distinct from factual provenance. New provider proposals may set `value.origin` to `TEACHER` or `AI`; an AI origin is anchored to current teaching evidence for timing but does not claim that the teacher requested the action. Older frozen exemplars without `origin` remain accepted through the legacy teacher-established compatibility path. Current `REPLACE`/`RESOLVE` mechanics remain teacher-evidence-grounded; broader autonomous Cue lifecycle orchestration is deferred to runtime work.

Syllabus is a soft product boundary, but this M2 schema intentionally does not accept free-form model belief as a common-knowledge factual provenance source. Low-risk common-knowledge augmentation is product-authorized in principle; its durable authority path requires separate review before production cutover. Do not fake it by mislabeling model belief as speech or a trusted domain rule.

Core evaluation does not import the production scheduler/store/runtime. Normal new `/session` sessions use the production Core host; the frozen legacy evaluator/corpus remain historical and unchanged. Generated outputs should be redirected only to ignored `.cuelayer/` or `artifacts/` locations.

```sh
npm run eval:semantics:validate
```

Paid provider evaluation is run only when explicitly authorized by the task and secure runtime configuration. Do not infer authorization from documentation examples or previous runs.

Evaluation output must remain outside tracked source. Repository validation must not create or modify tracked evaluation artifacts.

### Model-informed M2 evaluation discipline

The first authorized Luna run on `a9d0b7e` and the original 24-case corpus/hash are frozen baseline evidence. The next same-case run is regression evidence, not an unbiased holdout. No further run on that frozen corpus is implied or authorized.

The separate eight-case set in `resources/semantics/core/postfix-holdout.jsonl`, pinned by `postfix-holdout-manifest.json` as `core-interpretation-postfix-holdout-v1`, is frozen, consumed holdout evidence. Do not edit it or run it live again. Preserve its recorded machine result exactly; human adjudication does not retrospectively rescore the artifact. Deterministic exemplar validation remains permitted and establishes fixture/contract consistency only.

```sh
npm run eval:core:validate -- --fresh-holdout
```

The default dataset remains the original 24 cases for deterministic historical contract validation. `--fresh-holdout` explicitly selects the separate frozen set; only deterministic exemplar validation of either frozen dataset is current-authorized.

The autonomy-authority revisions supersede two product expectations embedded in the original 24-case corpus: `CORE1-teacher-claim` rewarded faithful persistence of a teacher factual error and the historical corpus also treats arbitrary AI learner-action initiation as forbidden. Those gold expectations remain frozen historical evidence and must not be edited or retrospectively rescored, but they no longer define current product semantics. Consequently the recorded 19/24 and 21/24 runs remain valid historical M2 evidence only; neither is a current-policy acceptance score for policy v7/proposal v4/context v3. The frozen eight-case 5/8 result likewise remains historical. A new reviewed autonomy/correction-aware dataset is required before any future live semantic model evaluation.

Live evaluation journals each raw provider response to a unique ignored `.cuelayer/evaluations/core-calls-*.jsonl` **before** incomplete-status, JSON/schema or semantic validation. Available response ID, request ID, actual model, usage, output content, start time and elapsed milliseconds are retained. Final case results retain the same diagnostic and any parsed proposal even on rejection. Transport errors retain timing/error metadata without invented output. These are evaluation artifacts, not production trace or durable state; request settings, reasoning, token limits and zero-retry behavior are unchanged. The first run's missing rejected raw proposal cannot be recovered retrospectively.

Policy v2 distinguishes an unfinished current phrase (normally accepted no-op, with recent evidence available for continuation) from required missing earlier context (NEEDS_CONTEXT). A distinct self-contained explanatory mainline can require a new Core without transition words; unresolved Cue does not force Core continuity. Exact boundary heuristics remain open. A visible current shell cannot identify omitted specific content, and staying current requires no refocus operation. Policy v3 additionally directs interpretation to use a complete visible `factual_basis` unit when the current reference actually resolves to it; prior-state origin is not itself missing context. Availability does not imply relevance. Policy v4 explicitly separates domain-rule authority from teacher speech/Cue authority. Policy v5 introduced distinct autonomous-correction provenance but still allowed model self-confidence to serve as the correction authority gate.

Policy v6 corrected that authority problem: model confidence may motivate verification but cannot settle learner-visible truth; settled correction requires host-verified trusted evidence. It also introduced proactive AI-origin Cue and separated intervention origin from factual provenance. Proposal v3 represented possible conflict as top-level non-accepting `NEEDS_VERIFICATION`.

Policy v7 / proposal v4 close the scheduler contradiction before live integration. There is no top-level `NEEDS_VERIFICATION`: an otherwise accepted `PROPOSE` carries `verificationRequests[]` as best-effort non-authoritative sidecars. Ordinary semantic steps continue to consume evidence; invalid sidecars cannot roll back otherwise valid semantic acceptance. `NEEDS_CONTEXT` remains the only top-level non-accepting result. Context remains v3 because its projection shape is unchanged. Durable `lesson-event-v5-core` remains replay-compatible because verification sidecars are not durable events/state and the cutover does not alter accepted-event schema or replay semantics.

The frozen `CORE1-domain` fixture has a speech-intent/addressee ambiguity: “Supply its conventional symbol as enrichment.” appears in current teacher speech and was interpreted as a learner TASK. This does not establish domain-metadata leakage or arbitrary Cue invention. Current policy still states that domain metadata does not itself prove teacher-established learner work; independently AI-initiated Cue is product-authorized through explicit AI origin. This human adjudication changes neither the frozen fixture nor its recorded machine score.

### Authoring semantic predicates

For future fixtures, use independent `all` groups for independently required semantic components when exact surface wording is not the behavior under test. For example, `[["pump"], ["pressure"], ["adequate", "sufficient"]]` accepts reviewed reordering and synonyms while requiring all three components in the same matching unit. Each inner group supplies explicit alternatives; every outer group is required. Avoid a single canonical full sentence for a compositional assertion, including in `currentContains` when that would inadvertently restore the same wording restriction.

Keep truth-critical relationships intact. Do not reduce negation, quantities, directional roles or conditions to an unordered bag of words. Author phrases/alternatives such as `does not open`, `ten litres`, `from inlet to outlet`, or `only when power is on` as appropriate, with `none` exclusions for known confusions and `forbidden` for prohibited content across accepted output. Pair each positive fixture with minimally altered negative examples. The existing lexical scorer cannot prove entailment or exhaustively detect every semantic inversion; explicit alternatives and human review remain necessary. No fuzzy matching, general LLM judge or universal semantic guarantee is introduced.

Test retrieval with predetermined separate accepted Cores when retrieval is the behavior under test. Do not make retrieval coverage depend on a model first choosing a debatable Core boundary. Deterministic numbered-history regression establishes candidate identity, numeric discrimination, append/refocus authority, current-Core non-refocus and identity reuse without imposing new Core-boundary semantics.

This is guidance and regression coverage for future authoring, not retroactive rescoring or modification of either frozen corpus or historical model result.

## Acceptance boundary

Offline evaluator passes establish only the behavior measured by that corpus and evaluator. They do not establish:

- real microphone / ASR fidelity;
- real browser/audio-to-DOM latency;
- learner attention quality or Intervention Governor calibration;
- correctness of a newly introduced domain schema;
- correctness/calibration of autonomous factual correction or evidence retrieval;
- pedagogical quality/frequency of AI-initiated Cue;
- long-lesson Canvas behavior;
- real-world lesson acceptance.

Real-lesson acceptance must use separately defined evidence and must not be inferred from synthetic or transcript-only passes.

## Migration rule

When the production Board domain migrates from legacy `SET_ACTIVE` / bounded `Retained` semantics to persistent Cores and local semantic operations:

1. preserve the frozen v5 corpus/evaluator as historical compatibility evidence if still useful;
2. introduce a new evaluation identity for the new semantic contract;
3. review new gold rather than mechanically translating old slot-based expectations;
4. keep renderer/layout/attention evaluation separate from semantic interpretation evaluation where possible;
5. record run output outside tracked source.

## Core live runtime regression gate

M3 runtime correctness is checked separately from the frozen semantic model corpora. Deterministic tests inject transports and exercise the real Core provider envelope/parser, bounded context, normalizer/validator, lossless scheduler, atomic event persistence, replay, Cue references, verification dispatcher, finalization and trace writer. The live runtime does not use the offline exemplar adapter as a persistence boundary.

CI runs `npm run eval:core:validate` in addition to the legacy frozen validator and full test/build/hygiene checks. The optional `--fresh-holdout` validation is also deterministic. Both commands report `mode: exemplar-contract` and `modelCalls: 0`; passing the 24-case and eight-case fixture contracts is not a model score. The frozen historical 19/24, 5/8 and 21/24 model results remain unchanged and must not be rescored.

## Teaching Representation architecture regression

The representation gate is deterministic and separate from semantic interpretation/model evaluation. `src/teaching-representation/architecture.test.ts` exercises accepted Core snapshots → producer admission → lightweight M4A candidates → selected host payloads → artifact reconciliation. `src/canvas-spatial/semantic-space.test.ts` covers measured local growth, incremental pressure propagation, unchanged distant spaces, repeatability and temporary composition. The extracted motion tests check swept collision intervals and interrupted travel. The development entry test inspects the actual production bundle against the intentionally integrated M4C representation modules and excludes subject/development capabilities.

The original authored Chemistry acceptance sequence and seven Mathematics GOLD checkpoints remain in `src/dev/teaching-representation/lesson.ts` and `trig-lesson.ts`. `fixtures.ts` supplies explicit reference bindings and review attention, and appends one reducer-accepted Math comparison withdrawal. It registers trusted text, accepted-relation, energy-profile, equation and finite-function capabilities through the generic implementation registry. Fixture attention requests semantic targets/media/roles; it does not select exact authored artifact names or pass renderer payloads into M4A.

```sh
npm test -- src/teaching-representation/architecture.test.ts src/canvas-spatial/semantic-space.test.ts src/canvas-spatial/motion.test.ts src/dev/teaching-representation/entry.test.ts
```

Required checks include candidate availability without display; atomic rejection of malformed/ungrounded proposals; stable payload/candidate/artifact binding; selected-only visibility; revalidation on PRESERVE and historical reuse; local relation withdrawal without deleting surviving nodes; Math curve counts `0,1,1,2,2,3,3,2` under one plot identity; and isolation from Core/Cue mutation. Core/M4A contract bytes and frozen corpora remain unchanged in that historical gate.

Browser review uses both development stories at 1280×720. Walk every checkpoint, inspect PAIR/WIDEN/COMPARE and return, record visible artifact IDs/DOM instance continuity, measured bounds, clipping, curve/relation withdrawal and console output. In the separate diagnostics panel, use **Grow selected artifact** to increase actual rendered width and verify that only pressured neighboring spaces move. Check shared-projector drag/zoom through an accepted update and **Follow teaching**. Store screenshots, geometry, logs and review observations only under ignored `.cuelayer/` or `artifacts/`.

This gate establishes a bounded architecture seam, not generic semantic entailment, arbitrary graph layout, classroom comprehension, production/shared-surface cutover or AI representation autonomy. The finite Chemistry and Math meaning checks belong to capabilities, not Canvas. Pure domain-only grounding without a committed checkpoint is conservatively rejected by the current adapter to M4A's evidence requirement.

## Core shared-projector regression (M4C)

`src/session/core-projector.test.ts` drives the actual Core live scheduler/persistence with injected deterministic proposals, then checks production admission, metadata selection, canonical lifecycle, exact M4A execution, identity/session/binding isolation, target-anchored Space assignment, stale withdrawal and diagnostic failure isolation. It verifies that no speculative artifact appears while semantic persistence is held, replay matches the published state, and no legacy Board events participate. Existing architecture tests retain the finite-capability stale-part pruning regressions and frozen Core/M4A contract hashes.

`src/canvas-spatial/Canvas.test.tsx` mounts the production stage/surface with deterministic DOM measurements and ResizeObserver delivery. Coverage includes independent artifact size changes, exact 120px local displacement with an unchanged distant Space, observer deduplication, canonical DOM continuity, temporary composition/return, manual inspection with semantic revision and withdrawal, Follow teaching, measurement/pressure failure, renderer exception/empty mount recovery, diagnostic callback continuity, narrow composition and the automatic zoom floor. These tests establish DOM execution behavior, not physical display or classroom comprehension.

Browser acceptance uses `/dev/core-projector` at 1280×720 and 390×844 with reduced motion. Review accepted entry/revision, WIDEN/COMPARE and return, native artifact-internal resizing without changing accepted state or outer Canvas dimensions, teacher drag/wheel, revision and withdrawal during inspection, Follow teaching, mainline shift/refocus, clipping/overlap, node continuity, console output and network requests. The optional diagnostics disclosure supplies the measured homes, transient boxes, visible IDs and failure reasons. Store screenshots and logs in ignored `.cuelayer/reviews/`; do not commit generated evidence.

The implemented production-bundle regression permits only the generic representation/Canvas modules and the reviewed `accepted.content` implementation. It excludes development entries, Chemistry/Math capabilities and graph-layout packages. The import-boundary regression follows the normal domain-gated Core route to its controller and reviewed shared surface, excluding legacy semantic reducers and development/subject capabilities. The separate legacy branch remains available for historical restoration. Full validation includes typecheck, all tests, production build, both frozen exemplar validators, clean repository hygiene and diff checks. No historical model evaluations, provider or verifier calls are part of this gate. The next-version capability allow-list must be deliberately revised for individually reviewed production capabilities; it must not freeze accepted text as the permanent product or permit wholesale import of demo code.

## Normal production-route regression

The cutover suite uses the actual `/session` component, durable IndexedDB domain gate, Core live controller and HTTP seam. Synthetic committed canonical speech and injected local proposals are the primary evidence; authored accepted GOLD snapshots are not the production-route proof. The suite checks persist-before-publish through learner DOM, provider/output/storage failures, identity-preserving revision, representation failure/recovery, replay without evidence duplication, historical v3/v4 restoration, domain mismatch, finalization and no dual semantic writer. Production composition tests additionally isolate diagnostic/verification failure, competing acceptance and retryable incomplete finalization. Existing Core tests retain independent knowledge/Cue conflict, timeout and cancellation coverage.

`npm run report:bundle` measures the actual emitted production graph using built-in gzip/brotli compression. The production import regression follows static dependencies of each domain branch and the generated Core chunk, forbidding legacy semantic reducers, development fixtures, Chemistry/Math and graph-layout dependencies on the current Core route. Generated measurements belong in ignored review evidence.

Browser acceptance of `/session` covers desktop, narrow/reduced-motion, durable Core claim, synthetic speech ingress, delayed persistence, revision/identity, mainline shift/refocus, teacher inspection, representation failure/recovery, exact reload, semantic finalization and historical legacy replay. The Runbook defines reproduction and evidence storage. These deterministic checks establish integration correctness only. M6 classroom/model/microphone acceptance remains a separate HOLD gate; no frozen corpus or historical model result is changed or rerun.

## Next-version joint acceptance — specification, not a passing result

This section evaluates `session-first-surface-design-v1` from `SYSTEM_CONTRACT.md`. It defines required evidence for future implementation. It does not claim that Live/Stage, streaming, recovery records, new capabilities or the following tests/metrics already exist. Keep one evaluation identity per active contract; introduce the necessary reviewed fixtures deliberately instead of rewriting frozen historical gold or inventing CLI commands in documentation.

### Evidence separation and source handling

Use four distinct tracks:

1. **Incident reproduction:** preserve the corresponding original trace/audio and exact code/configuration in ignored local storage. A retrospective textual diagnosis is not a substitute for the trace and does not prove its quoted timings, object counts or viewport coordinates. Do not combine an earlier solids trace with a later equilibrium diagnosis as though they were one session.
2. **Accepted-state display replay:** reviewed synthetic accepted states test selection, representation, choreography and visibility without live inference. This does not certify upstream extraction or ASR.
3. **Timed evidence-to-surface regression:** timestamped committed evidence plus injected proposals exercises the actual Window, scheduler, stream reader, acceptance, persistence and normal `/session` route. Golden accepted states must not be injected past the layer under test.
4. **Authorized live evaluation:** real audio and provider calls measure ASR, model quality, latency, cost and sustained usability. Use a new reviewed set, not the frozen M2 corpora; record failure and absence as outcomes, not missing rows.

Private real captions, traces and generated screenshots remain ignored and are not uploaded to the public repository as GOLD. Derive de-identified synthetic cases, explicitly label what was authored and obtain review of expected meaning/frames. Include one additional Chemistry story, one Mathematics story and a non-STEM holdout with wording/structures not used to tune the implementation. An independent holdout is not a renamed development example.

### The first display regression story

The supplied equilibrium/partial-pressure diagnosis defines the following desired progression, conditional on sufficient source grounding. These expectations are design requirements until implemented and independently reviewed:

| Teaching checkpoint                    | Expected current frame                                                       | Prohibited shortcut                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Lesson preview                         | Preserve or minimal topic anchor when useful.                                | Automatically create several dominant agenda-prose cards or learner TASK from an agenda verb.     |
| Unclear Kc expression                  | Keep last valid knowledge; retain unresolved evidence.                       | Confidently generate a scientific formula from ambiguous transcription.                           |
| Grounded Kp explanation                | Useful compact accepted form preserving scope.                               | Invent missing conditions or claim generic parsing from one exact phrase.                         |
| Accepted partial-pressure relationship | `p_i = x_i P_total` with grounded operands.                                  | Literal prose as the only available production form, or unsupported symbols.                      |
| Optional total-pressure note           | Attached, subordinate annotation if useful.                                  | Another dominant full-size card; hiding a mandatory condition as optional Support.                |
| Accepted mole-fraction relationship    | `x_i = n_i / n_total` dominant, prior equation necessary context.            | Old Calculate Kc Cue pulling camera bounds, fabricated causal arrows or unrequested substitution. |
| Mainline shift/return                  | Readable new neighborhood; previous identities and homes remain revisitable. | Horizontal singleton conveyor as policy, duplicate knowledge copies or implicit deletion.         |

### Runtime and semantic acceptance regressions

Required deterministic cases cover: a proposition split across at least three ASR fragments; accepted no-op followed by completion; same-ID retransmission versus genuine repeated teacher wording; exact negation/quantity/condition preservation; teacher self-correction; explicit and ambiguous topic return; teacher versus AI Cue origin and agenda-versus-task speech acts; no answer leakage; bounded pending work under continuous input; Live progress while Stage is deliberately delayed; Stage coalescing without lost coverage; no cancellation starvation; and evidence-to-meaning progress restored after reload.

Verify separate recorded, Live-accounted, Stage-reviewed and unresolved progress. Live coverage must distinguish established meaning, deliberate no-change and deferred/unresolved meaning; Stage coverage must preserve reconciled/no-further-change versus still-unresolved obligations. A compact contiguous watermark is valid only when deferred/unresolved items behind it remain separately addressable by evidence identity/range. A no-op cannot erase unresolved content. Stage reconciliation must not re-consume evidence, forge checkpoints, duplicate identities, relabel stale base revisions or bypass host-captured entity/scope/absence/mainline dependencies. Test both unrelated concurrent updates that remain valid and relevant updates that require rejection. Test stale attention independently from a useful historical semantic patch. Lost acknowledgements/retries must resolve idempotently against the durable accepted prefix.

Pause persistence across normal-route acceptance and prove no speculative artifact is published. Crash/reopen between evidence recording, inference, atomic acceptance/disposition recording and notification; restore exactly the accepted state and remaining obligations. Prove that the reconstructed Session Working Window comes from durable evidence references/dispositions/obligations rather than a persisted Window snapshot, provider conversation or trace. End capture with pending Live/Stage work: record the complete tail, bring every committed evidence item to accepted/no-change/deferred terminal Live disposition, durably persist unresolved and unfinished Stage obligations, then seal. Stage is not required to drain before `lesson.ended`; a sealed lesson rejects late Stage mutation. Any post-session reconciliation must use a separately versioned workflow. Preserve legacy v3/v4 and historical Core v5 replay.

### Streaming and local runtime regressions

Break transport chunks at arbitrary UTF-8 and JSON boundaries; deliver malformed, oversized, refused, incomplete, stalled and disconnected streams. Verify bounded draft memory, no partial semantic publication, abort-source diagnosis, zero repeated token-driven React rendering and persistence-before-publication. Observe actual early chunks on both local and deployment paths so proxy buffering cannot masquerade as streaming. For the initial single-patch contract, report completion latency honestly rather than treating first delta as useful output. Multi-unit streaming requires its own reviewed closure/dependency/idempotency tests before partial-response acceptance.

Compare incremental context/provenance indexes with full deterministic replay. Measure context-building and acceptance CPU with increasing lesson history, not only short fixtures; check that normal requests do not repeatedly replay the whole session. Worker use must retain one writer and correct versioned snapshots. Ensure PCM delivery precedes diagnostic work. Validate audio-time mapping over delayed finals, pause/resume, device-rate changes and reconnects; report unmapped samples rather than guessed latency.

### Representation and readability regressions

Candidate admission must be kind-agnostic at the semantic request boundary: a request for object meaning can select math/relations/annotation/grouping instead of pre-forced TEXT. Check that a valid candidate can remain undisplayed and that text is selected when exact wording is genuinely best. Ground every mathematical operator, operand, symbol and condition; type-valid AST alone is not proof of equivalence. Negative tests swap numerator/denominator, negate a relation, remove a condition, change units, misbind symbols or introduce an unsupported transformation. Reject or faithfully degrade; do not fix the semantic gold to match the renderer.

Exercise relation-only, Support-only, correction and invalidation updates as attention triggers; preserve only the required neighborhood and genuinely useful Support. Exercise Work Surface independently: AI-generated learner-visible assertions may appear there only when grounded in accepted meaning/evidence or accepted through the same semantic authority as Board truth; partial model drafts and rejected interpretation must never become visible merely by being labelled intermediate work. Verify active/stale withdrawal and reload behavior from authoritative activity/grounding records rather than renderer state.

Distinguish FOCUS, dimension-aligned COMPARE and topology-preserving WIDEN. Verify FOCUS temporary composition with the same canonical IDs and immutable home input, home return, stable DOM identity, cross-Core necessary context without duplicates, and local Space growth without global compaction. Joining uncertain or cross-space relations must not silently merge unrelated neighborhoods.

Use measured geometry in normal `/session` at 1280×720 and 390×844, including reduced motion, delayed font/resource resize, controls, Cue/Work safe-area reservation and presentation overlays. At each supported settled automatic frame assert: dominant and required context are fully within the safe area; readable-size policy is met; no required qualifier is removed; no unrelated overlay clipping; companion Cue world coordinates do not affect Board bounds; no rescue pan is needed. Force each deterministic recovery rung in order: admitted compact alternative with the same semantic neighborhood, removal of optional Support, smaller semantically complete dependency closure, then explicit staged/degraded/unsupported outcome. Assert that geometry pressure does not invoke another semantic/model decision and Canvas does not manufacture a candidate or semantic neighborhood. During manual inspection, preserve camera override while semantic validation and stale withdrawal continue. Follow teaching applies only the latest valid intent.

An impossible oversized-content case must explicitly select faithful compact/staged content or report unsupported/degraded status. Do not delete internal `fits=false` diagnostics, set success flags without DOM evidence, or insist that arbitrary content fits any viewport. An automated rectangle check is complemented by human readability/meaning review.

### Initial engineering targets and reporting

These are proposed acceptance targets, not measured performance or vendor guarantees. Freeze the chosen code/configuration and workload before comparison; report sample counts and uncertainty. Measure useful visible response only for independently labeled opportunities, with misses and coverage reported alongside latency.

| Metric                                                                              | Initial target / reporting rule                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sufficiently complete teaching evidence end → first correct, useful, readable frame | p50 ≤ 2.5 s, p95 ≤ 4 s. With real audio, include ASR; with text replay, label ASR excluded.                                                                                                                            |
| Live provider request → complete admissible patch                                   | Investigate p50 ≤ 0.8 s, p95 ≤ 1.5 s as an initial hypothesis, not a semantic or release invariant; separately report validation rejection and no-useful-change rate.                                                  |
| Continuous workload                                                                 | At least 20 minutes without continuously increasing pending age or unreported unresolved/review debt. Include retry failures and actual checkpoint throughput per batch.                                               |
| Late Stage                                                                          | Ordinary Live work continues; relevant history can reconcile; expired attention never reclaims the camera.                                                                                                             |
| Quality and coverage                                                                | All curated critical correctness cases pass; independently adjudicate live ambiguity, factual inversion, Cue false positives, missed opportunities and unsupported representation. No all-QUIET or text-only shortcut. |
| Readability                                                                         | Supported settled frames meet measured safe-area and readable-size requirements; report explicit unsupported cases and inspection exceptions separately.                                                               |
| Local performance                                                                   | Record context/index/acceptance/render CPU, main-thread stalls, retained history/heap and bundle delta; compare long-session growth with the baseline before imposing a machine-independent CPU budget.                |

Instrument a single correlation chain across capture/audio time, ASR final, canonical closure, durable evidence, dispatch/queue start, HTTP/provider first delta/completion, validation/persistence/publication, selection and actual visible frame. Separate one-time microphone/token/socket startup from steady-state ASR. Use monotonic durations per clock domain and record mapping uncertainty; do not subtract unsynchronized server and client wall clocks. Capture actual provider model/usage, output and reasoning tokens, cache usage where returned, request weight and failure source without secrets. A configured output ceiling is not actual generated output and cannot by itself explain latency.

Compare ASR settings, Live model/reasoning profile, output grammar, context weight, cold/cache behavior and coalescing separately before an end-to-end combined run. Deadline extension removes censoring, not latency. Streaming, faster first token and successful schema parsing are not sufficient product metrics.

### Integrated release gate

Evaluate runtime/semantic quality and display/readability in parallel, then join them in a small normal-route vertical slice. Do not postpone latency until after every display capability, or improve speed while knowingly preserving unusable framing. Development harnesses isolate failures, but acceptance requires normal `/session` without manual authored attention plans.

Report exact base/final SHAs, schema/policy/profile identities, changed files, deterministic commands actually run, frozen hashes, candidate/selected forms, visible frames, long-session queue behavior, live call counts and known unsupported cases. Preserve historical frozen evaluators. New production capability and schema boundaries are deliberately reviewed, not hidden behind claims that all old contract bytes remain unchanged. Paid/audio runs require explicit authorization; documentation-only PRs do not claim these implementation gates passed.

## Parallel V2 experiment — deterministic gate

Evaluation identity: `cuelayer-v2-deterministic-slice-1`. Run inside `apps/cuelayer-v2/`:

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run test:browser
npm run measure
```

The separate test filenames (`*.v2.ts`, `*.browser.ts`) prevent the unchanged production Vitest runner from discovering V2 tests. The new V2 CI workflow installs and tests only this package. The original production typecheck/test/build and both frozen exemplar validators remain required and unchanged.

The unit suite exercises the real V2 writer, validator, reducer and Dexie database through fake-indexeddb. It covers partial/PREFLIGHT rejection, provider interval identity and retransmission, conflicting content, persistence-frontier blocking, persist-before-publish, lost acknowledgements, competing writers, bounded continuous batches, independent Stage, stale dependencies, missing operands, explicit dispositions, unresolved recovery, retry classification, local correction and dependency-safe invalidation.

Playwright drives actual speech messages through the V2 browser entry and normal V2 acceptance, storage and display code. The nine cases cover presentationless/overlay, desktop/narrow, reduced and enabled motion, continuous arrival during Live inference, delayed and stale Stage, FOCUS/COMPARE, safe Cue geometry and expired-invitation suppression on return, Canvas growth, teacher drag/wheel, automatic-camera suppression, Follow Teaching, representation failure/recovery, reload, durable-frontier failure and unexpected browser console errors. A deterministic Board screenshot equality assertion checks that no-change evidence does not move or redraw accepted content. Screenshots/results remain ignored, not historical GOLD.

The authored fixture establishes exactly what it says, including units and conditions. Its Stage annotation requires two distinct committed fragments. It intentionally leaves an ambiguous Kc expression unresolved across reload. The finite sine plot and chemistry reaction are capability checks within this story, not independent subject holdouts or a general semantic benchmark.

The continuous browser workload is 240 additional finals at 45 ms intervals with injected 180 ms Live service and bounded batches; record the actual pending-age samples, maximum age and progress while input is still arriving. The default story uses injected 120 ms Live and 1,200 ms Stage service. These are synthetic loads of seconds, not the mandatory future real 20-minute test.

`npm run measure` inventories complete infrastructure-bearing source files against base `3ac50ab0918191605c8b7152d9ae943061f3a459`. It formats both sides identically before counting nonblank lines, includes mixed policy and every adapter, and emits per-file raw/normalized LOC and bytes. V2 queue/retry integration is counted in the complete Session file, not hidden by reporting zero standalone queue engines. Display policy and DOM probes are included in Canvas. The report also counts the full React shell and speech adapter in a separate all-infrastructure-bearing upper bound, even though their old counterparts are outside the selected comparison. All other V2 source is listed separately. These are conservative infrastructure-bearing totals, not exact pure-mechanics LOC or feature-parity savings. Trace breadth, provider transport, legacy import and the number of function variants differ and must remain explicit.

Bundle measurements sum actual emitted JavaScript and gzip bytes for the unchanged production build and V2, including optional lazy chunks. This comparison must accompany LOC claims: fewer custom lines can still mean a much larger downloaded/runtime substrate. Reports are generated under `.cuelayer/v2/`, never source or frozen corpora.

Passing this gate supports only the isolated deterministic slice. Real Speechmatics behavior, model interpretation quality/cost, productive-work/AI-intervention calibration, independent Chemistry/Math/non-STEM holdouts, scalable context retrieval, 20-minute throughput and production cutover remain unproven.

### V2 real-service evaluation tracks

Keep `cuelayer-v2-deterministic-slice-1` and its original tests. `tests/providers.v2.ts` additionally tests the real adapter's SDK stream framing, terminal completion, malformed/schema/identity failures, bounded host context, old-fragment grounding without re-consumption, empty provider messages and ordered failed-final retry. The browser services suite runs the real route with explicit mocked service boundaries: official microphone/ASR adapter, concurrent finals, model completion through acceptance to DOM/reload, fabricated-grounding rejection, and Teaching Representation continuity. These tests incur no provider cost and do not establish real model quality.

The opt-in real-model and generated-audio commands are defined in the Runbook. `tests/real/teaching-stories.json` is a de-identified authored review set, not frozen or human-approved model GOLD. Report source/provenance and reviewed expected meaning separately from actual accepted operations: pressure and mole-fraction expressions with units/context, incomplete Kc, identity-preserving correction, a grounded partner Cue, and distinct repeated wording. A case not reached after an earlier failure is NOT TESTED. Review semantic fidelity manually; schema success and no crash are not accuracy measures. Stage coexistence and Cue expiry may be reported as deterministic/replayed evidence until real-service evidence exists.

Use the old Chemistry/Math Teaching Representation review in the Runbook as a behavioral reference for staged form introduction, dominant/companion roles, stable artifact identity, correction/withdrawal and productive-work preservation. Do not copy subject templates to make particular transcripts pass or treat V2's smaller capability set as equivalent functionality. The pressure progression must show the new fraction equation with earlier pressure context, preserve conditions, and avoid automatic substitution. Compare actual screenshots as well as metadata/DOM.

`npm run measure` retains #42's exact selected Current denominator and normalized complete-file method. It additionally inventories **all** V2 runtime TS/TSX at baseline `1c7c0ce05a1f54406d435d62f09d3ad0ac585587` and now: speech, Session, semantic contract/acceptance, model/prompt/schema/HTTP, persistence, trace, display and authored interpreter. Report evaluation plumbing and configuration/style separately, plus all emitted JS/gzip chunks. Do not hide model glue or compare synthetic 180ms model timing with real Current provider latency. Current real-service parity is unknown unless the same workload/model/source was actually measured.

A Draft PR decision reports per-stage implementation/validation status, stage latency counts and missing samples, semantic outcomes/failure categories, pending-age growth, full normalized LOC and bundle deltas. Keep the result separate from executable documentation; raw runs and the compact decision report belong in ignored local evidence and the PR description. Do not merge, deploy, claim owner microphone validation from generated audio, or declare the real slice passing when useful updates, Cue or sustained throughput failed.

### Incremental Semantic Frontier V2 evaluation

`tests/real/frontier-stories.json` under `apps/cuelayer-v2/` defines `cuelayer-v2-frontier-authored-1`: fragmented chemistry, mathematics, prose, administration, correction, unresolved reference, interrupted thought and sustained teaching. These are authored scenarios, not human-reviewed semantic GOLD. Preserve the original PR43 scenarios and raw baseline evidence separately. `scripts/evaluate-frontier.mjs` is the paired evaluator; its offline baseline mode reproduces protocol mechanics and payload size without calling a provider. `scripts/analyze-run.mjs` remains the canonical trace analyzer.

The three repair gates are runtime correctness, Live/Stage protocol correctness, and deterministic sustained evaluation. `frontier-live.v2.ts`, `frontier-stage.v2.ts`, `runtime-repair.v2.ts`, `semantic-repair.v2.ts` and `context-repair.v2.ts` cover the required failure/retry/recovery, fragmentation, range authority, bounded selection, typed correction, dependency withdrawal, obligation-only APPLY and Cue/attention cases. Every required regression must pass, without skipped/expected failures. The complete V2 unit/provider/browser/typecheck/build and unchanged production suites, frozen semantic/Core validators and repository checks must pass. Deterministic decisions establish the tested state-machine behavior, not arbitrary semantic entailment.

`workload-fixture.ts` independently defines 300 fixed 80-character records over 600 virtual seconds (40 characters/second), more than 200 distinct units, corrections, relations, Cue, coreless CARRY/clarification and established-Core Stage reviews. Each expected result declares evidence-ready time, acceptance deadline, required service rounds and whether it must display. The request-only `workload-interpreter.ts` cannot access the fixture, future input, omitted units or earlier unaccepted explanations. When an explicit correction arrives before the initial result's deadline and both are accepted together, the fixture permits the corrected identity with original unchanged-field provenance; obsolete values need not flash on screen.

Live service delays cycle 0.5/2/6 seconds, Stage takes 6 seconds, and normal scheduling/deadline settings are retained. `sustained.v2.ts` uses controlled time and a zero-time atomic append port; ordinary recovery tests use fake-indexeddb and the browser workload uses real IndexedDB. Normal work uses at most two Live intervals including any occupied slot, so raw source age is bounded by `2 × 6000 + 750 + 2000 = 14750 ms`. After 30-second warmup, each complete 60-second measurement window sampled every second must account at least 90% of arriving characters. Every semantic result must meet its own deadline; CARRY closure checks target, time, identity/version preservation and lifetime. Stage clarification allows the independently specified two additional 6-second Stage rounds, with actual accepted reviews, Live conflicts and recapture. The separate three-following-page fixture requires four serial Live rounds and retains the original source age. Capacity, transport and semantic-failure workloads expose backlog/failure instead of fabricating NO_CHANGE/CARRY consumption. Drain after input stops is reported separately.

`browser/sustained.browser.ts` drives the actual real-route adapter with provider calls replaced at dispatch, a browser-controlled clock, real IndexedDB, actual DOM geometry and a 1-second post-acceptance display budget. The fixture requires all 15 Cue invitations and the initial quantitative result to be visible with the accepted version/content; other facts are subject to per-item semantic deadlines, not a requirement to show 200 units simultaneously. `browser/lifecycle.browser.ts` separately verifies corrected numeric value/units/conditions in visible DOM and on reload, withdrawal of a derived value outside the capture, and independent Cue expiry. Virtual timing and browser wall-clock duration are distinct outputs. These results do not certify actual model/browser realtime performance.

Provider checks inspect the final SDK-generated Live/Stage schema: object root, nested `anyOf`, required object fields, closed extra properties and resolvable local references. The SDK `zodResponseFormat` helper supplies reusable definitions; the same strict schema is placed in the Responses text-format envelope. Same-shape operation branches share enum discriminators, while APPLY/NO_CHANGE/CARRY remain structurally exclusive. No all-nullable operation envelope or manual schema weakening is allowed. Local schema generation is not provider acceptance. `evaluate-frontier.mjs --protocol-compare` verifies baseline files against `727accf`, asserts equal semantic work and reports full request, schema, projection and response bytes separately; added revision capabilities can enlarge schema even when output becomes smaller.

Results and failure evidence are local ignored `.cuelayer/v2/repair/` artifacts. Preserve old Gate 3 records unchanged. All deterministic gates passing means **eligible to request a new real paid evaluation**. It does not pass the original Gate 3. Before any provider call, obtain fresh explicit approval for the fixed code version, scenarios/repetitions, model configuration and cost ceiling.
For paid OLD→NEW comparison, hold model/reasoning/output, Speechmatics configuration and observation deadline fixed. Collect source-character arrival/accounting rates, R/A gap and age during input, CARRY amount/age/resolution, calls per lane, request bytes and actual usage, complete valid decision latency, semantic changes and useful DOM matches. Preserve before-close samples separately from final drain. Growing backlog during continuous input cannot be hidden by post-stop draining or by converting everything to CARRY. Review accepted content for conditions, negation, relations, correction identity and false claims. Report the 2.5 s median / 4 s p95 learner-visible numbers as targets unless valid measured samples satisfy them. Failed or blocked real-service evaluation leaves the implementation Draft and unproven for realtime use.

### Gate 3b — Real-Model Text Pipeline Gate

Identity: `gate3b-real-model-text-pipeline-1`. Architecture reference: [Testing Architecture & Acceptance Design](https://docs.google.com/document/d/1ImwVax-a5sz8qHvzvu-v8iDSmukaUYJwLLJ4apTyJoI/edit). **Gate 3a remains FAILED at `727accf`.** The historical repaired product is frozen at `1a796e8c713b6f00ef9beb72004b456833a82ff5`. The shared execution identity below creates a separately bound run; it does not repoint this historical profile or its results. The evaluator has an independent checkout, SHA and Draft PR, with automatic deployment disabled. It must not modify the product checkout, PR #46, prompt/schema, scheduler, deadlines or retries. Unpaid preparation, assessment and replay remain credential-free. The six-snapshot paid canary entry requires a separate execution manifest and explicit authorization bound to its hashes; qualification alone never enables a provider call.

| Phase | Gate | Preregistered work |
| --- | --- | --- |
| 0 | 3b-0 Evaluator Preflight | Unpaid assets, manifest, provenance, driver, scorer counterexamples, budget and replay |
| 1 | 3b-1 Model Contract Canary | Six production-generated frozen requests, once each; C/D/E and applicable G |
| 2 | 3b-2 Semantic Loop + 3b-3 Text-to-Surface | Original eight scenarios × three independent browser sessions, collecting semantics and DOM in the same execution |
| 3 | 3b-4 Sustained Semantic Load | Natural Semantic Load v1, 600 seconds, full text pipeline |
| 4 | Adjudication / Report | Apply frozen rules to retained evidence; no model calls |

Every required phase predicate must PASS, with no pending adjudication, before the next paid phase. A hard semantic FAIL stops subsequent paid calls, including retries; all unstarted planned runs remain NOT_RUN. INVALID and pending adjudication also block progression. No replacement runs, best-of selection, prompt repairs, oracle edits or hidden skips within a cohort. Any code/prompt/schema/input change requires a new SHA, manifest and cohort. Canary success is not surface or sustained product acceptance.

#### Unified assets and dependency semantics

`apps/cuelayer-v2/tests/evaluation/contract.mjs` defines the executable Scenario Contract and predicate registry. `scenarios/` holds exact transcripts, semantic checkpoints, forbidden predicates, allowed equivalences, surface/timing/projection expectations, adjudication rules, preconditions and coverage requirements. `canaries/` adds two explicit isolated Stage contracts. Every expectation has `expectation_id`, `owner_layer`, `required`, `activation_rule`, concrete `prerequisites`, `predicate_id/parameters`, `evidence_refs`, and severity. Semantic checkpoints freeze all sufficient evidence sets and invalidation conditions.

T1 request assessment, T2 semantic loops and T3 surfaces use the same oracle and predicate IDs. The first four canaries use the original scenario inputs and semantic oracles. Stage canaries declare their accepted precondition logs explicitly. Those mechanically admissible preconditions are not claimed to have passed a preceding Live semantic evaluation and are never injected into T2/T3 to manufacture Stage coverage.

Dependencies form a DAG, not an unconditional A→H pass chain. A `pass` prerequisite means the dependent claim needs the prior predicate satisfied; `observable` means it needs evidence to exist even if judgement failed. Upstream failure that removes observability yields NOT_EXERCISED plus `blocked_by`, while independently observable predicates still run. Blocked checkpoints stay in coverage/debt denominators. NOT_RUN means the scheduled run never started. Exactly five terminal statuses exist: PASS, FAIL, INVALID, NOT_EXERCISED, NOT_RUN. `ADJUDICATION_REQUIRED` is a separate pending field and cannot imply PASS.

`first_violated_boundary` includes the predicate, causal event and observed causal order, alongside every independent violation. Missing causal evidence stays pending attribution; layer letters are not a root-cause ordering. Quantity selectors use expression structure, physical dimensions, role and source binding; random IDs are not gold. Duplicate current matches fail. Unrecognized paraphrases, conditions, role labels or endpoint bindings require the frozen rubric, not keyword matching.

#### A–H scorecard

| Owner | Responsibility |
| --- | --- |
| A Experiment Validity | Checkout/module/lock identity, driver, clock, evidence integrity and declared dependency mode |
| B Transcript Admission | Exact text, identity, ordering, reception and durable admission |
| C Context Projection | Contiguous PROCESS, preceding/accepted/CARRY context, read/modify/create scope, omissions and future boundaries |
| D Model Semantic Decision | Frozen semantic oracle and hard false predicates; schema compliance is only one component |
| E Acceptance & Semantic State | Actual prestate/proposal evaluated by frozen executable validate/fold acceptance and state rules |
| F Frontier / Realtime Progress | R/A progress, due semantic completion, CARRY burden/age/resolution and scheduler progress |
| G Stage & Recovery | Declared required Stage behavior and WAIT/CARRY/stale/retry recovery |
| H Learner Surface | Accepted content/version fidelity, required Cue/knowledge, readability, safe-area visibility, lifecycle and timing |

D=FAIL/E=PASS is correct when a semantically wrong proposal was mechanically admissible and correctly applied. D=PASS/E=FAIL is correct when the host wrongly rejects a correct proposal; dependent expected display becomes NOT_EXERCISED. E=PASS/H=FAIL diagnoses display/lifecycle failure. A proven scheduler stall is F=FAIL; absent request/response predicates are NOT_EXERCISED. H's accepted-state fidelity remains independently observable after a D failure; H does not inherit semantic failure mechanically.

Stage is a required hard gate only where the contract states why wider context is necessary, triggering preconditions, necessary context, a useful legal resolution and deadline. Other scenarios need not invoke Stage. The two isolated canaries explicitly exercise insufficient-context STILL_OPEN and clarified, grounded resolution without advancing A or changing Live authority.

Machine false predicates freeze numeric values/dimensions, forbidden established assertions and unsupported completion/referents. They inspect retained applicable proposals; a later correction cannot erase the first hard failure. Ambiguous entailment uses the unchanged scenario rubric. Human adjudication must identify the rule, original evidence and adjudicator in a new artifact, preserve the machine result and leave unresolved items pending. Throughput never averages away established false knowledge.

The old 300×80-character workload remains **Deterministic Runtime Stress** for scheduler, queue, persistence, versioning and DOM capacity. **Natural Semantic Load v1** is separate: 1,408 English words, 37 variable-length finals, 600 seconds, 20 semantic checkpoints plus negative/surface/timing expectations. It covers fragmentation, conditions, complete assertions, correction, topic shifts and returns, administration, unfinished thought, reference, comparison, Cue invitations and wider-context ambiguity. It uses no Fact:/Correct:/END. labels, fixed-width padding or duplicated volume filler. Natural scenarios do not force Stage calls merely to fill coverage.

#### Time boundaries and realtime accounting

Record `scheduled_at → evaluator_dispatch_at → page_received_at → admitted_at → capture/response/accepted → visible DOM`. The absolute driver runs independently of admission/model completion. Worker wake-up and actual transport dispatch are separate: evaluator congestion before dispatch counts as evaluator lateness. A full 600-second empty-receiver baseline requires dispatch lateness p95 ≤100 ms and maximum ≤500 ms. Page/admission delay remains product evidence, not an automatic INVALID.

Each checkpoint retains `ready_at_driver` and `ready_at_product`. Select the frozen valid sufficient set that completes earliest at driver dispatch; ties use declared order. Product readiness uses that same set's final admission. Retries, recapture, another set's faster admission or model outcomes cannot move the driver anchor. Capture readiness is diagnostic only. Cross-clock calibration records offsets and uncertainty; a hard threshold overlapped by uncertainty requires adjudication.

The same request/acceptance/version/DOM chain yields driver-ready→accepted, accepted→visible, and driver-ready→visible. B_live=8 s, B_stage=20 s and B_display=1 s are evaluation budgets, not runtime settings. Product provider=6 s, host=8 s, transport retries=2, SDK retries=0, coalescing=250 ms and wait=750 ms remain fixed. The 2.5 s median / 4 s p95 end-to-end figures are reported targets unless a frozen hard predicate explicitly references them.

After 30-second warmup, report each complete 60-second input window's ΔA/ΔR≥0.9 separately from due semantic completion and CARRY debt. H independently reports required surface completion: accounted ≠ understood ≠ displayed. All-NO_CHANGE/CARRY cannot pass through accounting alone. Tail checkpoints not yet due at input stop remain separate from overdue debt. A 35-second drain and one finalization are reported separately and cannot repair input-period scores.

#### Provenance, isolation and immutable evidence

`prepare` requires separate real checkout paths, a clean frozen product SHA and a clean evaluator SHA (the explicit development option is never paid-eligible). Node resolution/load records verify Git blob bytes for Session, projection, request builder, schema, acceptance/state and transitive product code. The browser runs the frozen product entry, real IndexedDB and display. Its actual loaded graph, optimizer source inputs, transforms and cache metadata are recorded. Caches start empty per run. Evaluator copies are forbidden even when byte-identical. Missing origin, wrong alias, path escape, blob mismatch, stale browser build or dependency drift prevents preflight passage. SDK/dependency identities and both lockfiles are retained.

Canaries follow scenario prefix + accepted precondition events → production capture/projection → production request builder. Requests are never hand-improved. Authored local responses are mechanical probes, not model gold. The cross-fragment NO_CHANGE probe is deliberately semantically negative: C/E pass while D must fail. T2/T3 retains the actual request, raw response, task, aliases, request-time and acceptance-time state, accepted events, trace and DOM for offline assessment without another model call.

Replay labels are explicit: response→parser/acceptance, durable events/timing→scheduler/recovery, and accepted events→production display. Display isolation seeds exact raw persisted events and runs the real display entry; it does not fix JSON, rewrite IDs or add meaning. It proves reload behavior. Original ephemeral attention/Cue context is retained in trace but is not fabricated on reload, so this mode does not claim original invitation timing. Event replay checks durable ordering/timing and Session recovery; it does not silently rebind historical response aliases to new tasks. Missing presentation/execution context limits the diagnostic claim.

Preflight strips credential environment entries without reading their values, never loads `.env`, and blocks non-local Node fetch/socket and browser model/microphone egress. Only versioned public tldraw renderer assets are allowed externally and hashed. Dependency mode is STUB for local browser model probes, RECORDED for replay, LIVE for future paid work. DOM fidelity checks accepted expressions, labels, units, conditions and versions, with geometry and renderer-layer evidence; retained screenshots support uncertain visual adjudication. DOM visibility is not hardware scanout.

The exclusive manifest is never rewritten. It records both checkout SHAs/paths and clean assertions; evaluator files and canonical script; local/production forwarders; prompts, schemas, input/oracle/canary hashes; SDK/dependencies; full model/scheduler/deadline/budget/phase profile; run ID and start time. Results are separate exclusive artifacts. Future provider collection must retain actual returned model, per-request input/output/cached-input usage and cache state. Latency reports label cache status. The historical profile used synchronous worst-case reservations for every Stage/retry attempt under US$10/400 requests. New shared execution profiles require explicit limits and current price evidence. Missing usage retains its reservation; published-rate estimates and conservative cost bounds are distinct.

Independent external account quota/outage or browser-environment failure may be INVALID. Product request explosion causing 429, or product DOM/memory/main-thread overload causing a crash, is FAIL. Unknown attribution stays pending. Controlled driver and page-blocking counterexamples verify this distinction. Passing 3b-0 permits a separate authorization request bound to the final manifest; it does not authorize OpenAI, Speechmatics or microphone use.


### Shared execution qualification contract

`cuelayer-v2-shared-execution-1` and `cuelayer-v2-shared-canary-profile-1` bind a fresh clean product SHA and evaluator SHA. The six logical canary IDs remain quantitative, cross-fragment-condition, correction-authority, unresolved-reference, stage-insufficient and stage-clarified; their newly captured request bytes and generation contract are explicit. Historical `1a796e8`/`2957c33` manifests, oracle identities and results retain their original meaning and require their recorded evaluator for historical execution.

The captured-request runner imports product execution, provider forwarding, parser, public validators and accepted/inspected event construction from the selected checkout. It restores the exact captured event prefix through public storage/fold, then invokes the shared execution boundary using an injected transport. No private Session hydration, global fetch replacement or alternate generic executor participates. Host state/oracle assessment stays independent of provider/parser success.

Offline qualification covers immutable request/approval bindings and synchronous budget limits; successful Live/Stage and inspected outcomes; 401 and 500 retry behavior; incomplete/missing-terminal streams; malformed JSON; model identity drift; parser success with host rejection; timeout before text and expiry during retry backoff; snapshot restoration outside the host deadline; slow diagnostic sinks; bounded raw recording and incompatible clock domains. Failure counters retain every started attempt and separate terminal completion, parser success and host acceptance. Timeout before output has an unavailable semantic score. The exact 6000ms provider / 8000ms host and two transport retries (20ms minimum, factor 2) remain unchanged.

CI runs the historical and shared suites against separate explicitly pinned product checkouts. `GATE3B_PRODUCT_ROOT` selects the historical checkout; `GATE3B_SHARED_PRODUCT_ROOT` selects the shared API checkout. An unpaid synthetic budget tests guard arithmetic only. New preparation defaults to null budget/prices and `paid_enabled: false`; execution requires caller-supplied current pricing and cost/attempt limits plus a new approval bound to all manifest hashes. Passing offline tests authorizes no provider call and establishes neither real model semantics nor realtime latency.
