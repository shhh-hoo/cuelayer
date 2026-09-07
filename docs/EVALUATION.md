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

- Corpus: `resources/semantics/core/corpus.jsonl`; identity `core-interpretation-corpus-v1`. The adjacent manifest pins its hash and split counts.
- Evaluator: `server/teaching/core/semantic-evaluation.ts`; identity `core-interpretation-evaluator-v1`.
- CLI: `scripts/evaluate-core-semantics.ts`.
- Provider schema: `core-interpretation-proposal-v1`; policy: `alpha-core-interpretation-v3`.
- Context: `core-interpretation-context-v2`. Durable events remain `lesson-event-v5-core`.

Synthetic exemplars are authored independently for PR review. They are neither translated legacy gold nor outputs from a model run. Corpus validation checks strict case schemas, identity/hash, development/holdout presence, scenario coverage, reference selector resolution, actual Core normalization/acceptance, expected semantic predicates and deterministic replay. It does not establish that a model can produce those exemplars. Human review of corpus semantics remains part of PR review.

Keep three results separate:

1. Deterministic contract tests: malformed references, capabilities, temporal ordering, atomicity, historical provenance, conflict domains, no-op and non-accepting outcomes.
2. `npm run eval:core:validate`: offline corpus/exemplar validation, zero provider calls.
3. `npm run eval:core -- --assess PATH`: assess a saved JSON object mapping case IDs to arrays of raw provider responses. A separately authorized `--live --model MODEL` run uses the same Core path with the explicit model and `OPENAI_API_KEY`.

Each model turn sees only evidence committed through that turn. Examples are not sent to the provider. A response may contain multiple ordered steps; each step has ordered knowledge mutations and one Cue mutation. The offline adapter returns candidate events only after all response steps validate, without publishing intermediate candidates. This is not production persistence or a response-wide durable transaction.

The evaluator checks Core counts/identity, current mainline, independently matched object/relation/Support predicates, prohibited claims, Cue lifecycle, operation/step coverage, domain provenance and replay. Alias groups allow reviewed wording variants. Lexical predicates are limited semantic diagnostics, not proof of general entailment, correction intent or subject-matter truth; broader paraphrases and nuanced cases require review. There is no model performance threshold. Failed cases are individually reported; corpus validation and model performance are not interchangeable.

### Core projection and provenance configuration

`CORE_CONTEXT_BUDGETS` bounds serialized context to 32,000 JSON characters and 48 entities, with at most three candidate Parked Cores, 18 optional roots, six recent evidence checkpoints, four recent change records, eight unresolved phrases, four optional priors and eight explicit domain rules. Mandatory structural closure is admitted before optional context; a root and required endpoints/targets are included together or blocked/omitted. Automatic candidates require a positive discriminative lexical signal from a valid accepted proposition. Retrieval compares exact normalized tokens, retains numeric tokens regardless of length, and weights matches by inverse Core frequency. Vocabulary present in every historical candidate Core cannot alone establish relevance when there is more than one candidate. A single historical Core remains retrievable by a positive exact lexical match. This is a retrieval ranking mechanism, not a semantic Core-boundary classifier. Candidate Core identity, anchor, metadata and Core append/refocus capability are admitted atomically; budget failure rolls them back together. Zero-score candidates never fill unused quota. These are configurable implementation budgets, not semantic capacities or Core-boundary thresholds.

The provider envelope separately checks `ceil(JSON characters / 4) + 8,192 output reserve <= 24,000 estimated tokens`, including policy and structured schema. This character estimator is conservative configuration, not an exact tokenizer. Oversized mandatory input blocks without consumption or clipping. Request schema limits are eight steps, 24 knowledge operations per step, 16 references per field and 1,200 characters per generated fact. No corresponding capacity is imposed on durable Core state.

Projection declares Core-identity coverage, per-Core content completeness, authoritative empty knowledge, and absent/included/omitted Cue. Structural dependencies and explicitly required references default to reference-only. Complete valid objects, relations and Support intentionally admitted as semantic roots or candidate anchors receive `factual_basis`; explicit host `factualBasis` targets provide the same authority. Merely adding a dependency does not grant it factual authority. Core containers and Cues cannot receive factual-basis capability. `readRefs` still uses `reference`, while factual `provenance.state` requires `factual_basis` in addition to unchanged validity and Core-container rejection. Mutation authorization does not itself imply factual authority. Host-supplied `writable` targets explicitly authorize unit revise/invalidate/supersede or Cue revision; `required` only requests projection. The current Core receives append capability and remains current without refocusing. Refocus is granted only to successfully grounded Parked candidates, which also receive append capability; `readOnly` overrides grants. The offline corpus adapter intentionally authorizes its reviewed named reference selectors as mutation targets and, for eligible factual units, factual bases, independently of exemplar/provider operations; this is fixture target scope, not a production working-window heuristic. Corpus bytes and semantic expectations remain unchanged. A Core container is not a substitute for a proposition's provenance. Accepted facts can terminate provider-visible provenance closure; their historical lineage is resolved locally against recorded channel revisions, never current text under an old ID. Origin labels retain speech/state/domain distinctions. Historical ancestry is not serialized as dangling provider references. Bounded recent knowledge-change records carry action/target handles and supersession replacement handles into the projected accepted state, plus consumed sequences and an explicit completeness flag. Unprojected changes are omitted from those records and mark them incomplete; they cannot pull arbitrary historical Cores back into context. No summaries or second durable state are created.

Creation aliases are response-local, unique across steps, and mapped to M1 identities from lesson/request/step/kind/operation index. Same-step creations may be structural targets; only earlier accepted steps' creations can become accepted-state provenance. Current triggers and ordered consumption are distinct from factual attribution. Explicit `reads` guards cover channel-level dependencies including absence and no-ops; entity provenance/targets impose additional mechanical dependencies. Semantic completeness of declared reads remains a provider/evaluation responsibility.

`NEEDS_CONTEXT` accepts only supplied new-evidence handles and an exact evidence phrase as the retrieval query. It produces no event, no consumption, no semantic revision, and no automatic retry. Reconstruction/retry orchestration remains outside this offline module. Optional domain capabilities currently authorize exact supplied factual text with an explicit basis; they do not establish truth or permit autonomous contradiction, answer leakage, or learner-action initiation. No course is required.

Core evaluation does not import the production scheduler/store/runtime. Normal `/session` remains legacy, and its frozen evaluator/corpus remain unchanged. Generated outputs should be redirected only to ignored `.cuelayer/` or `artifacts/` locations.

```sh
npm run eval:semantics:validate
```

Paid provider evaluation is run only when explicitly authorized by the task and secure runtime configuration. Do not infer authorization from documentation examples or previous runs.

Evaluation output must remain outside tracked source. Repository validation must not create or modify tracked evaluation artifacts.

### Model-informed M2 evaluation discipline

The first authorized Luna run on `a9d0b7e` and the original 24-case corpus/hash are frozen baseline evidence. The next same-case run is regression evidence, not an unbiased holdout. No second run is implied by deterministic validation or by the commands below. Live runs still require separate user authorization.

The separate eight-case set in `resources/semantics/core/postfix-holdout.jsonl`, pinned by `postfix-holdout-manifest.json` as `core-interpretation-postfix-holdout-v1`, is now frozen, consumed holdout evidence. Do not edit it or run it live again. Preserve its recorded machine result exactly; human adjudication does not retrospectively rescore the artifact. Deterministic exemplar validation remains permitted and establishes fixture/contract consistency only. The explicit reviewed follow-up scope permits the general referent-resolution clarification below and future fixture-authoring guidance; it does not authorize rewriting these frozen fixtures or another model run.

```sh
npm run eval:core:validate -- --fresh-holdout
```

The default dataset remains the original 24 cases. `--fresh-holdout` explicitly selects the separate set; only deterministic exemplar validation of that frozen holdout is authorized here. Context semantics remain v2; policy v3 clarifies resolution of visible accepted factual referents; proposal schema, durable event schema, evaluator scoring and baseline corpus identities remain unchanged.

Live evaluation journals each raw provider response to a unique ignored `.cuelayer/evaluations/core-calls-*.jsonl` **before** incomplete-status, JSON/schema or semantic validation. Available response ID, request ID, actual model, usage, output content, start time and elapsed milliseconds are retained. Final case results retain the same diagnostic and any parsed proposal even on rejection. Transport errors retain timing/error metadata without invented output. These are evaluation artifacts, not production trace or durable state; request settings, reasoning, token limits and zero-retry behavior are unchanged. The first run's missing rejected raw proposal cannot be recovered retrospectively.

Policy v2 distinguishes an unfinished current phrase (normally accepted no-op, with recent evidence available for continuation) from required missing earlier context (NEEDS_CONTEXT). A distinct self-contained explanatory mainline can require a new Core without transition words; unresolved Cue does not force Core continuity. Exact boundary heuristics remain open. A visible current shell cannot identify omitted specific content, and staying current requires no refocus operation. Policy v3 additionally directs interpretation to use a complete visible `factual_basis` unit when the current reference actually resolves to it; prior-state origin is not itself missing context. Availability does not imply relevance. The policy identity changes because this clarifies the model's PROPOSE/NEEDS_CONTEXT decision; context projection, capability enforcement, evaluator scoring, proposal schema and durable schema are unchanged.

### Authoring semantic predicates

For future fixtures, use independent `all` groups for independently required semantic components when exact surface wording is not the behavior under test. For example, `[["pump"], ["pressure"], ["adequate", "sufficient"]]` accepts reviewed reordering and synonyms while requiring all three components in the same matching unit. Each inner group supplies explicit alternatives; every outer group is required. Avoid a single canonical full sentence for a compositional assertion, including in `currentContains` when that would inadvertently restore the same wording restriction.

Keep truth-critical relationships intact. Do not reduce negation, quantities, directional roles or conditions to an unordered bag of words. Author phrases/alternatives such as `does not open`, `ten litres`, `from inlet to outlet`, or `only when power is on` as appropriate, with `none` exclusions for known confusions and `forbidden` for prohibited content across accepted output. Pair each positive fixture with minimally altered negative examples. The existing lexical scorer cannot prove entailment or exhaustively detect every semantic inversion; explicit alternatives and human review remain necessary. No fuzzy matching, general LLM judge or universal semantic guarantee is introduced.

Test retrieval with predetermined separate accepted Cores when retrieval is the behavior under test. Do not make retrieval coverage depend on a model first choosing a debatable Core boundary. Deterministic numbered-history regression establishes candidate identity, numeric discrimination, append/refocus authority, current-Core non-refocus and identity reuse without imposing new Core-boundary semantics.

This is guidance and regression coverage for future authoring, not retroactive rescoring or modification of either frozen corpus or historical model result.

## Acceptance boundary

Offline evaluator passes establish only the behavior measured by that corpus and evaluator. They do not establish:

- real microphone / ASR fidelity;
- real browser/audio-to-DOM latency;
- learner attention quality;
- correctness of a newly introduced domain schema;
- long-lesson Canvas behavior;
- real-world lesson acceptance.

Real-lesson acceptance must use separately defined evidence and must not be inferred from synthetic or transcript-only passes.

## Migration rule

When the production Board domain migrates from legacy `SET_ACTIVE` / bounded `Retained` semantics to persistent Cores and local semantic operations:

1. preserve the frozen v5 corpus/evaluator as historical compatibility evidence if still useful;
2. introduce a new evaluation identity for the new semantic contract;
3. review new gold rather than mechanically translating old slot-based expectations;
4. keep renderer/layout evaluation separate from semantic interpretation evaluation where possible;
5. record run output outside tracked source.
