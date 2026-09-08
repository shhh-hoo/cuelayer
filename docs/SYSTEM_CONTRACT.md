# CueLayer System Contract

## Authority

This document is the executable repository authority for CueLayer. Product direction, learner-experience decisions, and long-horizon product ontology are maintained outside this repository. This file translates the current product model into implementation constraints that code, schemas, reducers, validators, provider contracts, tests, and renderers must intentionally converge on.

Git history, pull-request descriptions, benchmark reports, spike notes, and implementation comments are evidence or implementation context. They do not define product semantics.

The current branch still contains legacy Board-slot implementation in parts of the runtime. Those legacy shapes remain replay/compatibility facts until deliberately migrated; they are not the target product ontology. Do not extend them merely because they already exist.

## Execution model

CueLayer preserves a durable authority chain:

```text
immutable lesson evidence
        ↓
append-only accepted lesson events
        ↓
deterministic lesson knowledge state
        ↓
attention / spatial projection
        ↓
learner surface
```

AI decision-making has three logically separate responsibilities:

```text
Semantic Interpreter
→ what is happening and what might be useful?

Intervention Governor
→ does this useful candidate deserve learner attention now?

Evidence Verifier (conditional side path)
→ is there enough independently checkable evidence to elevate an AI claim into learner-visible truth?
```

These are logical roles, not a requirement for three serial model calls. The common learner-visible path must not wait on auxiliary intelligence by default. Evidence verification is conditional and may resolve later into a marked correction or clarification without blocking ordinary teaching updates.

Separately, diagnostic trace records execution evidence but never drives domain state.

The system must preserve these boundaries:

- lesson evidence records what the teacher actually said and what the speech pipeline committed;
- semantic interpretation proposes meaning-bearing knowledge/intervention changes;
- accepted domain events record what CueLayer accepted as lesson-state change;
- deterministic reduction reconstructs durable lesson knowledge without provider calls;
- attention/intervention policy decides what deserves learner attention now;
- rendering realizes the selected projection;
- trace explains execution but is never replay authority.

## Durable lesson knowledge

The target Board domain is a conceptually unbounded Canvas of persistent Cores. A Core is a coherent teaching mainline that may grow and be revised across multiple teaching turns.

The durable model must support the functional equivalents of:

```text
TeachingState
├── knowledge
│   ├── revision
│   ├── cores[]
│   │   ├── semantic objects / propositions
│   │   ├── semantic relations
│   │   └── supports[]
│   └── currentCoreId
└── cue
    ├── revision
    └── active?
```

Exact type names and wire shapes are implementation details. The following semantics are not optional:

1. A Core is not a card, paragraph, slide, or replacement `Active` contribution.
2. Definitions and other truth-critical structure belong to the Core rather than Support merely because they are visually secondary.
3. Support is extra around a Core: examples, applications, annotations, illustrative cases, side explanations, and additional non-essential detail.
4. Accepted Support remains part of semantic lesson history unless a later semantically justified correction, invalidation, or supersession changes it. Visual eviction alone cannot delete it.
5. Topic shift changes the current teaching mainline; it does not erase the previous Core.
6. A non-current established Core is a Parked Core by role relative to `currentCoreId`. A separate persisted `parked` flag is not required.
7. Returning to an earlier mainline must be able to continue the existing Core rather than creating a duplicate Core.
8. Semantic knowledge must not have a fixed product-level capacity merely because the viewport is finite.
9. Every independently mutable or referenceable semantic entity must have stable lesson-scoped identity that survives content revision. Text content, array position, renderer-local IDs, coordinates, and screen position are not semantic identity.
10. Knowledge and Teaching Cue remain independent revision and conflict domains; a knowledge-only change must not create an unrelated Cue conflict, and vice versa.

## Semantic change contract

Interpretation describes the smallest meaningful lesson-knowledge change, not which UI slot should be replaced.

The implementation must support functional equivalents of:

- creating a Core when a genuinely new mainline forms;
- refocusing an existing Core when teaching returns to it;
- adding or revising semantic objects or propositions;
- adding or revising semantic relations;
- attaching or revising Support;
- changing the current Core identity;
- superseding or invalidating knowledge when a teacher correction or an authorized evidence-backed AI correction requires it.

One accepted interpretation step may contain zero or more ordered knowledge mutations together with its Cue mutation. The step must validate against one accepted base state and publish atomically; renderer-visible authority must not pass through partially applied intermediate semantic states. A valid accepted no-op may consume evidence without changing knowledge or Cue when nothing useful changed.

A provider response may contain multiple ordered semantic steps. Request batching does not determine semantic-step identity; each step validates atomically against its own accepted base.

Exact event names such as `UPDATE`, `SUPERSEDE`, or `INVALIDATE` are repository-level design choices. Historical auditability must not be confused with destructive deletion.

Explicit teacher self-correction may revise the affected semantic unit with normal speech-grounded provenance. Autonomous AI correction is different: model confidence may trigger verification but is not factual authority. A settled AI correction requires a trusted or independently checkable evidence basis, must be materially useful and contextually relevant/timely, must preserve productive learner work, and must remain explicitly attributable and reversible. Ambiguous, disputed, opinion-based, uncertain, scoped-approximation, or assumption-dependent claims must not be silently corrected.

When a factual conflict is plausible but evidence is insufficient, the system must preserve contestability rather than force an overwrite. A best-effort verification side request may accompany an otherwise accepted semantic interpretation, or an explicitly marked learner-facing question/challenge/clarification may be used while later teaching resolves the disagreement. A verification side request is orchestration/diagnostic data only: it is not lesson truth, semantic state, or an accepted lesson event, and it must not block or roll back otherwise valid semantic acceptance.

## Semantic Working Window

Context Window and Semantic Working Window are separate mechanisms.

The Context Window controls how much evidence and state a provider request receives. The Semantic Working Window answers whether recent teaching:

- continues the current Core;
- revises the current Core;
- refocuses and continues an existing Core; or
- forms a genuinely new Core.

The semantic decision may use recent committed evidence, current Core structure, nearby accepted semantic changes, unresolved references, and optional structural priors such as lesson outline, teacher plan, syllabus concept map, or course structure.

Structural priors are optional. CueLayer must remain usable from teaching evidence alone and must not be hard-coupled to one course or syllabus.

Syllabus is a soft pedagogical boundary for augmentation, not a factual whitelist. Low-risk common knowledge that is directly useful, compatible with the teaching scope, and low in cognitive cost may extend slightly beyond syllabus wording. Advanced, niche, tangential, or higher-risk knowledge normally requires stronger trusted grounding and higher intervention value.

## Context projection

Provider context remains bounded even though lesson knowledge is conceptually unbounded.

The complete authoritative lesson state is not required to fit into or be serialized wholesale into a provider request. The request receives a bounded interpretation projection of the historical evidence and durable state needed to interpret the new evidence safely. Omission from that projection does not delete lesson knowledge or imply that historical content no longer exists.

Provider operations may reference existing semantic entities only when those identities are included in the request's writable/referenceable projection, plus entities created within the current proposal. Context-budget pressure must never be solved by deleting accepted lesson knowledge or reverting to fixed semantic capacities.

Projection must distinguish complete scopes from partial scopes: a projected Core identity does not imply that all its contents were supplied. Omission cannot establish authoritative absence. A request for missing context is non-accepting and consumes no evidence or semantic revision.

Current production budgets, retry rules, batching, compact-reference codecs, and provider envelopes are implementation configuration and must remain explicit in code/tests. Changing those values requires scoped review; do not use semantic deletion or renderer eviction as a context-budget shortcut.

## Provenance and grounding

Canonical speech checkpoints and grounding remain immutable replayable evidence.

Provenance must be attributable to the semantic fact or relationship it supports at sufficient granularity for local correction, replay, and audit. The product does not require one fixed field shape such as `node.provenance`; provenance may attach to a semantic object, proposition, relation, Support item, property, correction, or another sufficiently precise unit.

A later deterministic system or reviewer must be able to identify why accepted lesson knowledge exists and whether its basis is speech evidence, prior accepted state, permitted/trusted domain knowledge, an evidence-backed autonomous AI correction, or an allowed combination.

Claimed speech evidence must resolve to immutable committed lesson evidence. Do not manufacture speech provenance for domain/state-derived content or for AI-corrected factual content that the teacher did not actually say.

A settled autonomous AI correction must use explicit correction provenance distinct from speech attribution. It must identify the current immutable teacher evidence being challenged, the independently checkable/trusted evidence basis that authorized the corrected proposition, and a concise rationale. The trigger shows what was corrected; it is not false factual support for the corrected proposition. Model self-confidence is not a provenance basis. Correction provenance must remain replayable and auditable so later teacher correction, AI revision, or review can reverse or supersede it without losing the original speech evidence.

Learner-action origin is separate from factual provenance. A Cue may be teacher-established or AI-initiated; the origin records who initiated the pedagogical action, while the Cue's factual/content provenance records what knowledge/evidence grounds its wording.

## Alpha authority

Alpha may:

- interpret natural teaching into semantic structure;
- reconstruct damaged speech expressions when intended teaching meaning is sufficiently grounded;
- reorganize or represent established propositions without changing their meaning;
- use trusted domain knowledge for useful Board augmentation with honest provenance;
- autonomously add low-risk common/syllabus-compatible knowledge when the reviewed provenance path can represent its authority honestly;
- detect possible factual conflicts and emit best-effort verification side requests while ordinary semantic steps continue to consume evidence; the side request itself does not consume, revise, or establish lesson truth;
- autonomously correct concrete factual teacher errors when the correction meets the evidence-backed correction gate and is honestly attributed;
- maintain and locally revise Core structure across teaching turns;
- infer same-Core continuity versus topic shift from evidence and state;
- autonomously initiate NOTE, QUESTION, TASK or HINT when relevant, well-timed, pedagogically useful, and protective of productive learner work;
- remain quiet when no change or intervention is useful.

Alpha must not:

- convert unsupported model belief or self-reported confidence into learner-visible truth;
- silently correct ambiguous, disputed, opinion-based, uncertain, scoped-approximation, or assumption-dependent teacher claims without sufficient evidence;
- falsely attribute an AI-initiated intervention to teacher speech;
- originate weakly relevant, poorly timed, low-value or answer-leaking learner interventions merely to increase interaction;
- disclose complete answers that destroy unresolved productive learner work;
- use hidden syllabus assumptions as if they were teacher evidence;
- require teacher approval or micromanagement for ordinary learner-surface updates.

Teacher speech is the primary classroom signal and immutable evidence of what was said, but not an infallible learner-visible truth boundary. AI controls the learner-facing surface by default; ordinary interventions do not require teacher approval. That autonomy remains contestable: later teaching may clarify, reject, revise, or supersede the AI's interpretation.

Current M2 code is deliberately narrower than the full product authority where no honest provenance mechanism exists yet. In particular, free-form model belief is not accepted as a common-knowledge factual basis, and settled AI correction currently requires a host-verified trusted rule/evidence handle. Do not weaken provenance to simulate product completeness; add reviewed authority seams before production cutover.

## Teaching Cue

Board and Teaching Cue are sibling channels with independent lifecycle, revision, and conflict domains.

Board answers what knowledge the teaching is building. Teaching Cue answers what the learner should do, think about, compare, answer, notice, or remember now.

Teaching Cue may be teacher-established or autonomously initiated by CueLayer. AI initiation does not require teacher speech to establish the learner action. It does require a current contextual trigger plus a relevance/timing/pedagogical-value/productive-work gate. The trigger is not a false claim that the teacher requested the action.

Board change must not automatically resolve Cue. Cue resolution must not clear Board knowledge.

Cue targeting may reference a Core, semantic object, relation, comparison, or lesson-level action once the Core-domain reference contract is introduced. Core-domain Cue targets must not depend on legacy `BOARD_ITEM` identity after cutover. Exact target types belong in the implementation contract when introduced.

A correction does not automatically create a Cue. Conversely, an evidence-insufficient factual disagreement may independently justify an AI-origin QUESTION/HINT when that is the pedagogically appropriate way to preserve dialogue rather than overwrite truth.

## Attention and intervention

Durable semantic state and learner attention are separate. A candidate can be semantically useful without deserving immediate display.

Alpha does not require persistent `Active`, `Retained`, or `focusId` semantic state merely to tell the renderer what to emphasize. Attention should normally be derived from:

```text
current Core
+ recent accepted semantic changes
+ minimum necessary semantic dependencies
+ relevant current Support
+ current Teaching Cue
+ viewport / presentation mode
+ learner inspection state
```

The Intervention Governor additionally considers teaching phase and natural boundaries, pacing, semantic density, current Cue, recent intervention history/cooldown, learner inspection, presentation mode, intervention urgency, expected pedagogical value, productive-struggle risk, and interruption cost. Its conceptual decisions are `SHOW_NOW | DEFER | MERGE | DROP | QUIET`.

The Governor should combine deterministic budgets/hard suppression rules with model judgment only where timing is genuinely ambiguous. Interaction count is not a product success metric. Calibration should start conservatively and be tuned from real lesson traces rather than a universal interventions-per-minute rule.

Previously established knowledge may remain visible because current understanding depends on it. That is dynamic necessary context, not a `RETAINED` semantic status.

Parked Cores remain spatially revisitable but default to low or zero attention and may be outside the current viewport. Exact coordinates, measurements, drag state, zoom, viewport, and inspection state belong to Canvas/UI state rather than lesson knowledge.

The renderer may virtualize old Cores or Support. Virtualization must not delete semantic history.

Renderer vocabulary such as text emphasis, relation layouts, arrows, equations, transforms, grouping, or compact notation is presentation vocabulary, not semantic ontology.

## Latency boundary

Auxiliary intelligence must not sit serially on the common learner-visible critical path unless measured evidence shows that its added pedagogical value justifies the latency.

Default direction:

```text
common path:
teaching evidence
→ Semantic Interpreter
→ deterministic acceptance / attention budget
→ learner surface

conditional side path:
possible factual conflict
→ Evidence Verifier
→ later marked correction or clarification
```

A future model-based Governor may be added only if real evidence shows that its timing quality exceeds its latency and complexity cost. Verification latency may be slower than ordinary teaching latency; it must not stall unrelated Core/Cue updates.

## Presentation modes

Presentation transport remains independent from semantic interpretation.

When a presentation is present, it may remain the primary visual background while CueLayer provides semantic augmentation. When no presentation is present, the Board may itself be the primary presentation surface. An always-on ordinary transcript is not the default learner surface.

Canonical transcript remains available where needed for grounding, debugging, accessibility, or an explicitly selected product mode.

## Persistence and replay

Accepted lesson events must be persisted before speculative state becomes learner-visible authority. Reload reconstructs durable lesson knowledge deterministically from replayable events without calling the provider.

Legacy event versions required for replay compatibility remain supported deliberately until a reviewed migration or retirement removes them. A legacy Board-domain session must replay through its legacy schema/reducer generation; it must not be silently translated into Core semantics during normal replay. A Core-domain session uses its own versioned event/state generation. Do not mix accepted legacy Board-domain and Core-domain semantic events within one lesson session.

At runtime, exactly one lesson-domain model is authoritative for a session. Temporary one-way projections/adapters from that authority are allowed for compatibility; dual-writing the same new evidence into legacy Board state and Core state as competing semantic truths is not.

The next Board-domain migration must introduce a versioned event/state contract rather than reusing legacy `SET_ACTIVE` / bounded `Retained` semantics under new names.

## Scheduling and failure recovery

The scheduler must preserve ordered unprocessed evidence. Provider, semantic validation, storage, timeout, cancellation, stale-result, and conflict failures on the common semantic path must not silently consume evidence or erase accepted learner state.

A transient semantic-path failure preserves the last accepted Board and Cue surface until a later valid change is accepted. Independent failure domains should degrade independently wherever technically possible. Verification/Governor side-path failures must not roll back already accepted semantic state, re-open already consumed evidence, or block unrelated subsequent checkpoints. A verification side request is not an accepted lesson event or learner truth; only a later independently verified correction may change durable state.

Exact queue bounds, retry counts, deadlines, context budgets, request envelopes, batching, cooldowns and conflict policy remain executable configuration owned by code and tests.

## Diagnostic trace

Trace is diagnostic authority only. It may record speech, checkpoint, request, provider, verification, Governor decision, validation, accepted-event, reduced-state, render, and latency facts, but it must never become domain replay authority or enter the audio hot path in a way that changes product execution.

See `docs/TRACE.md`.

## Verification obligations

Repository changes that affect live teaching must preserve or deliberately migrate the relevant guarantees:

- immutable committed evidence and ordered consumption;
- deterministic replay without provider calls;
- provider output validation before accepted state publication;
- explicit provenance and grounding, including distinct evidence attribution for autonomous AI correction;
- distinct teacher-established versus AI-initiated Cue authority where applicable;
- verification side requests do not become semantic events/truth and cannot block or roll back otherwise valid semantic evidence consumption;
- Board/Cue lifecycle independence;
- no automatic ordinary transcript on the normal presentationless surface;
- last valid learner state preserved on failure;
- trace isolation from domain truth and the speech hot path;
- current semantic state not bounded by viewport capacity;
- attention policy not silently deleting semantic knowledge;
- auxiliary intelligence not unnecessarily extending the common learner-visible critical path.

Engineering checks, offline evaluation, and synthetic browser fixtures do not by themselves establish real-lesson acceptance.

## Transitional legacy implementation

At the time this contract was introduced, the current implementation still contains legacy Board concepts including `BoardContent = TEXT | FOCUS | RELATION | TRANSFORM`, `SET_ACTIVE`, bounded Support/Retained collections, and a slot-based `BoardLayout`.

Those shapes are compatibility/implementation debt, not product authority. Until the Core-domain migration lands:

- do not add new product behavior that depends on `Retained <= 2` or global `Support <= 2`;
- do not treat `topic_shift -> clear previous context` as the desired product behavior;
- do not promote renderer display vocabulary into the new semantic schema;
- preserve replay/tests for historical event versions while introducing the new version intentionally;
- keep the current runtime reviewable and failure-safe while migration is in progress.

This transitional section should be removed once the production runtime and evaluator have migrated to the Core model.
