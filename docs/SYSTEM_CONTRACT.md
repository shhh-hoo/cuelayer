# CueLayer System Contract

## Authority and implementation status

This document is the executable repository authority for CueLayer. Product direction, learner-experience decisions and long-horizon ontology belong to the human-maintained `CueLayer — North Star & Product Model` Google Doc. This file translates those decisions into constraints on code, schemas, reducers, validators, providers, persistence and rendering. Git history, PR descriptions, benchmark reports and implementation comments are evidence, not product authority.

**Next-version design: `session-first-surface-design-v1`.** The Live/Stage, recoverable working-state, streaming and complete Display Decision Pipeline requirements below are the intended implementation contract, not a claim that they are enabled or evaluated. At the reviewed baseline `f1d871f944c96ebc3b2b6c772cf5ba01a4572010`, normal new sessions use the single Core interpreter and the conservative accepted-text projection. This documentation change modifies no runtime, provider configuration, schema, deployment or frozen corpus. Implementation PRs must report which target requirements they actually satisfy. Existing behavior is described separately under **Current Core live boundary**.

Legacy Board shapes remain historical replay/compatibility facts. Do not extend them as the target product ontology. Keep one product authority and update this contract in place rather than adding competing architecture documents.

## Execution model

The target session maintains continuous input, independently scheduled inference, one semantic authority and one coordinated learner surface:

```text
microphone / streaming ASR
        ↓
immutable committed evidence + audio/event-time mapping
        ↓
local Session Coordinator + Session Working Window + incremental indexes
        ├── Live Interpreter: local, timely, bounded changes
        └── Stage Interpreter: wider snapshot review and reconciliation
                         ↓
              one semantic acceptance engine
                         ↓
              append-only accepted events
                         ↓
              deterministic Core / Cue state
                         ↓
              semantic attention neighborhood
                         ↓
              grounded candidate production
                         ↓
              final M4A form / attention selection
                         ↓
              artifact lifecycle and payload join
                         ↓
              choreography + readable safe-area execution
                         ↓
              Board + sibling Cue + bounded Work Surface

conditional verification → later evidence-backed proposal to the same acceptance engine
validated intent on existing knowledge → same M4A selection, without a fake knowledge mutation
```

The preliminary neighborhood scopes candidate production. It does not force a representation kind or authorize display. Final selection follows actual candidate admission. Geometry recovery is a bounded deterministic continuation of that selection, not a second semantic or model decision loop. When the initially selected frame does not fit, recovery proceeds in order: preserve the same semantic neighborhood and choose an already admitted faithful compact candidate where available; remove optional Support; reduce only to a smaller semantically complete dependency closure; then use an explicitly staged, degraded or unsupported state if faithful fit remains impossible. Required qualifiers and truth-critical dependencies cannot be removed to satisfy geometry. The initial implementation must not invoke another semantic/model decision from geometry feedback.

Semantic interpretation, intervention governance and evidence verification remain three logical responsibilities. Live and Stage are execution timescales, not replacements for those roles and not two competing truth stores. Stage is not a mandatory approver of ordinary Live work. Core is incrementally editable knowledge, not a periodic summary produced only by a slow model. Inference can overlap; accepted writes remain controlled and atomic. Verification stays conditional and must not block unrelated ordinary updates.

The system preserves these boundaries:

- evidence records what speech actually committed; it is not automatically learner-visible truth;
- interpretation proposes meaning-bearing knowledge or intervention changes;
- acceptance enforces structure, capabilities, provenance, dependencies and state invariants before publication; these checks do not prove arbitrary semantic entailment or factual correctness;
- deterministic reduction reconstructs accepted knowledge without provider calls;
- representation produces typed, grounded alternatives from accepted meaning or another explicitly authorized basis, not new claims;
- M4A governs current attention and final candidate selection; availability is not visibility;
- ArtifactRuntime binds selected canonical identity to the latest valid payload and maintains lifecycle without becoming semantic authority;
- Canvas owns generic geometry, measurement, packing, choreography and inspection, not subject meaning;
- diagnostic trace explains execution but does not control semantic or operational recovery.

## Durable lesson knowledge

The Board is a conceptually unbounded Canvas of persistent Cores. A Core is a coherent teaching mainline that grows and is locally revised across teaching turns.

```text
TeachingState
├── knowledge
│   ├── revision
│   ├── cores[]
│   │   ├── objects / propositions
│   │   ├── relations
│   │   └── supports[]
│   └── currentCoreId
└── cue
    ├── revision
    └── active?
```

Exact type names and wire shapes are implementation details. Required semantics are:

1. A Core is not a card, paragraph, slide or replacement Active contribution.
2. Definitions, distinctions, conditions, mechanisms, equations and other truth-critical structure belong to knowledge, not optional Support merely because they are visually secondary.
3. Support is extra around a Core: examples, applications, annotations, illustrative cases, side explanations and nonessential detail.
4. Accepted Support remains semantic history until a justified correction, invalidation or supersession; visual eviction is not deletion.
5. Topic shift changes the teaching mainline without erasing the previous Core.
6. A non-current established Core is Parked by its relationship to currentCoreId; a redundant persisted parked flag is not required.
7. Returning to an earlier mainline continues its identity rather than duplicating it.
8. Viewport and model-context capacities do not impose a product-level cap on durable knowledge.
9. Independently mutable/referenceable entities have stable lesson-scoped identities across revision. Text, array position, coordinates, DOM IDs, artifact IDs and Space membership are not semantic identity.
10. Knowledge and Cue have independent lifecycle, revision and conflict domains. A knowledge-only change must not create an unrelated Cue conflict, and vice versa.

Interpretation must preserve accepted relationships and qualifiers rather than routinely producing disconnected prose objects. It need not create one object per word. Quantitative relationships can be n-ary; forcing them into unrelated binary causal edges is semantic distortion. A proposed typed quantity/expression structure is a versioned semantic extension when it establishes operands, operators or conditions; a render AST does not silently provide that missing authority.

## Semantic change and acceptance

Interpretation changes the smallest meaningful knowledge structure, not a UI slot. Supported functional operations include creating/refocusing a Core, adding/revising objects and relations, attaching/revising Support, changing the current mainline, and superseding or invalidating content when correction requires it.

An accepted step validates against an accepted base and publishes atomically. A proposal may contain several ordered steps; each step's conditions and dependencies remain intact. A complete accepted no-op may account for evidence without changing knowledge or Cue. It must not erase an unresolved subject, referent or unfinished proposition needed for later interpretation.

### Live and Stage proposal ports — target

Both ports use the same validation, provenance, serialized writer and event/replay authority. Names below describe target responsibilities, not deployed API/schema versions.

| Port | Inputs and authority | Required result handling |
| --- | --- | --- |
| LivePatch | A fixed contiguous pending evidence range, bounded accepted-state projection and recoverable unresolved items. It may establish clear local facts/relations, explicit self-corrections, timely Cue and sufficiently grounded initial/current/returned mainline changes. | Atomically record accepted changes and the processing disposition of covered evidence. Each checkpoint is accounted for once. Distinguish established meaning, deliberate no-change and deferred meaning. |
| StagePatch | A wider immutable evidence/state snapshot, recent accepted changes and explicit review obligations. It may propose local structural refinement, cross-fragment reference resolution or grounded continuity changes. | Use a reconciliation acceptance type. Do not consume already processed checkpoints again, create fake evidence, overwrite history, or turn a review summary into truth. Mark reviewed coverage and remaining obligations accurately. |

A Stage request may run independently, but its commit references durable evidence and checks its actual dependencies against current state. The initial implementation must provide host-captured read scopes, entity versions, absent/included context conditions, mainline conditions, allowed writes, task identity and evidence bounds. Do not delegate the complete conflict read set to a model's self-declaration. A read scope includes membership/absence dependencies when a conclusion relies on completeness. Conservative scope-level invalidation is preferable to unsafe merge; measured contention can justify finer granularity later.

Unrelated changes need not invalidate a result whose captured dependencies remain valid. Changed factual dependencies, affected membership or failed mainline conditions require rejection/reinterpretation. Never update the base revision field of an old proposal to bypass validation. Global state revision alone is not the final dependency model. Knowledge and Cue dependencies remain independent except where the proposed operation actually relies on both, including productive-work protection.

The host supplies IDs, timestamps, fixed versions, reference maps and event envelopes. Model generation supplies only necessary meaning-bearing values, references, uncertainty and intent. Capabilities, reference validity and factual-basis authorization remain distinct. Task identity and stable proposal/operation identity prevent duplicate commits across retry/reconnect; a transport retry is not permission to create a second semantic object. Lost acknowledgements are resolved against the durable accepted prefix.

The first Stage integration uses supported local operations, not automatic whole-Core merge/split, entity remapping or full-graph regeneration. New proposal, processing-record and reconciliation-event shapes require explicit versioning and tests. Preserve existing v3/v4 legacy and v5 Core replay; do not demand new semantics while claiming every schema remains byte-identical.

### Correction authority

Explicit teacher self-correction may revise a unit with normal speech-grounded provenance. Autonomous factual correction has a stricter gate: independently checkable/trusted evidence, material usefulness, current relevance, productive-work protection, explicit attribution and reversibility. Model confidence can trigger verification but is not factual authority. Ambiguous, disputed, opinion-based, uncertain, scoped-approximation or assumption-dependent claims must not be silently corrected.

When evidence is insufficient, preserve contestability through a marked question/challenge/clarification or a best-effort verification request. Verification requests are orchestration data, not lesson truth, accepted lesson events or evidence consumption. Malformed/ungrounded sidecars cannot roll back otherwise valid semantic acceptance. Candidate evidence is only a lead until independently validated. A second model agreeing is not independent evidence by itself.

## Semantic Working Window and session state

The Semantic Working Window judges whether teaching continues, revises, returns to an existing Core or establishes a genuinely new mainline. It can use recent committed evidence, current structure, nearby accepted changes, unresolved references and optional priors. Syllabus/lesson structure is optional; a course or syllabus must never become a runtime dependency or a truth whitelist.

| Scope | Purpose | Not equivalent to |
| --- | --- | --- |
| Session history | Immutable evidence, accepted events and complete recoverable knowledge. | One model request. |
| Session Working Window | Runtime carrier of teaching continuity, recent context, unfinished propositions, unresolved references, current work/Cue and processing/review progress. | A second knowledge store or a fixed ten-second buffer. |
| Dispatch batch | Fixed ordered evidence range or review snapshot assigned to one task. | A semantic Core or teacher turn. |
| Model context | Bounded task-specific projection with declared completeness and capabilities. | Complete history; omission is not absence. |

The working state has three recoverable classes: references to accepted state/evidence; operational dispositions and unresolved/review obligations; disposable indexes/compressions. Its complete active view can be rebuilt from the first two. The Session Working Window itself is not a persisted authority snapshot: only the minimum authoritative evidence references, processing dispositions and unresolved/review obligations required to reconstruct it are durable. Runtime queues, indexes, summaries, compressions and task-local caches are rebuildable projections. Provider conversation state and trace are not recovery authority. Keep processing metadata separate from truth-bearing Core fields, but persist essential dispositions consistently with the corresponding acceptance so a crash cannot consume evidence while losing unresolved meaning.

Track recorded, Live-accounted and Stage-reviewed coverage separately, including gaps and obligations. Processing is not semantic resolution. Live dispositions must preserve the semantic distinction among established meaning, deliberate no-change and deferred/unresolved meaning; Stage review must preserve whether review produced reconciliation, confirmed no further change, or left an obligation unresolved. Exact enum names and wire shapes are implementation details. A compact coverage marker may summarize only a contiguous range whose evidence is durably accounted for; deferred/unresolved items within or behind that marker remain separately addressable by evidence identity or range. An unfinished subject can survive an earlier no-op and bind to later evidence without manufacturing speech provenance. A model-written summary cannot replace exact evidence or erase conditions. Budget pressure limits projections and schedules work; it must not silently discard unresolved obligations.

## Local incremental runtime

Retain the existing evidence converter, lossless scheduler mechanisms, domain store and atomic reducer as the foundation. Introduce a Session Coordinator around those boundaries rather than duplicate controllers or competing reducers.

The runtime owns event ordering and identity de-duplication, monotonic timing and audio-time mapping, finite-state task lifecycle, coalescing with a maximum wait, cancellation/backoff, version/capability checks, incremental indexes and rendering notifications. Same-ID retransmission may be ignored idempotently; repeated teacher wording with a different evidence identity must not be deleted by textual similarity.

Traditional tokenization, term/alias lookup, sentence/number/unit parsing and finite grammars can locate candidate objects or dispatch signals. They do not by themselves establish negation scope, a causal relationship, an instruction or a topic boundary. Partial ASR can support hidden preparation only; it cannot supply durable fact provenance. The initial design can work entirely from finalized evidence without speculative partial-input inference.

Maintain indexes by checkpoint ID, semantic ID and revision, accepted dependencies, Core membership and provenance ancestry. Update them from new accepted events. Avoid cloning/replaying the entire lesson and rebuilding every historical map for each short request, and avoid repeatedly scanning all closed spans on every input change. Preserve historical-revision accuracy when caching: current same-ID content cannot answer an old-version provenance query. Rebuild indexes on restoration; validate incremental output against full replay.

Use a single session owner for acceptance and operational state. CPU-heavy indexing, restoration and parsing may move to a Web Worker after measurement, with versioned messages and disposable projections sent to the main thread; moving work must not introduce a second writer. DOM measurement and Canvas remain on the UI side. No PCM callback should do history scans, persistent logging, token estimation or React updates before audio delivery. Do not update React state for every generated token.

## Scheduling, throughput and finalization

Live and Stage have independent execution slots, request-size limits, deadlines and retry policies. Initial concurrency is one Live and one Stage per session; shared provider capacity prioritizes Live by deferring Stage. Inference never holds the short serialized acceptance transaction open.

Live dispatch combines a short contiguous range rather than creating an irrevocable job for every ASR final. Use coalescing plus a maximum dispatch wait, not a resettable debounce that can starve during continuous speech. Initial experiments may start at 200–300 ms coalescing and approximately 750 ms maximum dispatch wait; these are hypotheses in evaluation, not product constants. New arrivals accumulate while Live runs. Choose the next bounded batch from pending evidence when a slot is available, preserving identity/order. Do not add application waiting on top of an already satisfied boundary merely because another layer owns a timer.

Stage dispatch requires new material or newly resolvable obligations and is triggered by continuity/structure hints or maximum review lag. It is not an unconditional periodic summary. Hints from Live may trigger review; they cannot perform unvalidated mainline changes. Coalesce queued Stage jobs over a covering snapshot. Do not cancel running Stage inference on every new word; cancel when its critical dependencies or task purpose are invalid. Keep unfinished coverage so Stage cannot silently starve.

Use separate policies for separate work:

| Work | Queue/recovery policy |
| --- | --- |
| New committed evidence | Durable ordered processing; bounded active batches; no latest-wins deletion. Transport/validation/storage failure leaves it retryable. |
| Current attention intention | May merge or expire. An obsolete focus is not replayed just because computation finally finished. |
| Stage review | Queued tasks may coalesce; reviewed and unresolved coverage remains accountable. Late useful history can commit without stale attention. |

Bound in-memory work and preserve overflow durably where available. If storage or sustainable service capacity is exhausted, surface an explicit degraded/paused state rather than silently dropping evidence or claiming real-time operation. Throughput analysis uses actual consumed evidence per completed batch, arrival rate, retries and service time; it must not assume one checkpoint equals one call. Pending age must not grow continually under the supported teaching workload.

Finalization has one target policy. Closing capture first records the complete committed speech tail. Live must then bring every committed evidence item to a durable terminal processing disposition: accepted semantic change, deliberate no-change, or deferred/unresolved. Deferred/unresolved meaning is persisted explicitly and does not block sealing once it has been durably accounted for. Stage review is not part of the capture-close critical path: outstanding Stage/review obligations are persisted and sealed as incomplete rather than keeping the microphone or lesson open indefinitely. Only after the committed tail and Live dispositions are durable may `lesson.ended` seal the semantic session. A sealed lesson accepts no implicit late Stage mutation. Any post-session reconciliation or semantic revision requires a separate explicit versioned workflow. This target behavior deliberately extends, not silently reinterprets, the current Core finalization contract below.

## Model profiles and streaming transport

Use two independently configurable task profiles, not necessarily two providers or API keys. Live has a small task-specific projection/output grammar and independently measured low-latency configuration; Stage has a wider bounded projection and reconciliation grammar. Stage is not called for every ordinary Live decision. Do not add a third serial LLM solely to decide whether to invoke the other two. Exact model availability, reasoning options, output limits and service tier must be verified and measured at implementation time, not fossilized as product authority.

The initial transport target is an end-to-end HTTP event stream: provider → server adapter → browser incremental reader. Keep credentials server-side. Verify the actual local and deployed route does not buffer the stream until completion. A persistent WebSocket, managed voice-agent stack, TTS, Kafka or Flink deployment is not required for this design. Reuse existing SDK/transport and ordinary streaming, state-machine and incremental-computation techniques.

The server normalizes safe lifecycle/delta/completion/error metadata and forwards bounded chunks; the browser assembles a private draft buffer. A byte/UTF-8 boundary, parseable prefix, tool-argument delta or closing brace is not semantic acceptance. Initial Live output is one small independently complete patch: stream reception improves measurement and preparation, while only a completed, schema-valid, grounded and conflict-valid patch is persisted and published. Keep truth-critical qualifiers atomic with their claims. Streaming alone does not reduce model time-to-first-useful-result.

Before independently committing several units from one response, define explicit sequence, unit closure, dependencies, evidence allocation, idempotency and interrupted-stream rules. An incomplete suffix cannot revoke a committed unit or consume unprocessed evidence. That extension is not implied by adding `stream: true`. Observe provider failure/refusal/incomplete terminal states, bounded draft size, stalled first output, total deadline and disconnect propagation. A late abort cannot reverse a completed durable commit. Request/response streaming, connection reuse and model ability to incorporate mid-generation input are separate capabilities.

## Context projection and grounding

Provider context is bounded even though lesson knowledge is not. The complete authoritative state need not fit in a request. Send only the evidence, accepted history and writable/referenceable scope necessary for the task. Omission does not delete knowledge or prove absence. A projected Core does not imply complete contents. Admit required structural closure with its endpoints/targets, or fail without semantic clipping.

Provider operations may reference only authorized supplied identities and valid same-proposal creations. Mutation authorization does not itself grant factual-basis authority. A request for genuinely missing necessary historical context is non-accepting. Ordinary unfinished current phrasing instead needs a recoverable deferred disposition; do not conflate it with permanent missing context or repeatedly reinterpret it without new information.

Canonical checkpoints and grounding remain immutable replayable evidence. Provenance is attributable to each fact, relation, property, Support or correction at sufficient granularity for local revision and audit. Exact provenance structure is versioned implementation detail; historical reviewers must distinguish speech, prior accepted state, permitted/trusted domain knowledge and autonomous correction. Model-created symbols, summaries and display geometry cannot manufacture factual provenance.

Claimed speech quotes must resolve to committed evidence. A settled AI correction uses distinct provenance identifying the teacher evidence being challenged, its trusted/independently validated basis and a concise rationale. Trigger speech is not false support for the corrected claim. Correction history is reversible and auditable; model confidence is not a basis. Learner-action origin TEACHER/AI is separate from factual/content provenance.

## Alpha authority

Alpha may interpret natural teaching; reconstruct damaged expression when intended meaning is sufficiently grounded; reorganize accepted meaning; add useful trusted domain augmentation; add low-risk common/syllabus-compatible knowledge where its provenance path is honestly supported; flag factual conflicts and issue non-blocking verification side requests; autonomously correct concrete factual errors meeting the evidence gate; maintain/revise Core across turns; infer grounded continuity; and initiate NOTE, QUESTION, TASK or HINT when timely, useful and protective of productive learner work. Quiet is a valid useful outcome.

Alpha must not turn unsupported model belief/confidence into truth; silently correct ambiguous/disputed/scoped teacher claims; misattribute AI-origin interventions to teacher speech; generate weakly relevant, poorly timed or answer-leaking interventions; disclose complete answers that destroy unresolved productive work; use hidden syllabus assumptions as teacher evidence; require micromanagement of ordinary changes; or treat unconstrained AI form selection/free-form executable media as production authority before separate grounding, identity, selection, timing and failure gates pass.

Syllabus is a soft pedagogical boundary, not a strict factual whitelist. Low-risk common knowledge can clarify current teaching slightly beyond syllabus wording; advanced, niche, tangential or higher-risk claims require stronger grounding and attention value. Teacher speech is primary evidence of what was said, not infallible truth. Autonomy remains contestable through later teaching, clarification, rejection and correction.

Current code is narrower where no honest authority mechanism exists: free-form model belief is not accepted as common-knowledge factual provenance, and settled correction requires a host-verified trusted rule/evidence handle. Preserve that restriction until a reviewed extension supplies the missing mechanism. Do not weaken provenance to simulate completeness.

## Teaching Cue and Work Surface

Board and Teaching Cue are sibling channels with independent lifecycle/revision/conflict. Board describes knowledge; Cue describes what the learner should do, think about, compare, answer, notice or remember now. AI initiation requires a current contextual trigger and relevance/timing/pedagogical-value/productive-work gate, not prior teacher approval. Teacher-established Cue requires an actual learner-action speech act: an agenda mention or explanatory use of “calculate” is not automatically TASK.

Board update/parking/refocus cannot automatically resolve Cue, and Cue resolution cannot clear Board knowledge. Relevance and semantic resolution are different: an unresolved Cue may leave foreground attention without being deleted. Age or topic shift alone is not resolution. A correction need not create a Cue; a lower-evidence disagreement may independently justify a marked AI-origin question/hint.

Cue targets may refer to Core, semantic objects/relations, comparisons or a lesson-level action through the supported reference contract, never legacy BOARD_ITEM identity in the Core path. A companion Cue uses a screen-space ribbon/reserved region; its canonical/world coordinate cannot enlarge Board camera bounds. Its actual measured screen occupation does reduce the Board safe area. A dominant question/task can take foreground space, while targeted emphasis uses valid Board targets through the same attention owner. Incorrect Cue creation must be corrected upstream; removing it from camera bounds is not a semantic fix.

Work Surface represents attributable current calculation, observations, practical measurements, code tracing, temporary tables/plots, hypotheses or intermediate work. It has stable activity identity while active, attributable grounding/source, an explicit current/stale lifecycle and a bounded withdrawal/recovery policy. It is not a catch-all for partial LLM output, unsupported claims or rejected interpretation. Any learner-visible truth-bearing assertion introduced by AI on Work Surface must already be grounded in accepted meaning/evidence or pass the same semantic authority required for Board truth; Work Surface is not an alternate publication path for unaccepted semantic claims. Work becoming durable lesson knowledge still requires normal semantic acceptance. Reload may reconstruct active Work only from its authoritative activity/grounding records; ephemeral renderer state is not replay authority. Board, Cue and Work share scarce attention but do not acquire each other's semantic lifecycle.

## Display Decision Pipeline

The production target explicitly separates:

```text
accepted state + recent valid intent
→ semantic neighborhood (dominant / necessary context / useful Support; Cue separately)
→ bounded deterministic/constrained producer registry
→ validated candidates and host-only payloads
→ final M4A form/attention selection
→ artifact reconciliation / payload join
→ local choreography and readable frame
→ shared learner surface
```

Extract recent changes from objects, relations, Support, conditions, corrections, invalidations and mainline changes, not just ADD_OBJECT/REVISE_OBJECT. Revalidate previous emphasis. Select the smallest necessary dependency closure; changed or present does not automatically mean attention-worthy. An agenda preview need not generate dominant cards. An unclear formula must not be confidently enlarged.

The initial bounded working budget may use one dominant unit, up to two necessary-context representations, one optional Support and one companion Cue. This is a calibratable FOCUS policy, not an ontology or fixed capacity; COMPARE can have multiple co-primary targets. Truth-critical dependencies cannot be dropped to satisfy a numerical count. Choose a smaller complete teaching unit or alternate representation when necessary.

Callers request useful validated forms for semantic targets under roles and constraints, not TEXT for every target. Candidate metadata, not giant payloads, crosses the selection boundary. Explicit trusted host plans remain supported and validated; normal automatic routing must not depend on authored fixture plans. Form selection initially uses deterministic relevance/fidelity/continuity/space policy among trusted capabilities, without reopening autonomous free-form representation generation. Model judgment belongs in meaning-bearing interpretation or separately evaluated selection, not an unexplained second serial call.

The Governor considers teaching phase, natural boundaries, pacing/density, active learner work/Cue, recent interventions/cooldown, urgency, value, productive-struggle risk, interruption cost, presentation mode and inspection. Conceptual decisions remain SHOW_NOW, DEFER, MERGE, DROP or QUIET. Interaction count is not success. Failure to produce a necessary useful representation is reported as a capability/coverage gap, not laundered into successful QUIET.

## Teaching Representation and typed IR

Representation expresses accepted meaning without inventing semantic claims. The same meaning can use selective text, equation, graph, comparison, table, plot, timeline or another reviewed form. Structured form is preferred when it clarifies real internal structure; text can be the best form for exact wording, a label, source text or a short definition. Do not replace all prose with diagrams or require symbols when they obscure meaning.

The next constrained production baseline comprises selective accepted text (preserve the existing `accepted.content` identity where applicable), math expression, accepted relation structure, structured annotation and structured grouping. These are capability responsibilities; new registry IDs must be explicitly versioned rather than silently renaming existing bindings. Rich plot, molecule, apparatus, code and other domain media remain subsequent scoped extensions. Demo capabilities must not be registered wholesale merely because they passed authored stories.

A mathematical rendering IR has a bounded typed AST: grounded symbol references, literals, product/sum, fraction, power and equality/other explicitly supported relationships. Each symbol/operand binds to accepted meaning and applicable conditions; AST depth, size, allowed operators, numerical values and notation are validated. Deterministic compilation may target the existing math renderer, KaTeX, MathML or SVG; free-form model LaTeX/HTML/JS is not the authority. No arbitrary code evaluation, custom macros or generated executable expressions.

Separate semantic mathematical structure from presentation AST. If accepted meaning is only ambiguous prose, a deterministic formatting pass cannot pretend to discover a reliable equation. Use an accepted typed semantic extension or a narrowly reviewed meaning-preserving grammar with refusal/fallback; missing semantics return through interpretation. A valid schema/reference is not proof of semantic equivalence. Do not infer missing units, conditions, relation direction or scientific truth from a renderer template.

For the supplied partial-pressure design example, once supported meaning is accepted, produce `p_i = x_i P_total`; when the mole-fraction relationship is accepted, produce `x_i = n_i / n_total`, making the new equation dominant and the earlier one context. A shared-symbol correspondence is not a new causal arrow. Substitution into a third formula is a teaching transformation requiring its own authorization/productive-work check, not an automatic display improvement. “Total pressure is usually provided” can be an attributable annotation; a mandatory scientific condition remains knowledge, not optional annotation.

General routing prefers accepted equality/quantitative structure → math; accepted typed connections → relation structure; accepted membership → grouping; accepted comparable dimensions → aligned comparison; accepted ordered process → sequence; current numerical work → bounded Work Surface; useful example/application → attached Support/annotation. Uncertainty does not become a confident graphic. Every rule has a faithful text/compact alternative where useful, or honest preservation/degradation when none exists.

### Grounding and artifact lifecycle

Candidates reference accepted semantic identities and attributable evidence. Availability never implies selection. Rich payloads can remain host-side and are discardable projections. Join selected metadata to the latest valid payload only after selection.

Maintain stable lesson-scoped candidate/payload/artifact binding across ordinary content revision. The same conceptual representation updates rather than remounts; a genuinely distinct medium/capability has an explicit separate identity. Never rebound a withdrawn ID to another semantic target/capability. Revalidate on update, PRESERVE and historical reuse; stale-part pruning removes invalidated relation/curve/label content without deleting unaffected supported structure. Rendering failure cannot keep a known-invalid claim visible.

Changing or pairing media does not duplicate semantic knowledge. Temporary movement preserves canonical artifact identity; there are no Context Echo copies. Generic ArtifactRuntime and Canvas have no subject imports/branches. Any new truth-bearing content found during production returns through semantic grounding/acceptance/verification.

Teaching Visual Language v0.1 remains a working projection model, not a serialized Core enum: ESTABLISH creates/joins local visual context, RELATE expresses accepted connections, ORGANISE shows grounded membership, TRANSFORM shows authorized change with invariants preserved, COMPARE aligns established dimensions. Media such as PLOT, TABLE, MATH, DIAGRAM, IMAGE, MAP, CODE and TIMELINE are not knowledge categories or exhaustive Teaching Moves.

## Spatial membership, choreography and readable framing

Semantic Spaces are lightweight Canvas/UI neighborhoods, not Core entities or truth categories. One Core may span several Spaces and one Space may contain several grounded forms. Projection composition owns explicit membership based on accepted topology and teaching context; Canvas executes it generically.

Ordinary revision stays in its Space; attached Support follows its target; directly related extensions may join an existing local neighborhood; independent branches get nearby separate Spaces. Do not assign every accepted unit a separate Space as the intended normal behavior. Do not merge two established Spaces automatically because an edge crosses them, or group unrelated content because it looks similar. Uncertain assignment uses a stable conservative fallback and an inspectable reason.

Stable identity and recognizable local topology are stronger than immutable pixels. Measured local growth may minimally displace pressured neighbors; distant unaffected Spaces stay stable. Incremental collision resolution is preferred over global compaction. Internal grouping regions may overlap/nest when authorized membership warrants it, but independently packed unrelated neighborhoods must not obscure each other. Preserve per-artifact size invalidation for font/resource/reflow changes; prevent observer loops and avoid full-history layout on every token.

Canonical homes and presented positions are separate. When current framing is already readable, preserve it. When needed, FOCUS can temporarily recompose the same canonical artifacts just as COMPARE/WIDEN can; presented coordinates do not rewrite homes or semantic membership. Return restores persistent geography without duplicate visual knowledge.

- FOCUS emphasizes the current teaching unit, places minimum necessary context nearby and subordinates optional Support.
- COMPARE aligns accepted common dimensions and multiple co-primary targets; it cannot fill missing comparison cells with invented facts.
- WIDEN reconnects a broader accepted topology for synthesis/review; it is not a generic row or merely zooming out.

These modes may share geometry primitives, but their acceptance tests must demonstrate distinct attention/topology behavior. Layout does not create causal or classification meaning.

The safe viewport excludes measured controls, Cue ribbon/foreground, Work occupation and presentation-overlay exclusion areas. Board bounds use selected Board artifacts, not a faraway Cue artifact or all parked history. First preserve a comfortable view; otherwise use a small pan, local composition, faithful compact forms and removal of optional content before bounded reframing/zoom. This execution follows the deterministic recovery order defined above; Canvas may report pressure and execute the selected fallback but may not invent a new semantic neighborhood or representation outside admitted candidates. A scale floor is a readability limit, not a normal successful outcome with clipped teaching content.

Within the explicitly supported viewport/content envelope, the admitted dominant unit and required context must be readable and unobscured without rescue panning. Never remove a required condition or shrink illegibly to make a geometry flag pass. When content cannot fit faithfully, select a smaller semantically complete neighborhood, an explicitly staged complete treatment, or a visible degraded/unsupported state. The internal `fits=false` diagnostic remains legitimate; it must not be reported as successful settled presentation. Teacher inspection is an intentional exception, not failure of auto-fit.

Alpha is a shared projector. Pan/zoom/history inspection suppresses automatic camera motion but does not change currentCoreId or lesson truth. Acceptance, invalidation and withdrawal continue. Follow teaching frames the latest valid attention, not queued historical camera commands. Late Stage knowledge can update its historical home without stealing foreground; a mainline-changing proposal must still satisfy current mainline/recency preconditions.

## Presentation modes

Presentation transport is independent. With slides, the chosen presentation can remain the primary background and CueLayer uses safe augmentation areas. Without slides, Board can be the presentation. An always-on ordinary transcript is not the default product or a latency workaround. Transcript remains available for grounding, debugging, accessibility or an explicitly selected mode.

## Persistence, replay and failure recovery

Accepted semantic events are persisted before they become learner-visible authority. A failed append never publishes speculative state. Durable commit is the linearization point: once storage commits, a late cancellation cannot reverse publication or reopen consumed evidence. Observer/diagnostic exceptions cannot alter committed outcomes.

Each session has exactly one immutable semantic-domain claim. Historical legacy events use their legacy reducer; Core events use the versioned Core reducer. Do not dual-write legacy/Core, translate old logs on read or project live Core back into Board slots. Compatible one-way UI projections are subordinate to the selected authority, never semantic mirrors.

New reconciliation/operational records must define schema/replay compatibility and crash-consistent processing. Keep operational recovery metadata distinguishable from accepted factual events; use one session owner and atomic acceptance grouping where consumption and unresolved disposition depend on each other. No provider-generated memory becomes a second durable truth store. Visual state is reconstructed/revalidated from accepted semantics; replay cannot depend on old in-memory geometry or require LLM calls.

Provider, validation, storage, timeout, cancellation and conflict failure cannot silently consume evidence or erase accepted state. Independent Stage/verification/representation failure cannot roll back a completed acceptance. Preserve the last still-valid presentation where possible, withdraw known-invalid material, fail closed for unsupported replacements and allow later recovery. Missing diagnostic data cannot change validity. Exact retry/deadline/window/batch parameters belong in versioned executable configuration and reproducible tests.

## Current Core live boundary — implemented baseline

At `f1d871f944c96ebc3b2b6c772cf5ba01a4572010`, normal new `/session` identities durably claim Core before semantic work. Restoration selects from the immutable domain claim, with deterministic historical v3/v4 validation and legacy claiming. Missing, invalid or mismatched restoration claims fail closed. Diagnostic trace status cannot replace lesson identity. The local store rejects mismatched domains, mixed generations, overwritten identities and competing event sequences. Core uses `lesson-event-v5-core` plus persisted speech-run allocations.

`CoreLiveSession` receives explicit Core domain and an injected interpreter; the production host supplies the HTTP adapter. It consumes closed canonical spans through the shared checkpoint converter and existing lossless single-flight scheduler. Acceptance validates using the original request binding, folds the event batch, persists atomically, publishes once and settles scheduling. Knowledge/Cue writes, explicit channel reads and provenance/target dependencies determine conflicts; augmentation/correction also depends on productive-work Cue context. There is no global semantic-revision guard.

`NEEDS_CONTEXT` currently pauses with its prefix pending and no accepted event. Explicit host resume rebuilds context with the grounded retrieval phrase; new evidence does not bypass the pause. Provider/storage failure uses bounded backoff; validation/budget failure pauses. Finalization drains committed evidence and closed tail spans before `lesson.ended`; incomplete drains remain unended/reloadable. Pre-existing ended Core logs with pending evidence error instead of being rewritten. Normalized verification requests run only after durable acceptance/settlement; the bounded side dispatcher has no store/reducer access. Its missing sink, pressure, timeout or failure is diagnostic. Current finalization cancels remaining side work without awaiting it.

The present server awaits a complete provider response and the browser awaits `response.json()`. `productionRegistry()` registers accepted text only; fallback attention tracks recent object add/revision, requests TEXT, supplies no automatic context/Support and includes active Cue. Current composition leaves FOCUS at canonical homes while other framing uses shared row packing. These are verified integration limitations, not target rules. The next-version contract must replace them through scoped implementation and evaluation; additional renderer demos or timeout changes alone are not completion.

## Diagnostic and evaluation obligations

Extend the existing trace contract, not a new logging authority. Correlate session/task/lane/epoch, audio-event time and mapping uncertainty, evidence IDs and covered ranges, dispatch reason, queued/start/first-delta/complete/accepted/published/visible times, provider model/usage when actually returned, deadlines/abort source, queue age/coverage, captured dependency conflicts, candidate rejection/selection, artifact revisions, Space membership, safe-area measurements and framing outcome. Use local monotonic durations; do not subtract unsynchronized client/server clocks as latency. Never record secrets, authorization headers or audio buffers solely for diagnostics.

Trace checkpoints cover every boundary but missing trace must not control acceptance. Distinguish no useful change, unresolved meaning, missing capability, representation rejection, stale intent, fit failure and transport failure. See `docs/TRACE.md` for current event vocabulary; new names must be implemented and documented additively rather than assumed from this design.

`docs/EVALUATION.md` defines joint acceptance. Preserve immutable evidence/order, deterministic replay, provenance/correction gates, Cue origin/lifecycle, no speculative publication, no transcript fallback, bounded attention without semantic deletion, grounding and identity continuity, subject-generic runtime, readable local packing and no stale attention replay. Unit tests, historical frozen exemplars, authored GOLD stories and deterministic browser fixtures remain scoped evidence, not live classroom acceptance.

## Legacy compatibility

Legacy `BoardContent = TEXT | FOCUS | RELATION | TRANSFORM`, SET_ACTIVE, bounded Support/Retained and slot BoardLayout remain exclusively for historical restoration and historical evaluation. Do not extend Retained/Support slot limits, topic-shift clearing or BOARD_ITEM identity into new Core work. Preserve historical tests and logs while introducing explicit new contracts. Remove obsolete compatibility code only through a separately reviewed retirement, not as incidental cleanup of this architecture change.
## Isolated V2 deterministic experiment

`apps/cuelayer-v2/` is the parallel clean-rebuild experiment for #40 under #37. It has its own package, browser entry, database and versioned contracts. It imports no old runtime implementation. Production entrypoints, old event schemas, storage and frozen exemplars remain unchanged. The existing implementation-preservation instructions above continue to apply to production; they do not require copying those mechanisms into this experiment.

New sessions now use `cuelayer-v2-event-2`, `v2-source-processing-1`, `v2-live-request-1` / `v2-live-decision-1`, and `v2-stage-request-1` / `v2-stage-review-1` with `v2-stage-processing-1` review records. The normative Incremental Semantic Frontier appendix remains owned by [PR #45](https://github.com/shhh-hoo/cuelayer/pull/45), tracked in [Issue #44](https://github.com/shhh-hoo/cuelayer/issues/44); this implementation does not duplicate that appendix. Executable source positions, provider projections, acceptance and replay are defined in `apps/cuelayer-v2/src/source.ts`, `projection.ts`, `live-wire.ts`, `stage.ts`, `acceptance.ts` and `contract.ts`. Historical event-1 logs retain their original reducer and open read-only; no implicit conversion or in-place rewrite occurs. New exports are `cuelayer-v2-export-2`; historical exports retain version 1. Implementation and offline tests do not establish the real-service gate.

The original baseline's executable identity was `cuelayer-v2-event-1` / `v2-proposal-1`. The finite authored interpreter in `story.ts` is synthetic acceptance input, not a natural-language parser, model evaluation or production interpreter. Exact source text, quantitative operands, units and conditions are authored together. The supported story establishes gas mixtures, two quantitative relationships, comparison and a teacher Cue, an ambiguous reference, delayed Stage annotation, chemistry, return/self-correction, and a finite sine function/domain. The unclear Kc expression deliberately remains unresolved.

### V2 authority and coordination — historical event-1 baseline

- `SpeechEvidenceAdapter` treats partials as VOLATILE, a host preparation signal as PREFLIGHT, and only provider finals as COMMITTED. The fixture explicitly supplies the preparation signal; no empirical provider-stability classifier is claimed. Neither partials nor `EndOfUtterance` can authorize acceptance. There is no canonical grouping gate or automatic force-finalization.
- Exact run/interval/channel identity distinguishes retransmission from repeated wording. Conflicting content under an identity fails closed. The writer assigns durable receipt order. If final N cannot persist, an admission-gap latch blocks later identities and sealing until that same content is retried. Failed nondurable input cannot be recovered after a browser crash; V2 never claims it was admitted.
- One Dexie transaction appends each immutable evidence or accepted event at an expected session prefix. The single acceptance writer validates host-captured versions, structure, scope, committed provenance, required semantic references and contiguous Live dispositions before appending. Publication follows commit. Lost acknowledgements are checked against the exact durable event, and competing prefixes fail closed.
- Core, unit, membership/absence, mainline and Cue versions are captured by the host. Stage sees only its selected Core scopes and has no mainline/Cue write capability. Proposals cannot provide their own dependency set. These checks establish attributable, structurally consistent proposals; they do not prove arbitrary semantic entailment or factual truth.
- The Working Window is reconstructed from evidence, dispositions, unresolved obligations and exact review coverage. It is not a stored truth snapshot. It exposes ordered evidence, pending ages, active tasks, dependency captures, consumed IDs and outstanding reconciliation obligations. Trace and provider memory are never recovery inputs.
- Independent p-queue Live and Stage executors run around CueLayer-owned scheduling policy. The deterministic profile uses 25 ms quiet coalescing, an independent 75 ms oldest-item deadline and at most four contiguous finals. These are experimental values, not product invariants. p-retry performs two bounded retries only for a CueLayer-classified transient interpreter error. Validation failures retain pending evidence; stale work is recaptured without relabeling its original dependencies.
- Live records established/no-change/unresolved dispositions atomically with accepted operations. A semantic change cannot be labeled entirely no-change. Unresolved meaning remains separately addressable behind the consumed frontier. Stage has no consumption port and records exact review coverage; it selects oldest unreviewed evidence (up to 32), recent context (up to eight), and unresolved sources, preserving gaps rather than replacing them with a newest-only watermark.
- Requests fail visibly at 32,000 serialized context/evidence characters or 64 projected units; this is a request envelope, not a capacity on accepted knowledge. A blocked Stage request does not block Live or remove obligations. Scalable context retrieval and partitioning remain unfinished.
- Attention is disposable projection state. A late Stage semantic refinement can commit while its obsolete attention is discarded by captured attention epoch and freshness. Reload rederives a current frame instead of replaying old intentions. Sealing drains Live, retains unresolved/review obligations and rejects late semantic writes.

### V2 display and substrate scope

`display.ts` performs semantic neighborhood closure, candidate production, selection and geography policy. Quantities have structured operands and bindings before rendering. TEXT is selected for a statement, not preselected for every unit. Equation/plot alternatives, chemical notation, explicit relation structure, annotation and basic comparison form the finite capability set.

Cortex's standalone MathJSON-to-LaTeX serializer performs no evaluation or simplification. Mafs owns sine sampling, coordinates, ticks and π labels; its adapter admits only the supported accepted expression/domain. KaTeX plus its ESM mhchem extension own typography. No renderer creates missing operands, units, conditions or accepted claims.

The real tldraw spike mounts canonical custom shapes, performs coordinate/camera mechanics and handles teacher hand/wheel inspection. It holds only disposable representation identity/version and geometry. CueLayer assigns related units to shared stable spaces, appends local geography, and keeps temporary presented positions separate from homes. FOCUS distinguishes primary from necessary context; COMPARE gives co-primary equations; WIDEN uses canonical topology instead of comparison packing. The initial geography uses disjoint fixed-width lanes and bounded shape envelopes, not an arbitrary variable-size packing solver.

The supported browser envelope is 1280×800 and 390×844, with up to two 320×260 truth-bearing units or one 320×380 plot in the current frame. More demanding dependency closures explicitly degrade rather than silently clipping or shrinking text. Shapes retain identity through return and correction. Per-artifact rendering failures retain semantic state and show an explicit capability failure. Arbitrary oversized content is outside the passing envelope.

A separate Floating UI Cue occupies a screen-space reserved band and never contributes to Board world bounds. Cue relevance controls visibility without resolving its semantic lifecycle. A timely accepted Cue receives a disposable presentation invitation bound to its Cue and mainline versions; leaving that mainline or reloading expires the invitation. Returning does not reissue an old Cue, although its accepted meaning remains recoverable. The finite story has a teacher-established Cue; this is not a restriction on the product's separately authorized AI-intervention policy. No active Work Surface story or autonomous factual correction is implemented; failures and streamed drafts are never treated as Work or truth.

Teacher inspection cancels automatic camera animation and suppresses new automatic commands while semantics continue. Native drag momentum is teacher interaction, not teaching-driven framing. Follow Teaching frames the latest accepted neighborhood. Reduced motion disables automatic transitions. tldraw remains a conditional spike dependency: its bundle and production-license requirements must be assessed before deployment/cutover. No such cutover is authorized here.

V2 retains evidence until explicit session deletion; export is versioned and local. Diagnostic spans are bounded to 4,096 records with a dropped count and explicit best-effort flush. Existing sessions are never imported or translated implicitly. A future legacy import needs a separate reviewed versioned boundary.


### V2 real-service boundary — historical PR43 baseline

The opt-in `?services=real` route substitutes official Speechmatics microphone transport and an OpenAI adapter behind the same Interpreter port. Neither provider state nor diagnostic traces are recovery authority. Each nonempty Speechmatics final immediately enters the existing serialized durable writer with immutable run/interval/channel identity; partials and empty provider events cannot establish evidence. The ingress retains a failed final's original text and receipt timestamp for explicit ordered retry. Transcript grouping and EndOfUtterance never gate final admission.

Host-captured Live context includes at most four new evidence items, authorized semantic state/dependencies and the most recent sixteen relevant unresolved obligations with their original committed source evidence. Earlier source evidence is read-only grounding context, never new consumption. Omitted obligations remain in the Working Window and are explicitly counted; omission does not imply resolution. The whole task is bounded to 32,000 characters and 64 selected semantic units; overflow fails closed. Stage keeps its independent review scope and cannot consume again. New Core/Unit IDs come from host-issued deterministic task slots. Model output is incomplete until the provider terminal event, JSON decoding and Proposal schema pass; then the sole acceptance engine checks grounding, host-captured dependencies and contiguous dispositions before persistence/publication. Referencing a durable but uncaptured unit is rejected.

The representation contract above also governs V2. Its deliberately finite selector and renderers are not equivalent to the historical Teaching Representation capability envelope. Evaluation must inspect new meaning as dominant with minimum required prior context, stable artifacts under correction, visible units/conditions and no invented substitution or causal link. Candidate availability alone is not evidence of appropriate teaching form selection; richer media, shared-symbol emphasis and multi-curve lifecycle require their own reviewed cases. A bounded geometry check is not proof that overflowing artifact content is readable.
