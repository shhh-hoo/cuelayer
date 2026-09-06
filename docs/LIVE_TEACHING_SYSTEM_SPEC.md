# CueLayer live teaching system

This is the current execution contract, subordinate to [Product Charter](PRODUCT_CHARTER.md). [Roadmap](LIVE_TEACHING_ROADMAP.md) owns work-package/PR status; [Semantics Baseline](SEMANTICS_BASELINE.md) owns recorded gates and unresolved findings. Experiment narratives and historical outputs are not execution authority. Change this specification intentionally before changing product semantics.

## Dataflow and authorities

```text
microphone → official PCM transport → Speechmatics final → canonical closed span
→ immutable checkpoint / Lesson Event Log → ordered pending scheduler
→ bounded evidence + current state request → interpreter → compact-reference expansion
→ normalization → validation → durable accepted events → deterministic Teaching State
→ Board / Cue renderer → per-item DOM observation
```

- The **Lesson Event Log** is historical domain truth: committed checkpoints, accepted steps including KEEP, Cue expiry, teacher overrides and lesson lifecycle. Attempts, raw provider output and diagnostic timestamps are not replay authority.
- **Teaching State** is current authority. Reload restores it from events without calling the provider. The model proposes ordered deltas, never replacement whole state.
- **Session trace** is diagnostic evidence. It preserves safe request/output/validation/state/render facts but cannot drive domain state or block the audio path. See [trace contract](TRACE_ARCHITECTURE_V2.md).

The lesson ends explicitly. Committed evidence is immutable; source finals, span identity and word grounding remain attributable. Open spans do not trigger speculative interpretation. Canonical closure uses punctuation, 900 ms pause, 6.5 s duration or 28 words, with explicit stop/drain handling. Missing word timing is not replaced with invented acoustic timing.

Domain schema is `lesson-event-v4-continuous`. Historical `lesson-event-v3-learner-agency` events explicitly dispatch to the preserved v3 reducer; unsupported versions are rejected. Broad persisted contribution vocabulary stays replayable. Do not apply the current proposal validator to historical accepted events or silently rewrite their content. Idempotent event handling and deterministic replay are required.

## Production configuration

| Setting | Current value |
| --- | --- |
| Live profile | `alpha-continuous-bounded-v9` |
| Live policy | `bounded-agent-continuous-context-v9`, including `necessary-factual-attribution-v1` |
| Context projection | `bounded-evidence-v1` |
| Model default / effort | `gpt-5.6-luna` / low; actual request configuration is audited |
| Wire contract | `teaching-output-refs-v1`, `teaching_interpretation_compact_v1` |
| Request concurrency / batch | One in flight / at most two checkpoints |
| Provider / client deadline | 6000 ms / 8000 ms (2000 ms transport/audit grace) |
| SDK retries | Zero |
| Input guard / envelope reserve / output reserve | 24000 / 12000 / 2048 estimated tokens |
| Board Support / Retained capacity | Two globally / two |
| Cue | One active primary; one subordinate HINT on TASK/QUESTION |
| NOTE expiry | 4000 ms browser timer; no Board TTL or HINT expiry |

The current corpus freezes v7 evaluation profiles separately; their passing results do not certify v9. Those policy/schema entrypoints remain where required by evaluation or compatibility tests. A development-only deadline diagnostic exists (6000–60000 ms), must be explicitly marked, and must never be mixed with production measurements.

## Context and attribution

The request contains the selected processed evidence/accepted work, authoritative current state and scheduled new-evidence prefix. New evidence is the sole deliberation trigger. Word timings, raw ASR JSON, future captions, gold, expected Board timelines and unavailable visual descriptions do not belong in model context. Domain knowledge is allowed only under the selected contribution capability.

Bounded history selection pins immutable speech provenance dependencies of current Board/Retained/Support/Cue/HINT, including historical dependencies. Missing dependencies or mandatory history over 4000 estimated tokens block explicitly. Otherwise include recent speech up to 1600 tokens, up to eight unattributed unfinished/ambiguous/insufficient-evidence checkpoints among the last 24 consumed checkpoints, then up to four recent accepted interpretations and their required evidence, all within the 4000-token history budget. Estimates use JSON characters / 4, not measured usage. Ordering and canonical text remain unchanged. The complete event log is not truncated; omitted context does not mean an activity ended or speech never occurred.

Consumption, current trigger and factual attribution are separate:

- Consume the ordered unconsumed batch exactly once on whole-request acceptance. Historical citation never consumes history again.
- Each non-KEEP step needs evidenceRefs from a checkpoint it consumes. History alone cannot trigger change. New Cue/HINT needs current teacher evidence.
- Each generated contribution must attribute all supplied speech facts necessary to reconstruct it, unless equivalent factual basis is reachable through an explicitly cited state item with valid provenance. A category label does not carry every fact about its subject. Supplied history consumed KEEP can remain necessary.
- The model decides factual necessity and equivalent state basis semantically. The validator proves reference membership, causality, structure, basis and valid state identities; it does not certify semantic completeness or subject-matter truth. Do not implement lexical provenance guessing or automatically append nearby refs.
- Exclude irrelevant history and future/unsupplied evidence. If the available basis is insufficient, narrow the contribution or KEEP.

## Provider and acceptance contract

The compact codec replaces structural evidence/state IDs with request-local typed handles: `e`, `b`, `c`, and `s` for Support (not a Board target). It does not rewrite content or choose attribution. `nbN`/`ncN` name potential reducer-generated identities for proposal step N; existence and causal legality still require rolling-state validation. Unknown or wrong-kind handles fail expansion.

Request identity and base revisions are bound to a cloned request snapshot before awaiting the provider, rather than copied by the model. Schema structure is stable; exact supplied-ID membership is checked after expansion. Captured maps are authoritative for offline decoding: canonicalizing JSON can reorder object traversal and generate different aliases. Audit separately identifies policy, actual provider instructions/schema, request, captured map, raw output and normalized proposal.

Normalization resolves selected speech IDs to complete immutable checkpoint text. Learner wording need not be a substring. Permitted optional-link/support normalization remains audited; it is not blanket salvage of invalid proposals.

Validation checks request identity, base revisions, schema, ordered whole-batch coverage, reference membership/order, capability and provenance, current trigger, rolling targets and lifecycle. Proposal revisions must match the request, and request Board/Cue revisions must match authoritative state. Any conflict rejects the whole request without consumption, including otherwise valid channels and KEEP. Rebuild against current state; no channel salvage or fabricated KEEP.

One narrow continuous-profile rule (`empty-cue-resolve-noop-v1`) turns RESOLVE_CURRENT with no active Cue into audited KEEP **after** the other checks succeed. The accepted warning is `cue_resolution_noop`; raw output remains in audit. Invalid REPLACE/HINT/targets, grounding or conflicts are not excused.

Validated accepted events are persisted atomically before published state changes. Storage failure cannot publish speculative state. Accepted KEEP is successful consumption with no invented visible update. Failed/cancelled/timeout/rejected attempts preserve pending evidence and last valid state.

## Teaching semantics and reducer

Alpha supports Board RECONSTRUCT, REPRESENT and bounded AUGMENT; Cue supports RECONSTRUCT/REPRESENT only. Autonomous CORRECT and INITIATE remain disabled.

- **RECONSTRUCT** restores an intended speech/notation object without adding a proposition.
- **REPRESENT** changes form while preserving proposition set, negation, conditions, direction, uncertainty, scope and quantities.
- **AUGMENT** must be permitted, useful Board enrichment with honest domain/state provenance. Never attribute unspoken knowledge to speech or leak an answer into unresolved learner work.
- Explicit teacher self-correction is a current-evidence correction transition that invalidates superseded error. Suspected error without explicit correction does not authorize autonomous correction; KEEP and optional diagnostics remain available.

Board content is TEXT, FOCUS, RELATION (cause/sequence/contrast) or TRANSFORM. Same focal object with detachable detail uses ADD_SUPPORT; new focal object in the same topic uses SET_ACTIVE/same_thread; a topic shift uses topic_shift. Truth-critical conditions belong in the qualified proposition, not disposable detail.

SET_ACTIVE establishes a new item. Topic shift clears previous context. Same-thread retention is explicit and bounded; correction invalidates named prior items. ADD_SUPPORT targets an existing Active or Retained owner, ignores exact same mode/content duplicates and retains at most two newest Supports globally. RETIRE_ACTIVE requires the actual target and current evidence of moved-on/completed/no-longer-current: retain moves it to Retained; discard removes it. Support survives only with an existing owner. Retained-only Board is valid. Silence, filler, runtime lag and elapsed time never expire Board.

Cue is teacher-originated learner activity: NOTE, unresolved QUESTION, imperative TASK, or teacher-supported HINT. Board display/enrichment intent is not automatically learner work. A question inside an imperative remains TASK; a teacher-labelled hint remains HINT. Do not invent classroom instructions or copy learner-action wording onto Board without an independent teaching proposition.

SET cannot overwrite unresolved TASK/QUESTION. ATTACH_HINT targets the actual TASK/QUESTION and preserves its identity/activation. Standalone HINT uses SET. RESOLVE_CURRENT requires current answered/completed/moved-on/replaced evidence. REPLACE_CURRENT atomically resolves and establishes a current teacher-originated replacement. Resolving/replacing removes the subordinate hint. Board changes never resolve Cue and Cue resolution never clears Board. NOTE expires through the browser timer and a persisted expiry event; CLI replay does not simulate that timer.

Revisions advance only on actual channel changes. Reducer capacity and literal duplicate suppression are mechanical; they do not decide semantic necessity. Classification-definition retention is an open policy/model investigation in the baseline, not a new reducer rule.

## Scheduling and failure recovery

The scheduler preserves all pending evidence in order. New arrivals do not abort in-flight work or enlarge a failed prefix. A retry may shrink its pinned prefix. Oversized single-checkpoint requests pause with evidence intact; do not silently drop context/evidence or increase budget.

Provider/network/timeout failures allow at most two automatic retries; three consecutive failures pause. Validation/budget rejection pauses immediately. Conflicts rebuild with bounded retries. Cancellation does not degrade a replacement runtime. Explicit Resume interpretation releases a pause. Async success/failure/finally/retry work is scoped to session/runtime/run generation; replacement/close invalidates it. Later speech alone is not staleness.

Provider deadlines are independent of checkpoint boundaries and do not race durable persistence after a response. Pending count, oldest age, failure count and in-flight age are health diagnostics, not learner truth. No rolling transcript fallback or Board TTL hides backlog.

## Learner surface and diagnostics

Normal `/session` does not auto-mount canonical transcript. Presentationless Board is the primary canvas; overlay keeps presentation primary. Layout density may intentionally hide Support/Retained nodes. Render the published state; intermediate steps within atomic batch acceptance need not each appear.

Trace and latency are bounded, credential-safe, asynchronous diagnostics. Official PCM handoff remains direct and first; a separate listener records only sample-count/time metadata after transport. No PCM scan/storage or awaited trace I/O enters the path. Correlation runs from speech/final/checkpoint/request through accepted events and Board/Cue revisions to affected item IDs and renderId.

Speech timing is PCM-delivery-referenced, not physical capture time. DOM visibility is post-frame CSS/viewport observation, not physical pixels, occlusion or attention. Null/hidden/KEEP/superseded/gap observations must not become invented latency. Server duration and browser timestamps use separate clocks. Full field definitions and export behavior live in the [trace contract](TRACE_ARCHITECTURE_V2.md); manual measurement steps live in the [replay runbook](LESSON_TRANSCRIPT_REPLAY.md).

## Verification obligations

Stable identifiers name requirements, not claimed passes:

| IDs | Current obligation |
| --- | --- |
| LOG-01–05 | Persist checkpoints and KEEP; exact replay; attempts excluded; idempotent event identity. |
| WIN-01–05 | Explicit session end; immutable committed evidence; no speculative open-span interpretation; lossless ordered batching and exact coverage. |
| CTX-01–05 | Audited selected history/current state/current batch; state authority; current triggers; no raw word/provider payload; explicit bounded projection/blocking. |
| SCH-01–06 | Single flight; arrivals do not abort; failures do not consume; independent deadline; generation-scoped staleness; whole-request conflict rejection. |
| STA-01–05 | Deltas; explicit correction invalidation; independent Board/Cue; change-only revisions; bounded Support/Retained. |
| SUR-01–05 | No automatic transcript; mode-appropriate layout; final batch state; last valid surface on failure. |
| E2E-01–04 | Real evidence → accepted events → correlated learner surface; reload without provider. |
| E2E-05 | Bounded trace queues and explicit gaps; full safe audit facts are not silently dropped to satisfy a fixed bytes/minute target. |
| SEM-01–07 | Selected capabilities; current triggers and attribution; faithful reconstruction/representation; controlled augmentation; coherent Board transitions; teacher-originated Cue. |
| SEM-08–10 | Frozen safety/quality gates, exact evaluation identity and separately verified real-session evidence; offline passes do not certify live behavior. |

These requirements replace contradictory historical amendments. Current tests, benchmark validation and build are engineering checks; real browser/audio acceptance remains separately evidenced. Changing model, policy, schema, deadlines, retries, batching or capacity requires a scoped review, not an experiment-driven silent fix.
