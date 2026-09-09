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

The frozen v5 benchmark evaluates legacy semantic profiles (`alpha-core-p4-v7`, `alpha-augment-p4-v7`, `bounded-agent-p4-semantics-v7`). The current live PR15 runtime uses a later continuous/bounded profile and still implements the legacy Board-slot ontology.

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

Core evaluation does not import the production scheduler/store/runtime. Normal `/session` remains legacy, and its frozen evaluator/corpus remain unchanged. Generated outputs should be redirected only to ignored `.cuelayer/` or `artifacts/` locations.

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

Policy v7 / proposal v4 close the scheduler contradiction before live integration. There is no top-level `NEEDS_VERIFICATION`: an otherwise accepted `PROPOSE` carries `verificationRequests[]` as best-effort non-authoritative sidecars. Ordinary semantic steps continue to consume evidence; invalid sidecars cannot roll back otherwise valid semantic acceptance. `NEEDS_CONTEXT` remains the only top-level non-accepting result. Context remains v3 because its projection shape is unchanged. Durable `lesson-event-v5-core` remains replay-compatible because verification sidecars are not durable events/state and production Core cutover has not occurred.

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

## Teaching representation evaluation

The development-only `src/dev/teaching-representation/lesson.ts` is an authored
Catalyst sequence accepted through the unchanged Core reducer. It is separate from
the frozen semantic interpretation corpora. Its 14 checkpoints cover definition,
pathway, two-node chain, successful fraction, rate, qualitative energy profile,
PAIR, Arrhenius equation, fixed-A/temperature consequence, WIDEN, COMPARE, return,
tangent and explicit relation withdrawal. No cross-discipline holdout is included.

Run `npm exec vitest run src/dev/teaching-representation` for grounding, lifecycle,
attention, home preservation, negative plans and development-entry checks. Full
repository gates remain required. Browser review at 1280×720 should capture every
checkpoint in GOLD and the recorded AI mode, check actual text rectangles and
mounted identities, and inspect the diagnostic home map before/after choreography.
Check Play/Pause, Previous, Reset and diagnostic separation. Synthetic browser fit
does not establish classroom comprehension or milestone acceptance.

The producer maps PROPOSITION→TEXT, RELATION_CHAIN→DIAGRAM, EQUATION→MATH,
PLOT→PLOT and COMPARE→DIAGRAM using M4A's existing candidate/producer seam.
Payloads remain host input, keyed by candidate identity, outside Core and M4A.
Only selected candidates enter presentation history. A growing chain retains its
candidate identity; new plot/equation/comparison artifacts use separate identities.
Every historical payload is revalidated against current accepted state, including
PRESERVE and fallback. Invalid relations cannot remain visible. Arrow direction
requires accepted endpoints plus a reviewed causal relation meaning; other valid
relation wording gets a neutral connector. Plot/equation grammar is deliberately
limited to exact reviewed accepted statements in this fixture, with no numerical
plot data. Semantic interpretations or new grammar require separate review.

The host uses small authored presentation-aware home rows, immutable once placed,
and PR #27's unchanged measured baseline, temporary placement, motion planner and
relation router for WIDEN/COMPARE. Plot attachments are a separate discardable host
map, never durable semantic objects. This does not evaluate a new general allocator.

`compareAI` reports form matches/expected selected forms, grounding validity,
structured-output validity, unnecessary proposals, missed visual opportunities,
prose warnings, adjacent artifact stability, candidate churn, latency and fallback.
Rejected proposals receive zero form credit; displayed fallback matches are a
separate metric. Churn counts additions/removals in adjacent raw proposal sets;
normal topic changes and an empty tangent plan can therefore count as churn.
Unnecessary proposals are those outside the authored current target set; they are
a review signal, not proof of pedagogical harm. No-op retention can receive form
credit only with valid output and valid historical payloads. The prose warning
uses accepted relation structure as well as prose shape, never word count alone.

Compare original raw proposals without manual repair. Fallbacks are explicitly
marked and may preserve still-valid history or use exact accepted propositions;
they do not silently substitute GOLD's richer form choices. A model's arbitrary
HTML/SVG/CSS/coordinates/factual text is rejected by the strict plan schema.
Human review must judge useful form choice, visual timing, continuity, paragraph
reduction and whether any M4A insufficiency was actually demonstrated. Automatic
metrics cannot establish those product judgments.
