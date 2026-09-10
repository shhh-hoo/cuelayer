# CueLayer Incremental Semantics — Normative Runtime Appendix

Status: target design for `session-first-surface-design-v1`.

Authority: this document is a normative appendix to `docs/SYSTEM_CONTRACT.md`. It refines the Working Window, Live/Stage and realtime scheduling sections of that contract. It does not create a second product ontology or semantic truth store. Product direction remains owned by the human-maintained `CueLayer — North Star & Product Model` Google Doc.

Tracking issue: #44.

## 1. Problem and operative decision

CueLayer receives immutable provider-final speech evidence at boundaries chosen by the ASR provider. Those boundaries are evidence boundaries, not semantic boundaries. A provider final, dispatch batch, semantic-accounting boundary and Core boundary are distinct concepts.

Do not restore closed canonical speech spans as the semantic gate. Do not add a mandatory semantic-segmentation model in front of Live. Instead, maintain an incremental semantic frontier over immutable evidence: processing progress moves monotonically forward while accepted knowledge remains locally revisable when later evidence grounds correction.

```text
continuous teacher speech
        ↓
immutable COMMITTED evidence
        ↓
Session Working Window
        ↓
┌────────────────────────────────────────────┐
│ accounted processing prefix               │
│ OPEN TAIL → continuously reinterpreted     │
│ CARRY obligations → separately retained    │
└────────────────────────────────────────────┘
        ↓
      Live ────────────────→ acceptance → accepted Core/Cue → display
        │
        └──────── hints / obligations ───────→ Stage reconciliation
```

Critical invariant:

```text
OPEN TAIL != DURABLE UNRESOLVED / CARRY OBLIGATION
```

An unfinished recent suffix normally remains open. Durable unresolved state is reserved for grounded material that cannot currently be resolved but must not continue to block later independent teaching.

## 2. Frontiers and recoverable state

The session maintains these logical positions. Exact field names are implementation details.

| Position/state | Meaning | Durability |
| --- | --- | --- |
| recorded evidence frontier | greatest contiguous provider-final evidence durably admitted | authoritative |
| observed semantic frontier | greatest source position inspected by the current/latest Live task | task-local / diagnostic unless needed for recovery bookkeeping |
| accounted processing frontier | greatest contiguous source position with durable terminal Live handling | authoritative |
| open semantic tail | committed source after the accounted frontier that remains intentionally unaccounted | derived from durable evidence + processing records |
| CARRY obligations | grounded unresolved source ranges intentionally preserved behind the accounted frontier | authoritative operational state |
| accepted semantic state | current Core/Cue knowledge reconstructed from accepted events | authoritative |
| Stage review coverage | which accounted material/obligations have received the required reconciliation review | authoritative where required for recovery/finalization |

Monotonicity applies to evidence admission and processing accountability. It does **not** mean accepted semantic content is immutable: later grounded correction can revise/supersede accepted units through normal acceptance.

The Working Window is a recoverable projection, not a second truth store. Provider memory, task-local summaries, queue state, semantic compression and trace remain disposable unless an exact processing obligation must survive recovery.

## 3. Source ranges, not provider-message semantics

The semantic processing boundary may fall inside one provider final. Immutable evidence records must not be rewritten or split into new authoritative evidence merely for model convenience.

The host should expose stable source-range handles over committed evidence, sufficient to address:

- full evidence records;
- contiguous subranges within an evidence record when necessary;
- ranges spanning multiple evidence records;
- quote verification against immutable text;
- historical context ranges that are readable but not consumable.

The model may use compact aliases for these handles. Host code maps aliases back to exact evidence/range provenance before acceptance.

Text similarity is never evidence identity. Repeated wording with distinct provider evidence remains distinct.

## 4. Live semantics

Live is the authoritative realtime interpretation lane. It makes the smallest safe useful semantic progress available from the current rolling window. It is not required to finish the entire discourse or dispose every source range it observes.

Live requires four processing semantics. Exact enum/wire names may differ.

| Outcome | Meaning | Processing effect |
| --- | --- | --- |
| APPLY | current source grounds a semantic or Cue mutation | accept mutation and advance accountability over the covered range |
| NO_CHANGE | source is understood and deliberately produces no semantic mutation | advance accountability without fabricating learner-visible change |
| WAIT | recent suffix is probably incomplete or requires immediately forthcoming speech | leave the suffix open; do not advance accountability over it |
| CARRY | grounded material remains unresolved/unfinished but should no longer head-of-line block later independent material | persist one addressable obligation over the exact source range and advance accountability over that range |

### 4.1 WAIT versus CARRY

WAIT is for an open recent tail expected to become interpretable with nearby future input. It must not create durable per-token unresolved records.

CARRY is for a bounded unresolved semantic obligation whose source is known but whose interpretation/reference/condition cannot currently be completed, or for an interrupted unfinished thought that must be moved behind the processing frontier so subsequent independent material can proceed.

Examples:

- `Activation energy is the minimum energy...` → normally WAIT while the continuation is still the active tail.
- later `...required for successful collisions.` → interpret the combined source and APPLY the complete proposition.
- `This value is larger than the previous one.` with unresolved referents → CARRY one grounded reference obligation, not one obligation per provider fragment.
- an unfinished statement followed by a clear topic change → the unfinished statement may become one CARRY obligation so the later topic can proceed.

CARRY is not synonymous with “send to Stage now”. A later Live task may resolve it when new local evidence arrives. Stage is used when wider context/reconciliation is actually useful.

### 4.2 Inspect farther than commit

A Live task may inspect committed source beyond the point it can safely account.

Conceptually:

```text
observed through: S118
accounted through: S114
open tail: S115..S118
```

The acceptance layer advances only a valid contiguous accounted prefix, plus explicit CARRY obligations intentionally moved behind that prefix. The unaccounted suffix remains available for the next rolling interpretation.

A model must never be forced to mark every provider-final item in its input `unresolved` merely to satisfy coverage.

## 5. Rolling Live context

A Live task receives a bounded rolling projection, not a raw fixed-size batch and not a complete session dump. The projection should include only what is needed for the current frontier:

- oldest unaccounted committed source and current open tail;
- bounded immediately preceding speech needed for grammatical/discourse continuity;
- nearby accepted semantic state and current Core;
- recent accepted changes where relevant;
- CARRY obligations likely to become resolvable now;
- explicit source-role metadata: `historical/accounted`, `open`, `obligation-context`, or equivalent;
- explicit completeness/omission metadata for bounded accepted-state/history projections;
- compact stable semantic/source aliases generated by the host.

Historical/accounted evidence may ground interpretation but cannot be consumed again.

Context budgeting may shorten the inspected horizon. It must not silently redefine omitted context as absent or allow the model to infer completeness when the host supplied only a projection.

## 6. Scheduling: wakeup is not semantic commitment

Scheduling answers **when to inspect**. Live interpretation answers **how far to account**. Never conflate them.

Useful wake signals include:

- newly committed evidence;
- a short coalescing/quiet interval;
- provider sentence/segment/end-of-utterance hints;
- oldest open-source age approaching the latency budget;
- open-tail/context size pressure;
- deterministic hints for explicit correction, definition, equation or other high-value local structure;
- Live becoming idle after a running task;
- capture close/finalization.

Provider or timer boundaries are hints only. They cannot force semantic consumption.

While Live runs, new evidence continues to be durably admitted. Do not enqueue one irrevocable model request per provider final. When the Live slot becomes available, capture a fresh rolling window beginning at the oldest unaccounted frontier and extending forward within the current context budget.

Coalescing and maximum-wait values are empirical configuration. They are not semantic constants and do not define a sentence/turn boundary.

### 6.1 No-progress suppression

A WAIT result on snapshot `X` must not immediately dispatch the same semantic task again merely because a timer fires. The session records enough disposable wake-state to suppress identical no-progress re-execution.

A WAITing tail becomes eligible again only after a material wake reason such as:

- new committed speech;
- relevant accepted-state/CARRY resolution change;
- newly admitted context required by the prior result;
- explicit capture close/finalization;
- another versioned runtime event that changes the interpretation basis.

This prevents hot loops on unfinished phrases and protects provider capacity for actual new information.

## 7. Multi-lane inference

CueLayer uses different inference timescales, not a serial small→medium→large model pipeline.

```text
                     ┌─ speculative Live preparation (optional)
committed Window ────┼─ Live: fast local authoritative progress
                     └─ Stage: slower asynchronous reconciliation
```

All authoritative mutations converge through one acceptance/event authority.

### 7.1 Live

Purpose: timely local semantic progress.

Properties:

- small bounded rolling context;
- low-latency independently configurable model/reasoning/output profile;
- compact strict structured response where provider support allows;
- local Core/Cue creation/revision when grounded;
- WAIT/CARRY support;
- optional hint that broader Stage review would be useful.

Live is the primary path. Stage and speculative preparation are never mandatory approvers of ordinary Live progress.

### 7.2 Stage

Purpose: wider reconciliation of already recorded/accounted teaching.

Stage may inspect:

- wider immutable evidence history;
- accepted semantic structure;
- recent Live changes;
- CARRY obligations;
- mainline/Core continuity context;
- explicit review requirements.

Stage may resolve cross-fragment references, reconcile structural relationships, refine continuity/mainline interpretation, or make other dependency-safe local revisions supported by its captured scope.

Stage must not:

- consume Live-accounted evidence again;
- block new Live processing;
- act as a routine approver of Live;
- create provider evidence;
- overwrite newer semantic dependencies;
- replay stale attention merely because historical reconciliation returned late.

Stage requires a reconciliation-specific model/result contract. A Stage result may say an existing obligation remains open **without** producing a Live evidence disposition or creating a duplicate unresolved obligation. Reconciliation status and Live evidence accountability are separate concepts.

### 7.3 PREFLIGHT / speculative Live

PREFLIGHT is an optional latency optimization, not a third semantic authority and not required for the first committed-only implementation.

Stable partial/preflight speech may prepare:

- likely Live semantic work;
- reference/context retrieval;
- candidate representation preparation;
- an otherwise equivalent Live inference result.

Preflight work cannot consume committed evidence, advance the accounted frontier or mutate Core/Cue.

A prepared result may be reused only when later committed source identity/content and all captured semantic dependencies match the preparation assumptions. Otherwise it is cancelled/discarded. Measure reuse and discard rates before enabling by default for long teacher speech.

## 8. Model protocol and host ownership

Keep model-facing protocol proportional to the semantic decision. The model should not be required to echo host-owned implementation data such as full UUID-heavy task identities, timestamps, complete dependency maps or durable event envelopes.

The host owns:

- durable evidence/event identities;
- task identity;
- source aliases and alias→range mapping;
- timestamps;
- dependency/read-scope capture;
- allowed write scope;
- version/capability checks;
- persistence/event envelopes;
- exact processing watermark advancement.

The model supplies only necessary meaning-bearing values, referenced compact handles, processing decisions/boundaries, uncertainty that changes handling, and optional attention/review intent.

Live and Stage may use different model providers, models, reasoning settings, context budgets, output budgets and service tiers. These are versioned runtime configuration and evaluation variables, not product semantics.

Strict structured output is a wire-integrity mechanism. It does not establish entailment, factual authority or pedagogical value.

## 9. Acceptance invariants

One semantic acceptance authority validates all authoritative Live and Stage changes before persistence/publication.

It owns at minimum:

- committed provenance and exact source/range grounding;
- reference/capability/write-scope validity;
- host-captured dependency/version checks;
- legal semantic operations;
- monotonic Live processing accountability;
- WAIT leaving the suffix unaccounted;
- CARRY obligation creation without per-fragment duplication;
- explicit obligation resolution/reconciliation;
- stale result rejection;
- atomic persistence before publication;
- independent attention freshness.

A historical semantic refinement can remain valid even when its original attention is obsolete. Acceptance may commit the semantic portion while discarding stale attention when the captured semantic dependencies remain valid.

## 10. Correction and semantic revision

Processing an evidence range once does not freeze the knowledge it originally influenced. Later teacher evidence may revise/supersede a stable semantic identity through ordinary grounded correction.

Example:

```text
The reaction is exothermic — sorry, endothermic.
```

The system should converge on one corrected proposition rather than preserve two unrelated facts. If the first fact was already learner-visible, evaluation must record the correction/revision burden rather than pretending the early display never occurred.

Do not delay every complete local proposition merely because a future correction is theoretically possible; correctness is achieved through attributable revision, not by waiting for the end of the teacher's turn.

## 11. Provider segmentation boundary

ASR provider capabilities should be reused for speech stability and latency when they are empirically useful. Provider sentence/segment/end-of-utterance signals and `ForceEndOfUtterance`-style controls may be used as scheduling/latency hints.

They are not semantic authority:

```text
provider final != semantic unit
sentence != Core
end of utterance != teacher turn != semantic commit
```

Teacher speech can continue for minutes while multiple useful semantic updates emerge.

The first release gate for this appendix uses committed evidence only. Provider boundary optimization and PREFLIGHT speculation follow after committed-only semantics is correct and sustainable.

## 12. Recovery and finalization

On reload, reconstruct from authoritative evidence/events and durable processing/CARRY records:

- the recorded evidence frontier;
- the accounted processing frontier;
- the open tail;
- accepted Core/Cue state;
- unresolved/CARRY obligations;
- required Stage review coverage.

Do not restore in-memory queue state, provider conversation memory or trace as authority. Running tasks lost at crash are recaptured against current durable state with stable idempotency/dependency rules.

Capture close first records the committed speech tail. Live then drains or explicitly CARRY-accounts every remaining committed source range. A still-open recent tail may become CARRY during close rather than leaving an unended session forever. Stage is not on the capture-close critical path; outstanding reconciliation is persisted as incomplete according to the System Contract and cannot implicitly mutate a sealed lesson later.

## 13. Required adversarial behaviors

Implementation and evaluation must cover at least:

1. incomplete definition followed by continuation;
2. complete local proposition followed by unfinished conjunction/contrast;
3. genuine unresolved pronoun/reference;
4. explicit self-correction;
5. several seconds of fluent speech without useful punctuation or floor yield;
6. repeated text with distinct evidence identities;
7. new speech arriving during slow Live inference;
8. late Stage result with valid historical semantics but stale attention;
9. interrupted unfinished thought followed by independent later material;
10. equivalent source content under different provider-final fragmentation, including word-like, phrase-like, sentence-like and sentence-plus-tail boundaries;
11. WAIT snapshot replay suppression;
12. CARRY burden that remains visible even when the raw pending count is low.

Ordinary grammatical fragments/function words such as `to`, `the`, `your` or `last` must not become independent durable unresolved obligations solely because ASR or dispatch boundaries split there.

## 14. Evaluation contract additions

Measure semantic progress and semantic quality together with latency.

Required stage timings include:

```text
audio observed
→ provider partial/preflight (when available)
→ provider committed final
→ durable evidence admission
→ Live wake/capture
→ inference start
→ first useful model output
→ proposal complete
→ processing frontier advanced / WAIT / CARRY
→ semantic acceptance
→ representation selection
→ learner-visible DOM
```

Track at least:

- provider final latency;
- final→durable admission;
- open-tail age;
- accounted-frontier lag behind recorded evidence;
- Live queue/policy wait;
- Live model first-output and completion latency;
- source duration/characters/tokens inspected per Live call;
- source amount accounted per Live call;
- Live calls per minute;
- useful semantic progress per Live call;
- WAIT rate and repeated-identical-WAIT count;
- CARRY count, source span/age and eventual resolution rate;
- semantic correction/revision rate and learner-visible premature-update rate;
- Stage call frequency, latency and useful reconciliation rate;
- stale Stage semantic/attention outcomes;
- speculative reuse/discard/cost rate when PREFLIGHT is enabled;
- representation and learner-visible latency only for genuine useful display changes.

A low pending count is insufficient: a runtime that converts most speech to CARRY has not demonstrated realtime understanding.

### 14.1 Fragmentation invariance

For reviewed source scenarios, run equivalent content under materially different provider-final fragmentation. Accepted meaning, required qualifiers, semantic identity continuity and provenance coverage should converge to the same reviewed result subject to explicitly permitted timing differences.

This is a primary regression against provider-boundary overfitting.

### 14.2 Sustained teaching

Sustained workload acceptance requires all of the following:

- recorded evidence continues to advance while inference runs;
- accounted-frontier lag does not grow without bound under supported workload;
- CARRY burden does not grow without bound or get hidden behind a low pending count;
- important review fixtures produce expected semantic progress;
- Stage cannot starve Live;
- no evidence is dropped, reordered or reconsumed;
- no stale attention reappears after teaching has moved on.

Synthetic service-time tests prove scheduler mechanics only. Real provider/model dogfood remains separately required.

## 15. Implementation order

1. Make this appendix and the corresponding System/Evaluation/Trace clauses authoritative.
2. Implement committed-only Live WAIT/CARRY and partial-prefix accounting with source-range grounding.
3. Separate Stage reconciliation wire/validation semantics from Live evidence dispositions.
4. Add fragmentation-equivalence, interrupted-tail, no-progress and sustained-load deterministic tests.
5. Run real Speechmatics + configured Live/Stage model dogfood, including the failure pattern that motivated issue #44.
6. Tune rolling-context/coalescing/max-wait/model profiles from measurements.
7. Only then evaluate provider segmentation/force-finalization and PREFLIGHT speculative execution.

## 16. Non-goals

Do not solve this mechanism by:

- restoring canonical-span closure as the only semantic scheduling gate;
- increasing raw provider-final batch size without changing semantics;
- adding a mandatory serial boundary-classifier LLM;
- creating one LLM request per provider final;
- treating unfinished syntax as one durable unresolved record per fragment;
- making Stage approve ordinary Live work;
- dropping durable evidence to keep latency metrics low;
- treating provider sentence/EOU boundaries as semantic truth;
- persisting model summaries as a second lesson authority.

The intended system is an incremental, recoverable semantic runtime: immutable evidence arrives continuously; Live advances the smallest safe processing frontier; unfinished recent meaning stays open; genuine deferred meaning remains addressable; Stage reconciles wider structure asynchronously; accepted teaching semantics remain the single basis for representation and learner-visible state.