# CueLayer Live Teaching System Specification

**Version:** v0.1  
**Status:** PR12–PR13 execution baseline  
**Date:** 2026-09-02  
**Scope:** single-session live teaching: speech evidence, stream processing, LLM interpretation, Teaching State, Teaching Board, Teaching Cue, and learner rendering.

This document is the execution authority for CueLayer's live teaching system. It is subordinate to `docs/PRODUCT_CHARTER.md`, but supersedes older live-planner implementation descriptions, PR descriptions, fixtures, and code comments where they conflict with this design.

## 0. Authority and migration

1. `docs/PRODUCT_CHARTER.md` remains the highest product authority.
2. This document is the single execution authority for live teaching dataflow, state, windows, LLM context, PR12, and PR13.
3. It supersedes the live product model in `docs/TEACHING_STATE_PLANNER.md`, specifically the semantic-subtitle model built around recent bounded speech, transient `CaptionEpisode`, and the 2.5-second live budget.
4. `docs/TEACHING_CUE_LAYER.md` remains authoritative for the Board/Teaching Cue visual and lifecycle contracts, except that its deferred-live-integration boundary is now owned by this document.
5. `CaptionRenderer`, FX Lab, Showcase, and existing FOCUS/RELATE/TRANSFORM renderer assets may remain as laboratories. They no longer define the normal `/session` learner-facing runtime.
6. PR descriptions explain implementation against this document; they do not redefine the system.

If code and this document disagree, update this document intentionally before changing product semantics.

---

## 1. Execution model

CueLayer uses:

> **append-only Lesson Event Log + deterministic materialized Teaching State + pending evidence tail + lossless LLM context projection.**

The system preserves four categories of information without collapsing them into one ambiguous "context":

| Concept | Formal object | Retention | PR12 baseline LLM input |
|---|---|---:|---:|
| Everything that has happened so far | `ProcessedLessonTimeline` | persistent | yes, compact projection |
| Previously accepted LLM work | `AcceptedInterpretationLog` | persistent | yes |
| Current authoritative product state | `TeachingStateSnapshot` | materialized from events | yes |
| Current unprocessed speech window | `PendingInterpretationBatch` | until accepted | yes |
| Which of the above the model should receive | `ContextProjectionPolicy` | evaluated | P4 baseline in PR12; ablation in PR13 |

Core rules:

1. **Lossless retention does not mean raw-data replay in every prompt.** Persist facts and accepted decisions; project compact model context.
2. **Historical authority and current authority are separate.** Event history says what happened; Teaching State says what remains true and visible now.
3. **The model proposes deltas, never a replacement whole state.** Deterministic reducers own state accumulation.
4. **New evidence is the only trigger for new state changes.** Old history may explain references and continuity but may not spontaneously reactivate content.

```text
                    Lesson Event Log
                  append-only / replayable
       ┌──────────────────┼──────────────────┐
       │                  │                  │
Speech Evidence   Accepted Interpretation   Runtime Events
       │                  │             cue expiry / override
       └──────────────────┼──────────────────┘
                          │
               deterministic reducer
                          ▼
                 Teaching State
               current materialized view
                          │
                          ▼
                 Learner Surface

New committed evidence
          │
          ▼
Pending Interpretation Batch
          │
          ▼
Context Assembler
(processed timeline + current state + new evidence)
          │
          ▼
LLM proposes ordered minimal deltas
          │
          ▼
schema / grounding / concurrency validation
          │
          ▼
Accepted Interpretation Events appended to log
```

---

## 2. Goals and non-goals

### Goals

The system must:

- retain and replay a full lesson's speech evidence;
- retain earlier accepted LLM interpretations even after current state changes;
- deterministically reconstruct current Teaching State from the lesson event log;
- never lose unprocessed evidence because of planner coalescing;
- allow each LLM call to use full lesson context while returning only bounded deltas;
- never treat later speech alone as a reason an otherwise valid request is stale;
- render Teaching State, not rolling transcript, on the normal learner surface;
- let Board and Teaching Cue evolve independently;
- preserve the last valid learner surface through timeout, invalid output, ASR ambiguity, provider failure, or trace failure;
- trace the full evidence → interpretation → accepted delta → state → render chain.

### Non-goals for PR12–PR13

Do not add:

- Kafka, Flink, or distributed stream infrastructure;
- RAG, vector retrieval, or lossy rolling summaries for a single lesson;
- provider-side conversation memory as the only lesson memory;
- model-authored whole Teaching State;
- arbitrary LaTeX or full chemical structure/mechanism generation;
- slide OCR, slide understanding, or spatial grounding;
- post-lesson summary, student model, or cross-lesson knowledge graph;
- model-invented hints, answers, or teaching claims.

---

## 3. Three authorities

### 3.1 Historical authority — Lesson Event Log

Answers: what happened, what evidence was processed, and what interpretation the system accepted at that time.

Properties:

- append-only;
- correction, topic shift, and cue resolution never rewrite old events;
- supports replay, audit, and offline evaluation;
- old errors may remain in history but lose current effect through later accepted invalidation/correction events.

### 3.2 Current authority — Teaching State Snapshot

Answers: what is currently valid, visible, retained, or unresolved.

Properties:

- deterministically reduced from the event log;
- may delete, retire, replace, or invalidate prior materialized content;
- current state overrides contradictory older accepted history;
- never supplied wholesale by the model.

### 3.3 Diagnostic authority — Interpretation Attempt Trace

Answers why a request timed out, failed validation, became genuinely stale, or failed to render.

Properties:

- may contain bounded provider/model attempt diagnostics;
- does not participate in Teaching State replay;
- rejected model output never becomes product truth;
- can reuse PR8 persistence primitives but not PR8 trace retention semantics.

---

## 4. Domain model

### 4.1 Lesson Session

```ts
type LessonSession = {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  status: "active" | "paused" | "ended";
  lessonSequence: number;
};
```

A lesson starts and ends through explicit user action. Silence, waiting for students, presentation interruption, planner failure, or speech reconnect do not end the lesson. Reload may resume the same local session. "Start another session" creates a new session identity.

### 4.2 Compact Evidence Checkpoint

Model input uses compact immutable evidence:

```ts
type CompactEvidenceCheckpoint = {
  checkpointId: string;
  lessonSequence: number;
  speechRunId: number;
  startMs: number;
  endMs: number;
  text: string;
  sourceFinalIds: string[];
  warnings: SpeechEvidenceWarning[];
};
```

Word-level grounding stays local:

```ts
type GroundingRecord = {
  checkpointId: string;
  canonicalSpanIds: Array<{
    spanId: string;
    spanRevision: number;
  }>;
  words: SpeechWord[];
  providerEvidence: ProviderEvidenceRef[];
};
```

Do not repeatedly send the full lesson's word timings/provider JSON to the model. The model returns grounded references; the validator resolves them through the local grounding index.

### 4.3 Accepted Interpretation Step

One request may consume several pending checkpoints, so output is an ordered sequence of steps:

```ts
type AcceptedInterpretationStep = {
  interpretationId: string;
  requestId: string;
  stepIndex: number;
  consumesCheckpointIds: string[];
  baseBoardRevision: number;
  baseCueRevision: number;
  boardDelta: BoardDelta;
  cueDelta: TeachingCueDelta;
  evidenceRefs: GroundedReference[];
  warnings: InterpretationWarning[];
  model: string;
  policyVersion: string;
  acceptedAt: string;
};
```

Rules:

- consumed IDs must be ordered, contiguous IDs from the current batch that have not already been consumed;
- all checkpoints in the request must be covered exactly once;
- steps reduce in order;
- each step persists in the domain log;
- the normal learner surface renders only the final reduced state of the accepted batch, preventing backlog flicker;
- intermediate states remain replayable for diagnostics.

### 4.4 Teaching State Snapshot

```ts
type TeachingStateSnapshot = {
  lessonRevision: number;
  processedThroughSequence: number;
  board: {
    revision: number;
    active?: BoardItem;
    support: BoardSupport[];
    retained: BoardItem[];
  };
  cue: {
    revision: number;
    active?: ActiveTeachingCue;
  };
};
```

State is produced by deterministic reduction:

```ts
stateN = reduceLessonEvents(stateNMinus1, acceptedEventN);
```

Never:

```ts
stateN = modelGeneratedWholeState;
```

### 4.5 Pending Interpretation Batch

```ts
type PendingInterpretationBatch = {
  checkpointIds: string[];
  firstSequence: number;
  lastSequence: number;
  estimatedTokens: number;
};
```

This is the ordered set of committed evidence not yet consumed by an accepted interpretation.

Rules:

- pending evidence is never replaced by "latest only";
- the scheduler may group multiple checkpoints into the next batch;
- if the batch exceeds a request cap, process the earliest ordered prefix and leave the rest pending;
- timeout, malformed output, invalid grounding, or state conflict do not consume evidence;
- accepted KEEP does consume evidence because it records a valid interpretation: the system saw it and intentionally did not change state.

---

## 5. Lesson Event Log

### Domain events

```ts
type LessonEvent =
  | {
      type: "lesson.started";
      eventId: string;
      sessionId: string;
      sequence: number;
      timestamp: string;
    }
  | {
      type: "evidence.checkpoint_committed";
      eventId: string;
      sessionId: string;
      sequence: number;
      checkpoint: CompactEvidenceCheckpoint;
    }
  | {
      type: "interpretation.step_accepted";
      eventId: string;
      sessionId: string;
      sequence: number;
      step: AcceptedInterpretationStep;
    }
  | {
      type: "teaching_cue.expired";
      eventId: string;
      sessionId: string;
      sequence: number;
      cueId: string;
      baseCueRevision: number;
    }
  | {
      type: "teacher_override.applied";
      eventId: string;
      sessionId: string;
      sequence: number;
      operation: TeacherOverride;
    }
  | {
      type: "lesson.ended";
      eventId: string;
      sessionId: string;
      sequence: number;
      timestamp: string;
    };
```

`teacher_override.applied` may be contract-only during PR12/PR13; no teacher editing UI is required.

### Diagnostic-only events

Do not place these in the replayable domain log:

- ASR partials;
- raw audio acknowledgements;
- raw LLM output or hidden reasoning;
- timeout attempts;
- malformed structured output;
- grounding validation failure;
- rejected/stale proposals;
- network exceptions;
- renderer measurements.

### Idempotency

- every domain event has a globally unique `eventId`;
- each checkpoint is consumed by at most one accepted interpretation step;
- the same `requestId + stepIndex` appends at most once;
- reducer safely ignores duplicate events;
- reload/replay never invokes the model;
- replaying the same event sequence yields structurally equal Teaching State.

### Storage boundary

PR12 is local-first:

- reuse PR8 IndexedDB connection/writer primitives where useful;
- use a distinct product-domain store/schema;
- domain retention must not inherit bounded diagnostic trace retention;
- state-changing domain events must never be dropped because a trace forwarding queue is bounded;
- never persist raw PCM;
- no remote database in this phase.

---

## 6. Four window layers

CueLayer does not have one ambiguous "session window". It has four separate boundaries.

### Window A — Lesson Session

Defines the complete history boundary.

```text
Start session ───────────────────────── End session
```

Only explicit user actions start/end it. A 900ms pause, 30-second student wait, presentation end, planner failure, or speech reconnect does not end the lesson.

### Window B — Evidence Checkpoint

Turns mutable ASR/canonical speech into an immutable interpretation unit.

Phase 1 commit trigger:

```text
provider terminal punctuation / EOS
              OR
meaningful inactivity after lexical content
              OR
max lexical duration
              OR
max lexical size
```

Initial engineering defaults:

| Parameter | Phase 1 default | Status |
|---|---:|---|
| Meaningful inactivity | 900 ms | dogfood-adjustable |
| Max lexical duration | 6.5 s | dogfood-adjustable |
| Max lexical words | 28 | dogfood-adjustable |

Phase 1 explicitly forbids:

- open spans automatically triggering speculative LLM calls every 2.5 seconds;
- editing a checkpoint's speech snapshot after commit;
- treating later speech as invalidating an immutable committed checkpoint.

Punctuation:

- punctuation arriving before checkpoint commit may attach to the open canonical span;
- formatting-only punctuation arriving after commit does not reopen semantic interpretation;
- later lexical correction becomes new evidence;
- committed checkpoints are immutable.

### Window C — Interpretation Batch

Defines the next unprocessed evidence tail the model will consume.

```text
checkpoint A
    │
    ▼
request A ───────────────────→ result A
         B, C, D arrive
                               │
                               ▼
                         request [B, C, D]
```

Rules:

- one request in flight per active speech run;
- new checkpoints append to pending tail;
- new speech never aborts the current request;
- after settlement, process the earliest ordered pending prefix;
- several checkpoints may produce ordered interpretation steps;
- never drop B/C in favour of latest-only D;
- if a cue is created and resolved inside one backlog batch, preserve both domain events but render only the batch's final state.

### Window D — Context Projection

Defines what already-retained information is included in a model request. It changes prompt projection, not retention.

PR12 uses the lossless baseline:

```text
P4 = E + J + S + W

E = processed speech evidence
J = accepted interpretation journal
S = current Teaching State snapshot
W = current unprocessed evidence batch
```

Only PR13 may choose a smaller normal policy after controlled ablation.

---

## 7. Context Assembler

### PR12 request envelope

```ts
type TeachingInterpretationRequest = {
  requestId: string;
  sessionId: string;
  policyVersion: string;
  processedTimeline: ProcessedTimelineEntry[];
  currentState: TeachingStateSnapshot;
  newEvidence: CompactEvidenceCheckpoint[];
  expected: {
    firstUnconsumedSequence: number;
    lastUnconsumedSequence: number;
  };
};
```

Compact processed timeline:

```ts
type ProcessedTimelineEntry =
  | {
      type: "evidence";
      checkpointId: string;
      sequence: number;
      text: string;
      warnings: SpeechEvidenceWarning[];
    }
  | {
      type: "accepted_interpretation";
      interpretationId: string;
      consumesCheckpointIds: string[];
      boardDelta: CompactBoardDelta;
      cueDelta: CompactTeachingCueDelta;
      resultingBoardRevision: number;
      resultingCueRevision: number;
    };
```

Do not send:

- raw provider JSON;
- word timing arrays;
- raw model prose/reasoning;
- CSS/layout/render state;
- repeated policy text inside each historical event;
- diagnostic attempt history.

### Prompt authority order

The model must be told explicitly:

1. policy is behavioural authority;
2. processed timeline is history and may contain claims later corrected;
3. current state is current authority and overrides contradictory old history;
4. new evidence is the only source allowed to trigger new deltas;
5. history may resolve references/relations, but every non-KEEP step must be triggered by at least one checkpoint it currently consumes;
6. output must cover all new evidence exactly once, in order;
7. uncertainty yields KEEP/warning, never invented teaching content.

### Prompt ordering

Use:

```text
1. stable policy / schema
2. processed lesson timeline
3. current authoritative state
4. new evidence batch
5. exact output instruction
```

History and state are intentionally both present: history says what happened; state says what remains valid now.

### Token policy

For a single Alpha lesson, preserve and project the complete compact processed timeline. Do not add retrieval or summary.

Record:

- projected input tokens;
- policy tokens;
- processed timeline tokens;
- current state tokens;
- new evidence tokens;
- cached input tokens;
- output tokens;
- latency;
- estimated cost.

If a request approaches provider context limits, fail explicitly and trace it. PR12/PR13 must never silently truncate lesson history.

---

## 8. LLM output contract

### Batch proposal

```ts
type TeachingInterpretationProposal = {
  requestId: string;
  baseBoardRevision: number;
  baseCueRevision: number;
  steps: TeachingInterpretationStepProposal[];
  warnings?: InterpretationWarning[];
};

type TeachingInterpretationStepProposal = {
  consumesCheckpointIds: string[];
  boardDelta: BoardDelta;
  cueDelta: TeachingCueDelta;
  evidenceRefs: GroundedReference[];
  warnings?: InterpretationWarning[];
};
```

### BoardDelta

```ts
type BoardDelta =
  | {
      action: "KEEP";
      reason:
        | "filler"
        | "transition"
        | "repetition"
        | "unfinished"
        | "insufficient_evidence"
        | "ambiguous_reference"
        | "classroom_management"
        | "no_board_value";
    }
  | {
      action: "SET_ACTIVE";
      content: BoardContent;
      continuity: "same_thread" | "topic_shift" | "correction";
      retainPrevious: boolean;
      support?: GroundedReference[];
      invalidatesBoardItemIds?: string[];
    }
  | {
      action: "ADD_SUPPORT";
      support: GroundedReference;
      targetBoardItemId: string;
    };
```

Deterministic rules:

- correction forces `retainPrevious = false`;
- an explicit correction target must be invalidated;
- topic shift lets the reducer retire previous support/context;
- ADD_SUPPORT requires an existing target;
- RETAINED is a runtime role decided by deterministic reduction, not a model-authored screen coordinate;
- KEEP contains no learner-visible content.

### BoardContent

```ts
type BoardContent =
  | { kind: "TEXT"; source: GroundedReference }
  | { kind: "FOCUS"; target: GroundedReference }
  | {
      kind: "RELATION";
      relation: "cause" | "sequence" | "contrast";
      targets: GroundedReference[];
    }
  | {
      kind: "TRANSFORM";
      from: GroundedReference;
      to: GroundedReference;
    };
```

No model-authored free prose, React, HTML, CSS, layout, timing, animation, or TeX in PR12/PR13.

### TeachingCueDelta

```ts
type TeachingCueDelta =
  | { action: "KEEP" }
  | {
      action: "SET";
      cueKind: "QUESTION" | "TASK" | "NOTE" | "HINT";
      source?: GroundedReference;
      targetBoardItemId?: string;
    }
  | {
      action: "RESOLVE_CURRENT";
      reason: "answered" | "completed" | "teacher_moved_on" | "replaced";
      evidence: GroundedReference;
    };
```

Alpha defaults:

- QUESTION/TASK/HINT persist;
- NOTE expires deterministically;
- Board changes never resolve a cue by themselves;
- cue resolution never clears Board;
- an instruction containing a question is one TASK, not competing TASK + QUESTION;
- HINT must come from teacher speech;
- one visible active cue remains the Alpha default; TASK + transient HINT is a PR13 evaluation question.

---

## 9. Validation and acceptance pipeline

Raw model output never mutates product state directly.

```text
raw proposal
    ↓
JSON/schema validation
    ↓
batch coverage validation
    ↓
checkpoint ordering validation
    ↓
exact grounding validation
    ↓
new-evidence trigger validation
    ↓
Board/Cue domain validation
    ↓
channel revision conflict validation
    ↓
normalize
    ↓
append accepted steps
    ↓
reduce Teaching State
```

### Batch coverage

- output covers every `newEvidence` checkpoint exactly once;
- consumed IDs are contiguous and ordered as input;
- no checkpoint from another session or future batch may be referenced;
- empty step list is invalid.

### Grounding

- learner-visible references must exact-locate through local grounding records;
- relation/transform may use historical evidence plus the current batch;
- every non-KEEP step must contain at least one trigger reference from checkpoints it consumes now;
- historical evidence cannot establish a new Board object without a current trigger;
- critical ASR warning defaults to KEEP unless clear evidence resolves the ambiguity.

### KEEP semantics

Accepted KEEP is a real interpretation event:

- it is persisted;
- it consumes its checkpoints;
- it does not increment Board/Cue revision;
- it advances processed sequence;
- its trace contains an explicit reason.

### Channel revisions and conflicts

Each request stores:

```ts
{
  requestId,
  speechRunId,
  baseBoardRevision,
  baseCueRevision,
  checkpointIds
}
```

At settlement:

- ended session or changed speech run rejects the full proposal as stale;
- unchanged Board revision permits Board application;
- unchanged Cue revision permits Cue application;
- a changed channel plus KEEP is safe;
- a changed channel plus a modifying delta conflicts for that channel and must be rebuilt on latest state;
- the other non-conflicting channel may still be accepted;
- later speech alone is not a conflict;
- trace/UI/presentation changes never alter teaching revisions.

---

## 10. Scheduler and failure semantics

### One request in flight

- at most one interpretation request per active speech run;
- pending evidence may continue to accumulate;
- newer checkpoints never abort the current request;
- after settlement, build the next request from the earliest ordered pending prefix;
- do not run concurrent requests against the same Teaching State revision.

### Latency contracts are separate

| Parameter | Phase 1 default | Meaning |
|---|---:|---|
| Evidence boundary | punctuation / pause / 6.5 s / 28 words | create immutable evidence |
| Planner latency SLO | p95 ≤ 3000 ms | experience target, not cancellation |
| Hard deadline | 6000 ms | abort a request attempt |

Do not equate checkpoint cadence with the hard deadline.

### Failure semantics

| Result | Evidence consumed? | Surface/state | Next action |
|---|---:|---|---|
| Timeout | no | keep last valid | pending remains |
| Network/provider failure | no | keep | backoff; no immediate unbounded retry |
| Malformed output | no | keep | rebuild from latest state |
| Invalid grounding | no | keep | preserve pending; may combine with newer evidence |
| State conflict | conflicting channel: no | non-conflicting channel may apply | rebuild conflict on latest state |
| Accepted KEEP | yes | unchanged | continue |
| Accepted change | yes | deterministic reduce | render final batch state |

Forbidden:

- silently marking timed-out evidence processed;
- unbounded immediate retry;
- mounting transcript as provider-failure fallback;
- dropping earlier pending checkpoints during coalescing.

### Backpressure diagnostics

Trace:

- pending checkpoint count;
- oldest pending age;
- pending token estimate;
- consecutive failures;
- accepted throughput;
- request utilization.

If backlog grows, learner surface stays on the last valid Teaching State; debug reports degradation instead of hiding it with rolling transcript.

---

## 11. Deterministic Teaching State reducer

### Board

```text
KEEP
→ unchanged

ADD_SUPPORT
→ validate target
→ exact deduplicate
→ append within bounded support policy

SET_ACTIVE / same_thread
→ optionally move previous Active to Retained
→ set new Active
→ reset/replace Support as specified by accepted delta

SET_ACTIVE / topic_shift
→ retire previous Active + Support
→ clear/bound Retained by Alpha policy
→ set new Active

SET_ACTIVE / correction
→ invalidate contradicted items
→ never retain corrected error
→ set corrected Active
```

Alpha bounds:

- Support ≤ 2;
- Retained ≤ 2;
- exact duplicate adds nothing;
- overflow retires via deterministic relevance/recency policy;
- KEEP never reorders content.

### Teaching Cue

```text
KEEP
→ active cue unchanged

SET
→ validate source/kind
→ replace current visible cue
→ NOTE receives deterministic expiry
→ QUESTION/TASK/HINT do not auto-expire

RESOLVE_CURRENT
→ require active cue
→ require grounded resolution evidence
→ clear cue
```

### Revisions

- Board revision increments only when Board materially changes;
- Cue revision increments only when Cue materially changes;
- lesson revision increments on accepted state-changing events;
- accepted KEEP advances processed cursor without fabricating a surface revision;
- replay must reproduce identical revisions.

---

## 12. Learner surface

Normal `/session`:

```text
TeachingStateSnapshot
       │
       ▼
TeachingSurfaceLayer
   ┌───────────────┐
   ▼               ▼
BoardLayout   TeachingCueLayer
```

Hard rules:

- canonical/provisional transcript appears only on explicit debug surfaces;
- normal session never auto-creates canonical `CaptionEpisode` fallback;
- without presentation, Board is the primary canvas;
- with presentation, presentation remains primary and Board uses the essential safe region;
- Board and Cue are sibling channels with independent state/lifecycle;
- Board update does not clear Cue;
- Cue resolution does not clear Board;
- planner failure preserves last valid state;
- no prior state + planner failure means visual quiet;
- normal live session removes Space-to-lock-caption behaviour;
- accepted backlog batch renders final state once rather than flickering through intermediate steps;
- render events include resulting Board/Cue revisions.

Old Caption runtime remains available to FX Lab, Showcase, and renderer tests. FOCUS/RELATE/TRANSFORM representation assets may be reused by Board compilation, but their lifetime is controlled by Teaching State rather than a fixed five-second episode.

---

## 13. Trace taxonomy

Domain events are replayable product facts. Trace is execution evidence. Trace may observe domain events but never replaces them.

Required correlation chain:

```text
sessionId
→ lessonSequence
→ speechRunId
→ providerFinalId
→ canonicalSpanId + revision
→ checkpointId
→ interpretationRequestId
→ interpretationId / stepIndex
→ BoardRevision / CueRevision
→ boardItemId / cueId
→ renderId
```

Required trace families:

Evidence:

- `evidence.checkpoint_opened`
- `evidence.checkpoint_committed`
- `evidence.checkpoint_pending`

Interpretation:

- `interpretation.request_started`
- `interpretation.request_completed`
- `interpretation.request_timeout`
- `interpretation.output_rejected`
- `interpretation.channel_conflict`
- `interpretation.step_accepted`

State:

- `board.keep`
- `board.active_set`
- `board.support_added`
- `board.context_retained`
- `board.context_retired`
- `board.content_invalidated`
- `teaching_cue.keep`
- `teaching_cue.set`
- `teaching_cue.resolved`
- `teaching_cue.expired`

Render:

- `teaching_surface.rendered`
- `teaching_surface.layout_changed`
- `teaching_surface.render_failed`

Context/cost:

- `context_projection.created`
- component token counts;
- cache hits/writes;
- output tokens;
- provider/server/browser latency.

`canonical_speech_mounted` must not be a normal successful learner-render reason after PR12.

---

## 14. Context policy evaluation — PR13

PR12 uses P4 as the lossless baseline. PR13 runs the same stateful sequence corpus under:

| Policy | Input | Purpose |
|---|---|---|
| P0 | `W` | stateless lower bound |
| P1 | `S + W` | test whether current state is usually enough |
| P2 | `E + W` | raw history without accepted journal |
| P3 | `E + S + W` | full evidence + current authority |
| P4 | `E + J + S + W` | lossless historical upper baseline |

Where:

- `E` = processed evidence;
- `J` = accepted interpretation journal;
- `S` = current Teaching State;
- `W` = new evidence batch.

A smaller policy may become normal only if it passes every critical safety gate and remains within a predefined tolerance of P4 on state-transition and cue-lifecycle accuracy.

If P4 clearly beats P3, first inspect whether Teaching State is missing necessary semantic fields such as correction lineage, source IDs, teaching thread, or cue origin. Improve the state schema before permanently depending on raw model-response history.

Before PR13 evaluation, do not add adaptive retrieval, rolling summary, heuristic full-context escalation, state-only fast paths, or provider conversation memory as the source of truth.

---

## 15. Stateful evaluation corpus

At minimum include:

1. definition → support;
2. definition → causal relation;
3. task → multiple Board updates → task persists;
4. question → later explicit answer → resolve;
5. immediately answered rhetorical question → no transient QUESTION;
6. incorrect assertion → explicit correction → old error invalidated;
7. ambiguous correction target → KEEP/warning;
8. explicit topic shift;
9. older concept referenced after 5–15 minutes;
10. pronoun referring to earlier Board content;
11. prior accepted KEEP cannot later be duplicated without new evidence;
12. critical ASR ambiguity → no unsafe Board change;
13. NOTE expiry while Board request is in flight;
14. several pending checkpoints produce ordered steps;
15. task issued and resolved inside one backlog batch;
16. planner failure leaves checkpoint pending;
17. reload → event replay → identical state;
18. new speech during request → current result remains valid;
19. presentation mode change without teaching-state revision;
20. correction history remains auditable but not learner-visible.

Critical gates:

| Metric | Gate |
|---|---:|
| Ungrounded learner-visible content | 0 |
| Invented HINT / answer | 0 |
| Corrected error remains Active/Retained | 0 |
| Persistent TASK/QUESTION resolves early | 0 |
| Unconsumed checkpoint loss | 0 |
| Duplicate checkpoint consumption | 0 |
| Later speech alone causes stale | 0 |
| Replay mismatch | 0 |
| Structured parse | 100% |
| State transition accuracy | PR13 target ≥95% |
| Cue lifecycle accuracy | PR13 target ≥95% |
| Successful provider response accepted or explicitly channel-conflicted | near 100% |
| Trace volume | <1 MB/min |
| Normal raw transcript mounts | 0 |

---

## 16. Implementation plan

### Precondition — finish PR8

PR8 is infrastructure only:

- local durable diagnostic trace;
- session identity;
- audio delivery summary;
- PCM health;
- device diagnostics;
- punctuation/empty lexical boundary;
- JSONL export.

PR8 does not solve Teaching State or the live learner surface. Start PR12 after PR8 is integrated with latest `main`.

### PR12 — Lossless Lesson Stream → Live Teaching Surface

**Title:** `feat: make lossless lesson interpretation drive the live teaching surface`

PR12 must be dogfoodable end to end.

#### Slice A — Domain log and replay

Suggested directory:

```text
src/lesson-stream/
  events.ts
  evidence-checkpoints.ts
  accepted-interpretations.ts
  pending-evidence.ts
  teaching-state.ts
  replay.ts
  context-projection.ts
```

Implement:

- domain event schema;
- compact evidence + local grounding index;
- accepted KEEP log;
- checkpoint consumption index;
- deterministic replay;
- independent IndexedDB domain store;
- reload recovery.

#### Slice B — Interpretation contract and context assembler

Implement:

- P4 request envelope;
- ordered-steps output schema;
- exact batch coverage validator;
- exact grounding validator;
- new-evidence trigger validator;
- no raw word timing in prompt;
- token/cost projection trace.

#### Slice C — Scheduler

Implement:

- one request in flight;
- preserve every pending checkpoint;
- earliest-prefix batching;
- no abort on newer speech;
- 6000ms hard deadline;
- failures do not consume evidence;
- per-channel revision conflicts;
- pending/backpressure diagnostics.

#### Slice D — Teaching State and live surface

Implement:

- deterministic Board/Cue reducer;
- `/session` uses `TeachingSurfaceLayer`;
- reuse `BoardLayout` and `TeachingCueLayer`;
- remove canonical fallback from normal learner surface;
- remove normal Space caption lock;
- retain old Caption runtime only as laboratory;
- full domain/state/render correlation.

#### PR12 hard gate

A real microphone `/session` run must demonstrate:

```text
speech
→ committed checkpoints
→ P4 interpretation request
→ accepted ordered steps
→ replayable Teaching State
→ stable Board/Cue render
```

And must include:

- at least one accepted KEEP;
- at least one Board set/update;
- at least one support or retained transition;
- one TASK/QUESTION that survives a Board update;
- explicit cue resolution;
- new speech does not abort current request;
- model response within 6000ms is not made stale merely by later speech;
- timeout leaves evidence pending;
- reload recreates equivalent state;
- normal transcript mount = 0;
- trace <1 MB/min.

Fixtures, synthetic injection, unit tests, or CI green alone cannot give PR12 PASS.

### PR13 — Stateful Semantics + Context Ablation

PR13 does not rebuild stream infrastructure. It focuses on:

1. multi-turn teaching sequence corpus;
2. board-worthiness;
3. Support vs new Active;
4. same-thread / topic-shift / correction;
5. cue persistence / resolution;
6. older-reference recovery;
7. ambiguity → KEEP;
8. P0–P4 context ablation;
9. selecting the smallest safe normal context policy;
10. updating this document with the resulting policy decision.

PR13 explicitly does not include ASR provider/config optimisation, live equation/reaction generation, slide understanding, RAG, arbitrary paraphrase, or broad visual redesign.

### PR13 — Speech Evidence Quality

After the processing model is stable:

- `en` vs `cmn_en` A/B;
- Chemistry/domain vocabulary;
- critical entity/negation/instruction-verb errors;
- checkpoint semantic completeness;
- ambiguity warnings;
- known-WAV + real-microphone evaluation.

### PR13 — Structured Teaching Objects

After state and grounding are stable:

- bounded EquationSpec / ReactionSpec;
- speech evidence → structured object;
- deterministic compiler → existing KaTeX/mhchem renderer;
- no planner-authored TeX;
- notation failure isolated from Board/Cue state.

---

## 17. Acceptance IDs

Future PR descriptions must cite affected acceptance IDs.

### Domain log

- `LOG-01` All committed checkpoints persist.
- `LOG-02` Accepted KEEP persists and consumes checkpoints.
- `LOG-03` Replay yields identical Teaching State.
- `LOG-04` Diagnostic attempts do not affect replay.
- `LOG-05` Duplicate events are idempotent.

### Windows

- `WIN-01` Lesson session ends only explicitly.
- `WIN-02` Checkpoints become immutable after commit.
- `WIN-03` Open spans do not trigger speculative Phase 1 interpretation.
- `WIN-04` Pending batching preserves every checkpoint in order.
- `WIN-05` Batch steps cover all checkpoints exactly once.

### Context

- `CTX-01` P4 request includes compact E+J+S+W.
- `CTX-02` Current state is authoritative over historical state.
- `CTX-03` New evidence is the only state-change trigger.
- `CTX-04` Word timings/provider raw JSON are excluded from model context.
- `CTX-05` Context is never silently truncated.

### Scheduler

- `SCH-01` One request in flight.
- `SCH-02` New speech does not abort current request.
- `SCH-03` Failure does not consume evidence.
- `SCH-04` Hard deadline is independent from checkpoint boundaries.
- `SCH-05` Later speech alone cannot make a result stale.
- `SCH-06` Channel conflicts do not unnecessarily discard the other channel.

### State

- `STA-01` Model returns deltas, not whole state.
- `STA-02` Corrections invalidate old errors.
- `STA-03` Board and Cue evolve independently.
- `STA-04` Revisions advance only on actual changes.
- `STA-05` Support/Retained remain bounded.

### Surface

- `SUR-01` Normal session never auto-mounts canonical transcript.
- `SUR-02` Presentationless Board is primary canvas.
- `SUR-03` Overlay keeps presentation primary.
- `SUR-04` Batch backlog renders final state once.
- `SUR-05` Planner failure keeps last valid surface.

### End to end

- `E2E-01` Real mic evidence reaches accepted interpretation.
- `E2E-02` Accepted interpretation reaches replayable state.
- `E2E-03` State reaches learner surface with full correlation.
- `E2E-04` Reload restores state without re-invoking the model.
- `E2E-05` Trace stays below 1 MB/min.

---

## 18. Explicitly rejected alternatives

Current phase rejects:

1. recent six spans + active caption as the primary lesson context;
2. calling the LLM every 2.5 seconds regardless of evidence boundaries;
3. aborting current work whenever newer speech arrives;
4. latest-only pending coalescing that drops earlier unconsumed evidence;
5. model-authored replacement whole state;
6. retaining only current state but not accepted interpretation history;
7. raw model result as domain truth;
8. `previous_response_id` as the only lesson memory;
9. single-lesson rolling summary/RAG before evidence demands it;
10. rolling transcript learner fallback on planner failure;
11. diagnostic trace as the product event store;
12. declaring live-product PASS from CI green, fixture screenshots, or component tests alone.

---

## 19. Alpha defaults subject to later evidence

| Decision | Alpha default |
|---|---|
| Context policy | P4: E + J + S + W |
| Model output | ordered delta steps |
| Open-span interpretation | disabled |
| Checkpoint boundary | punctuation / 900ms pause / 6.5s / 28 words |
| Request concurrency | one in flight |
| Pending policy | preserve all, earliest-prefix batch |
| Hard deadline | 6000ms |
| Board Support limit | 2 |
| Board Retained limit | 2 |
| Visible active cue | 1 |
| QUESTION/TASK/HINT expiry | none |
| NOTE expiry | deterministic 4s |
| Free paraphrase | disabled |
| Planner failure fallback | last state or visual quiet |
| Single-lesson retrieval/summary | disabled |

These are engineering defaults, not immutable product truths. If evaluation contradicts one, update this specification with the evidence, replacement rule, and replacement acceptance gate before changing runtime semantics.

---

## 20. One-sentence system definition

> CueLayer preserves a lesson's speech evidence and accepted interpretations, deterministically materializes current Teaching State, asks the LLM only to interpret still-unprocessed evidence as validated ordered deltas, and renders the resulting state through a stable Teaching Board and Teaching Cue.
