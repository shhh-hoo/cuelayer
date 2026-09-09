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
grounded representation candidates / payloads
        ↓
learner projection / attention selection
        ↓
visible artifact runtime
        ↓
Canvas spatial execution
        ↓
learner surface
```

The representation and spatial stages are non-authoritative projections of accepted lesson state. They may preserve their own visual/artifact/spatial continuity, but they must not become a second lesson-truth store.

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
- representation production may derive typed, grounded candidate forms and host payloads only from accepted meaning/evidence or other explicitly authorized bases;
- candidate availability does not itself authorize display; learner projection/attention policy decides which candidates deserve learner attention now and with what role/framing;
- visible artifact runtime joins selected candidate identity to the latest still-valid grounded payload and preserves artifact continuity without becoming semantic authority;
- Canvas spatial execution owns measurement, local visual organization, placement, packing, temporary teaching choreography, camera execution and teacher viewport inspection;
- rendering realizes the selected artifact/spatial scene;
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
9. Every independently mutable or referenceable semantic entity must have stable lesson-scoped identity that survives content revision. Text content, array position, renderer-local IDs, coordinates, screen position, representation IDs and Semantic Space membership are not semantic identity.
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
- require teacher approval or micromanagement for ordinary learner-surface updates;
- treat autonomous AI representation selection or free-form generated markup/media as accepted live authority before the reviewed grounding, artifact-identity, form-selection, timing and failure gates are satisfied.

Teacher speech is the primary classroom signal and immutable evidence of what was said, but not an infallible learner-visible truth boundary. AI controls the learner-facing surface by default; ordinary interventions do not require teacher approval. That autonomy remains contestable: later teaching may clarify, reject, revise, or supersede the AI's interpretation.

Current Core code is deliberately narrower than the full product authority where no honest provenance mechanism exists yet. In particular, free-form model belief is not accepted as a common-knowledge factual basis, and settled AI correction currently requires a host-verified trusted rule/evidence handle. Do not weaken provenance to simulate product completeness; add reviewed authority seams before production cutover.

## Teaching Cue

Board and Teaching Cue are sibling channels with independent lifecycle, revision, and conflict domains.

Board answers what knowledge the teaching is building. Teaching Cue answers what the learner should do, think about, compare, answer, notice, or remember now.

Teaching Cue may be teacher-established or autonomously initiated by CueLayer. AI initiation does not require teacher speech to establish the learner action. It does require a current contextual trigger plus a relevance/timing/pedagogical-value/productive-work gate. The trigger is not a false claim that the teacher requested the action.

Board change must not automatically resolve Cue. Cue resolution must not clear Board knowledge.

Cue targeting may reference a Core, semantic object, relation, comparison, or lesson-level action once the Core-domain reference contract is introduced. Core-domain Cue targets must not depend on legacy `BOARD_ITEM` identity after cutover. Exact target types belong in the implementation contract when introduced.

A correction does not automatically create a Cue. Conversely, an evidence-insufficient factual disagreement may independently justify an AI-origin QUESTION/HINT when that is the pedagogically appropriate way to preserve dialogue rather than overwrite truth.

## Teaching Representation

Teaching Representation is the non-authoritative projection layer between accepted lesson meaning and learner-facing rendering. It is not part of Core truth and does not get to introduce semantic claims merely because a visual form would be useful.

The implementation boundary is:

```text
accepted Core/Cue state + committed grounding
        ↓
representation producer / capability logic
        ↓
typed grounded candidates + host payloads
        ↓
learner projection / attention selection
        ↓
selected artifact identities + latest valid payloads
        ↓
Canvas spatial execution / renderer
```

Representation production must preserve these rules:

- a candidate references accepted semantic identities and attributable evidence; availability does not imply visibility;
- complete renderer payloads may remain host-side and may be richer than the M4A candidate index, but they are discardable projection data rather than lesson truth;
- selected artifact identity must be stable enough for progressive growth/revision where the same teaching object is still being represented; repeated updates must not silently manufacture unrelated replacement identities;
- a historical payload must be revalidated against current accepted state before reuse. Invalidated, superseded or no-longer-grounded claims must not survive visually as stale content;
- representation form changes may switch or pair media without duplicating semantic knowledge;
- arbitrary model-authored HTML, SVG, CSS, code or executable expressions are not a trusted automatic rendering boundary;
- new truth-bearing content discovered or invented during representation production must return through semantic interpretation/grounding/verification before it can become learner-visible lesson truth.

The current Teaching Visual Language v0.1 is a product-design working model rather than executable ontology. It may guide capability and renderer design, but it must not be serialized into Core state or treated as an exhaustive runtime enum:

```text
ESTABLISH  → create or join a local Semantic Space
RELATE     → graph
ORGANISE   → spatial grouping
TRANSFORM  → visible steps while preserving invariants and identity
COMPARE    → align comparable dimensions and highlight differences
```

Teaching Moves are separate from representation media. `PLOT`, `TABLE`, `DIAGRAM`, `MATH`, `IMAGE`, `MAP`, `CODE`, `TIMELINE` and similar media describe possible surface forms, not cognitive-move ontology. One medium may serve several moves, and several moves may compose in one teaching moment.

Structured representation should be preferred over accumulating transcript-like prose when accepted meaning has useful internal structure. This does not authorize front-loading branches, classifications, relationships or conclusions the teaching has not yet established.

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
+ shared-projector / teacher inspection state
```

The Intervention Governor additionally considers teaching phase and natural boundaries, pacing, semantic density, current Cue, recent intervention history/cooldown, shared-projector/teacher inspection, presentation mode, intervention urgency, expected pedagogical value, productive-struggle risk, and interruption cost. Its conceptual decisions are `SHOW_NOW | DEFER | MERGE | DROP | QUIET`.

The Governor should combine deterministic budgets/hard suppression rules with model judgment only where timing is genuinely ambiguous. Interaction count is not a product success metric. Calibration should start conservatively and be tuned from real lesson traces rather than a universal interventions-per-minute rule.

Previously established knowledge may remain visible because current understanding depends on it. That is dynamic necessary context, not a `RETAINED` semantic status.

Parked Cores remain spatially revisitable but default to low or zero attention and may be outside the current viewport. Exact coordinates, measurements, drag state, zoom, viewport, teacher inspection state, temporary presentation geometry and Semantic Space packing belong to Canvas/UI state rather than lesson knowledge.

The renderer may virtualize old Cores or Support. Virtualization must not delete semantic history.

Renderer vocabulary such as text emphasis, relation layouts, arrows, equations, transforms, grouping, Teaching Moves, representation-media types or compact notation is presentation vocabulary, not semantic ontology.

## Canvas spatial execution

Canvas spatial state is a non-authoritative execution layer. Its job is to keep the learner-facing visual world readable and continuous while consuming accepted projection intent; it must not rewrite semantic meaning to make layout easier.

The current working spatial model groups related visual objects into lightweight local `Semantic Space` neighborhoods. `Semantic Space` is a Canvas/UI concept, not a Core entity, relation type or durable lesson-truth category. The next representation/spatial integration must preserve that boundary even if the exact runtime type or packing algorithm changes.

Current spatial constraints for this design cycle are:

- stable semantic identity is stronger than stable pixel position;
- local visual membership/topology and recognizable relative geography should remain stable when possible;
- a local space may expand as teaching adds grounded objects/representations;
- expansion may minimally displace neighboring spaces to prevent overlap; exact x/y coordinates are not a hard invariant;
- resolve new spatial pressure incrementally and locally rather than repeatedly applying global re-layout merely to compact or beautify the Canvas;
- semantic topology, accepted dependencies, current teaching context and established neighborhood continuity should guide placement before generic similarity; visual proximity must never invent a semantic relation;
- internal grouping regions used for ORGANISE may overlap or nest when that expresses accepted membership, but independently packed Semantic Spaces must not collide in a way that makes unrelated teaching content physically overlap;
- temporary COMPARE/WIDEN choreography may move selected canonical artifacts into a shared presentation composition and later restore their persistent geography without creating semantic duplicates or Context Echo copies;
- teacher pan/zoom/history inspection is shared-projector UI state. It may suppress automatic camera execution temporarily but must not change `currentCoreId`, Core truth, Parked role or M4A projection semantics.

Exact Semantic Space membership policy, packing algorithm, persistence across reload/devices, collision strategy and motion parameters remain implementation/evaluation questions. Do not turn one spike's authored coordinates or solver choice into product ontology.

## Latency boundary

Auxiliary intelligence must not sit serially on the common learner-visible critical path unless measured evidence shows that its added pedagogical value justifies the latency.

Default direction:

```text
common path:
teaching evidence
→ Semantic Interpreter
→ deterministic semantic acceptance
→ bounded representation candidate production
→ deterministic validation / attention budget
→ artifact + spatial execution
→ learner surface

conditional side path:
possible factual conflict
→ Evidence Verifier
→ later marked correction or clarification
```

Representation selection or generation must not add a mandatory serial model call to the common path merely for novelty. A future model-based Governor or representation selector may be added only if real evidence shows that its pedagogical/form-selection value exceeds its latency, continuity and failure costs. Verification latency may be slower than ordinary teaching latency; it must not stall unrelated Core/Cue updates.

## Presentation modes

Presentation transport remains independent from semantic interpretation.

When a presentation is present, it may remain the primary visual background while CueLayer provides semantic augmentation. When no presentation is present, the Board may itself be the primary presentation surface. An always-on ordinary transcript is not the default learner surface.

Canonical transcript remains available where needed for grounding, debugging, accessibility, or an explicitly selected product mode.

## Persistence and replay

Accepted lesson events must be persisted before speculative state becomes learner-visible authority. Reload reconstructs durable lesson knowledge deterministically from replayable events without calling the provider.

Legacy event versions required for replay compatibility remain supported deliberately until a reviewed migration or retirement removes them. A legacy Board-domain session must replay through its legacy schema/reducer generation; it must not be silently translated into Core semantics during normal replay. A Core-domain session uses its own versioned event/state generation. Do not mix accepted legacy Board-domain and Core-domain semantic events within one lesson session.

At runtime, exactly one lesson-domain model is authoritative for a session. Temporary one-way projections/adapters from that authority are allowed for compatibility; dual-writing the same new evidence into legacy Board state and Core state as competing semantic truths is not.

The next Board-domain migration must introduce a versioned event/state contract rather than reusing legacy `SET_ACTIVE` / bounded `Retained` semantics under new names.

Representation-artifact or Canvas spatial persistence, if introduced, is subordinate to the accepted lesson event/state generation. Reloaded visual state must be revalidated/reconstructed against current accepted semantics rather than becoming an independent replay authority.

## Scheduling and failure recovery

The scheduler must preserve ordered unprocessed evidence. Provider, semantic validation, storage, timeout, cancellation, stale-result, and conflict failures on the common semantic path must not silently consume evidence or erase accepted learner state.

A transient semantic-path failure preserves the last accepted Board and Cue surface until a later valid change is accepted. Independent failure domains should degrade independently wherever technically possible. Verification/Governor/representation side-path failures must not roll back already accepted semantic state, re-open already consumed evidence, or block unrelated subsequent checkpoints. A verification side request is not an accepted lesson event or learner truth; only a later independently verified correction may change durable state.

A representation or spatial failure must preserve the last valid learner-visible projection where possible, fail closed rather than render ungrounded replacement content, and remain recoverable from accepted semantic state plus still-valid representation/artifact state.

Exact queue bounds, retry counts, deadlines, context budgets, request envelopes, batching, cooldowns and conflict policy remain executable configuration owned by code and tests.

## Controlled Core live boundary

Normal `/session` remains legacy until the production cutover. The internal `CoreLiveSession` API requires explicit `lessonDomain: "core"` and an injected interpreter. It consumes closed canonical speech spans through the shared checkpoint converter and lossless scheduler, using the reviewed Core context/proposal/validation contracts directly. It provides authoritative Core state to a host; no compatibility renderer or Canvas layout is introduced here.

The local event store records an immutable domain claim for each session, including empty sessions. Historical v3/v4 sessions are validated and claimed as legacy without conversion. A mismatched domain, mixed event generation, overwritten event identity or competing event sequence is rejected. Core sessions retain the v5 Core event generation, with additive persisted speech-run allocation events.

Core runtime writes are serialized. Each acceptance validates against the current replay using the original request binding, folds the entire event batch, atomically persists it, publishes once, and only then settles semantic scheduling. An abort before commit rejects the transaction and leaves the prior state/pending evidence intact. Once storage reports a durable commit, publication and consumption complete even if cancellation arrives too late to undo that commit. Observer exceptions cannot reverse this outcome.

Knowledge and Cue writes, explicit channel reads and semantic reference/provenance dependencies determine conflicts. Dependency checks occur before dereferencing an expired or changed entity so stale reads are classified as channel conflicts. Domain augmentation and verified correction also depend on the Cue context used to protect current learner work. There is no global semantic revision guard.

`NEEDS_CONTEXT` pauses with the prefix pending and no accepted event. Explicit host resume rebuilds bounded context with its grounded retrieval phrase; new evidence cannot bypass the pause. Provider/storage failures use bounded backoff, while validation/budget failures pause. Finalization drains committed evidence and the closed speech tail before appending `lesson.ended`. Incomplete drains remain unended and reloadable. Pre-existing Core logs that ended with pending evidence are reported as an error, never silently dropped or rewritten.

Normalized verification requests leave the semantic path only after durable acceptance and scheduler settlement. The bounded side dispatcher has no event-store/reducer access and treats candidate evidence only as an investigation lead. Missing sink, pressure, timeout, cancellation or failure affects diagnostics only. Semantic finalization cancels remaining side work without waiting for it.

## Diagnostic trace

Trace is diagnostic authority only. It may record speech, checkpoint, request, provider, verification, Governor decision, representation candidate/selection/artifact, spatial scene, validation, accepted-event, reduced-state, render, and latency facts, but it must never become domain replay authority or enter the audio hot path in a way that changes product execution.

Adding representation/spatial trace events must follow the same rule: trace may explain candidate availability, selection, artifact continuity, grounding rejection, placement/choreography and final visibility, but missing trace data cannot change representation validity, lesson truth or replay.

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
- representation candidates/payloads remain grounded, non-authoritative and revalidated against current accepted state before historical reuse;
- candidate availability remains separate from M4A learner-attention selection;
- artifact identity may preserve visual continuity without becoming semantic identity;
- Teaching Moves, representation media and Semantic Space geometry do not enter durable Core ontology merely to simplify rendering;
- local spatial growth avoids unrelated overlap without requiring immutable pixel coordinates or continual global re-layout;
- temporary teaching choreography does not create duplicate semantic truth or Context Echo copies;
- auxiliary intelligence not unnecessarily extending the common learner-visible critical path.

Engineering checks, offline evaluation, synthetic browser fixtures and cross-discipline authored representation stories do not by themselves establish real-lesson acceptance.

## Transitional legacy implementation

At the time this contract was introduced, the current implementation still contains legacy Board concepts including `BoardContent = TEXT | FOCUS | RELATION | TRANSFORM`, `SET_ACTIVE`, bounded Support/Retained collections, and a slot-based `BoardLayout`.

Those shapes are compatibility/implementation debt, not product authority. Until the Core-domain migration lands:

- do not add new product behavior that depends on `Retained <= 2` or global `Support <= 2`;
- do not treat `topic_shift -> clear previous context` as the desired product behavior;
- do not promote renderer display vocabulary, Teaching Moves, representation media or Semantic Spaces into the semantic schema;
- preserve replay/tests for historical event versions while introducing the new version intentionally;
- keep the current runtime reviewable and failure-safe while migration is in progress.

This transitional section should be removed once the production runtime and evaluator have migrated to the Core model.
