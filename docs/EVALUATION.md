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

Required checks include candidate availability without display; atomic rejection of malformed/ungrounded proposals; stable payload/candidate/artifact binding; selected-only visibility; revalidation on PRESERVE and historical reuse; local relation withdrawal without deleting surviving nodes; Math curve counts `0,1,1,2,2,3,3,2` under one plot identity; and isolation from Core/Cue mutation. Core/M4A contract bytes and frozen corpora remain unchanged.

Browser review uses both development stories at 1280×720. Walk every checkpoint, inspect PAIR/WIDEN/COMPARE and return, record visible artifact IDs/DOM instance continuity, measured bounds, clipping, curve/relation withdrawal and console output. In the separate diagnostics panel, use **Grow selected artifact** to increase actual rendered width and verify that only pressured neighboring spaces move. Check shared-projector drag/zoom through an accepted update and **Follow teaching**. Store screenshots, geometry, logs and review observations only under ignored `.cuelayer/` or `artifacts/`.

This gate establishes a bounded architecture seam, not generic semantic entailment, arbitrary graph layout, classroom comprehension, production/shared-surface cutover or AI representation autonomy. The finite Chemistry and Math meaning checks belong to capabilities, not Canvas. Pure domain-only grounding without a committed checkpoint is conservatively rejected by the current adapter to M4A's evidence requirement.

## Core shared-projector regression (M4C)

`src/session/core-projector.test.ts` drives the actual Core live scheduler/persistence with injected deterministic proposals, then checks production admission, metadata selection, canonical lifecycle, exact M4A execution, identity/session/binding isolation, target-anchored Space assignment, stale withdrawal and diagnostic failure isolation. It verifies that no speculative artifact appears while semantic persistence is held, replay matches the published state, and no legacy Board events participate. Existing architecture tests retain the finite-capability stale-part pruning regressions and frozen Core/M4A contract hashes.

`src/canvas-spatial/Canvas.test.tsx` mounts the production stage/surface with deterministic DOM measurements and ResizeObserver delivery. Coverage includes independent artifact size changes, exact 120px local displacement with an unchanged distant Space, observer deduplication, canonical DOM continuity, temporary composition/return, manual inspection with semantic revision and withdrawal, Follow teaching, measurement/pressure failure, renderer exception/empty mount recovery, diagnostic callback continuity, narrow composition and the automatic zoom floor. These tests establish DOM execution behavior, not physical display or classroom comprehension.

Browser acceptance uses `/dev/core-projector` at 1280×720 and 390×844 with reduced motion. Review accepted entry/revision, WIDEN/COMPARE and return, native artifact-internal resizing without changing accepted state or outer Canvas dimensions, teacher drag/wheel, revision and withdrawal during inspection, Follow teaching, mainline shift/refocus, clipping/overlap, node continuity, console output and network requests. The optional diagnostics disclosure supplies the measured homes, transient boxes, visible IDs and failure reasons. Store screenshots and logs in ignored `.cuelayer/reviews/`; do not commit generated evidence.

The actual production-bundle regression permits only the generic representation/Canvas modules and the reviewed `accepted.content` implementation. It excludes development entries, Chemistry/Math capabilities and graph-layout packages. The import-boundary regression now follows the normal domain-gated Core route to its controller and reviewed shared surface, excluding legacy semantic reducers and development/subject capabilities. The separate legacy branch remains available for historical restoration. Full validation includes typecheck, all tests, production build, both frozen exemplar validators, clean repository hygiene and diff checks. No historical model evaluations, provider or verifier calls are part of this gate.

## Normal production-route regression

The cutover suite uses the actual `/session` component, durable IndexedDB domain gate, Core live controller and HTTP seam. Synthetic committed canonical speech and injected local proposals are the primary evidence; authored accepted GOLD snapshots are not the production-route proof. The suite checks persist-before-publish through learner DOM, provider/output/storage failures, identity-preserving revision, representation failure/recovery, replay without evidence duplication, historical v3/v4 restoration, domain mismatch, finalization and no dual semantic writer. Production composition tests additionally isolate diagnostic/verification failure, competing acceptance and retryable incomplete finalization. Existing Core tests retain independent knowledge/Cue conflict, timeout and cancellation coverage.

`npm run report:bundle` measures the actual emitted production graph using built-in gzip/brotli compression. The production import regression follows static dependencies of each domain branch and the generated Core chunk, forbidding legacy semantic reducers, development fixtures, Chemistry/Math and graph-layout dependencies on the new Core route. Generated measurements belong in ignored review evidence.

Browser acceptance of `/session` covers desktop, narrow/reduced-motion, durable Core claim, synthetic speech ingress, delayed persistence, revision/identity, mainline shift/refocus, teacher inspection, representation failure/recovery, exact reload, semantic finalization and historical legacy replay. The Runbook defines reproduction and evidence storage. These deterministic checks establish integration correctness only. M6 classroom/model/microphone acceptance remains a separate HOLD gate; no frozen corpus or historical model result is changed or rerun.
