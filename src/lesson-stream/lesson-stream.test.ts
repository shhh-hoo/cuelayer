import { describe, expect, it } from "vitest";
import type { CanonicalSpeechSpan } from "../session/speech-types";
import { validateAndNormalizeProposal } from "./accepted-interpretations";
import { buildTeachingInterpretationRequest } from "./context-projection";
import { checkpointFromClosedSpan } from "./evidence-checkpoints";
import { checkpointCommittedEvent, cueExpiredEvent, interpretationAcceptedEvent, lessonStartedEvent } from "./events";
import { LosslessInterpretationScheduler } from "./pending-evidence";
import { pendingEvidence, replayLessonEvents } from "./replay";
import { LessonStreamRuntime, type LessonEventStore } from "./runtime";
import { createInitialTeachingState } from "./teaching-state";
import type { AcceptedInterpretationStep, BoardDelta, CompactEvidenceCheckpoint, TeachingCueDelta } from "./contracts";

const span = (overrides: Partial<CanonicalSpeechSpan> = {}): CanonicalSpeechSpan => ({
  id: "speech-span-0",
  revision: 2,
  sourceFinalIds: ["provider-final-0"],
  text: "Activation energy is the minimum energy required.",
  words: [{ text: "Activation", startMs: 0, endMs: 100, confidence: 0.99 }],
  startMs: 0,
  endMs: 1_000,
  openedAtMs: 0,
  updatedAtMs: 1_000,
  status: "closed",
  closeReason: "terminal_punctuation",
  ...overrides,
});

const checkpoint = (id: string, sequence: number, text = `evidence ${id}`): CompactEvidenceCheckpoint => ({
  checkpointId: id,
  lessonSequence: sequence,
  speechRunId: 1,
  startMs: sequence * 100,
  endMs: sequence * 100 + 50,
  text,
  sourceFinalIds: [`final-${id}`],
  warnings: [],
});

const groundedEvent = (sessionId: string, eventSequence: number, item: CompactEvidenceCheckpoint) => checkpointCommittedEvent(sessionId, eventSequence, item, {
  checkpointId: item.checkpointId,
  canonicalSpanIds: [{ spanId: `span-${item.checkpointId}`, spanRevision: 1 }],
  words: [{ text: item.text, startMs: item.startMs, endMs: item.endMs }],
  providerEvidence: item.sourceFinalIds.map((providerFinalId) => ({ providerFinalId })),
});

const acceptedStep = (requestId: string, consumesCheckpointIds: string[], boardDelta: BoardDelta = { action: "KEEP", reason: "no_board_value" }, cueDelta: TeachingCueDelta = { action: "KEEP" }): AcceptedInterpretationStep => ({
  interpretationId: `${requestId}-accepted`,
  requestId,
  stepIndex: 0,
  consumesCheckpointIds,
  baseBoardRevision: 0,
  baseCueRevision: 0,
  boardDelta,
  cueDelta,
  evidenceRefs: [],
  warnings: [],
  model: "test-model",
  policyVersion: "test-policy",
  acceptedAt: "2026-09-03T00:00:00.000Z",
});

describe("lesson evidence and replay", () => {
  it("creates one immutable compact checkpoint only from closed lexical speech", () => {
    const result = checkpointFromClosedSpan(span(), 7, 3)!;
    expect(result.checkpoint).toMatchObject({ checkpointId: "checkpoint-7-speech-span-0-2", lessonSequence: 3, text: "Activation energy is the minimum energy required." });
    expect(result.grounding.words).toHaveLength(1);
    const original = span();
    const committed = checkpointFromClosedSpan(original, 7, 3)!.checkpoint;
    original.text = "later mutation";
    expect(committed.text).toBe("Activation energy is the minimum energy required.");
    expect(checkpointFromClosedSpan(span({ status: "open" }), 1, 1)).toBeUndefined();
    expect(checkpointFromClosedSpan(span({ text: "...?!" }), 1, 1)).toBeUndefined();
  });

  it("persists accepted KEEP, consumes once, and replays identically", () => {
    const sessionId = "lesson-1";
    const item = checkpoint("checkpoint-a", 1);
    const events = [
      lessonStartedEvent(sessionId, 1),
      groundedEvent(sessionId, 2, item),
      interpretationAcceptedEvent(sessionId, 3, acceptedStep("request-1", [item.checkpointId])),
    ];
    const replay = replayLessonEvents(events);
    expect(replay.consumedCheckpointIds).toEqual(new Set([item.checkpointId]));
    expect(replay.state).toEqual(replayLessonEvents(events).state);
    expect(replay.state).toMatchObject({ lessonRevision: 0, processedThroughSequence: 1, board: { revision: 0 }, cue: { revision: 0 } });
    expect(pendingEvidence(replay)).toEqual([]);
    expect(replayLessonEvents([...events, events[2]!]).events).toHaveLength(3);
  });

  it("rejects duplicate checkpoint consumption", () => {
    const sessionId = "lesson-2";
    const item = checkpoint("checkpoint-a", 1);
    expect(() => replayLessonEvents([
      lessonStartedEvent(sessionId, 1),
      groundedEvent(sessionId, 2, item),
      interpretationAcceptedEvent(sessionId, 3, acceptedStep("request-1", [item.checkpointId])),
      interpretationAcceptedEvent(sessionId, 4, acceptedStep("request-2", [item.checkpointId])),
    ])).toThrow("checkpoint-consumed-more-than-once");
  });

  it("restores an equivalent consumed lesson from the domain store without model invocation", async () => {
    const persisted: import("./contracts").LessonEvent[] = [];
    const store: LessonEventStore = {
      async append(events) { persisted.push(...events); },
      async readSession(sessionId) { return persisted.filter((event) => event.sessionId === sessionId); },
    };
    const runtime = await LessonStreamRuntime.open("lesson-reload", store);
    expect(runtime.events).toEqual([]);
    await runtime.start();
    await runtime.start();
    expect(runtime.events.filter((event) => event.type === "lesson.started")).toHaveLength(1);
    const [committed, duplicate] = await Promise.all([runtime.commitClosedSpan(span(), 1), runtime.commitClosedSpan(span(), 1)]);
    expect(committed).toBeDefined();
    expect(duplicate).toBeUndefined();
    expect(persisted.filter((event) => event.type === "evidence.checkpoint_committed")).toHaveLength(1);
    await runtime.acceptSteps([acceptedStep("reload-request", [committed!.checkpointId])]);
    const before = runtime.state;
    const restored = await LessonStreamRuntime.open("lesson-reload", store);
    expect(restored.state).toEqual(before);
    expect(restored.pending).toEqual([]);
  });

  it("publishes one final state update for a multi-step accepted backlog batch", async () => {
    const persisted: import("./contracts").LessonEvent[] = [];
    const store: LessonEventStore = {
      async append(events) { persisted.push(...events); },
      async readSession() { return persisted; },
    };
    const runtime = await LessonStreamRuntime.open("lesson-batch-render", store);
    await runtime.start();
    const a = await runtime.commitClosedSpan(span({ id: "span-a" }), 1);
    const b = await runtime.commitClosedSpan(span({ id: "span-b", text: "A second complete statement." }), 1);
    let updates = 0;
    runtime.subscribe(() => { updates += 1; });
    await runtime.acceptSteps([
      acceptedStep("batch-request", [a!.checkpointId]),
      { ...acceptedStep("batch-request", [b!.checkpointId]), stepIndex: 1 },
    ]);
    expect(updates).toBe(1);
    expect(runtime.pending).toEqual([]);
  });
});

describe("lossless scheduling and P4 projection", () => {
  it("preserves B/C/D while A is in flight and takes the earliest fitting prefix", () => {
    const scheduler = new LosslessInterpretationScheduler();
    scheduler.enqueue([checkpoint("A", 1)]);
    const first = scheduler.next(1, 1_000, 0)!;
    scheduler.enqueue([checkpoint("B", 2), checkpoint("C", 3), checkpoint("D", 4)]);
    expect(scheduler.next(1)).toBeUndefined();
    expect(scheduler.pendingCheckpoints.map((item) => item.checkpointId)).toEqual(["A", "B", "C", "D"]);
    scheduler.settleAccepted(first.work.requestId, ["A"]);
    expect(scheduler.next(1, 40, 10)!.checkpoints.map((item) => item.checkpointId)).toEqual(["B", "C"]);
  });

  it("keeps evidence pending after failure", () => {
    const scheduler = new LosslessInterpretationScheduler();
    scheduler.enqueue([checkpoint("A", 1)]);
    const work = scheduler.next(1)!.work;
    scheduler.settleFailed(work.requestId);
    expect(scheduler.pendingCheckpoints.map((item) => item.checkpointId)).toEqual(["A"]);
  });

  it("projects compact E+J+S+W without raw words or provider payloads", () => {
    const sessionId = "lesson-p4";
    const processed = checkpoint("A", 1, "Activation energy is required.");
    const pending = checkpoint("B", 2, "Temperature increases the successful collision rate.");
    const events = [
      lessonStartedEvent(sessionId, 1),
      groundedEvent(sessionId, 2, processed),
      interpretationAcceptedEvent(sessionId, 3, acceptedStep("request-a", ["A"])),
      groundedEvent(sessionId, 4, pending),
    ];
    const replay = replayLessonEvents(events);
    const { request, diagnostics } = buildTeachingInterpretationRequest({ requestId: "request-b", sessionId, events, currentState: replay.state, newEvidence: [pending] });
    expect(request.processedTimeline.map((entry) => entry.type)).toEqual(["evidence", "accepted_interpretation"]);
    expect(request.currentState).toEqual(replay.state);
    expect(request.newEvidence).toEqual([pending]);
    expect(JSON.stringify(request)).not.toContain("providerEvidence");
    expect(JSON.stringify(request)).not.toContain("words");
    expect(diagnostics.projectedInputTokens).toBeGreaterThan(diagnostics.newEvidenceTokens);
  });
});

describe("proposal validation and deterministic state", () => {
  it("requires exact ordered coverage and a current grounded trigger", () => {
    const sessionId = "lesson-validation";
    const a = checkpoint("A", 1, "Activation energy is the minimum energy required.");
    const b = checkpoint("B", 2, "Temperature increases successful collisions.");
    const events = [lessonStartedEvent(sessionId, 1), groundedEvent(sessionId, 2, a), groundedEvent(sessionId, 3, b)];
    const state = createInitialTeachingState();
    const { request } = buildTeachingInterpretationRequest({ requestId: "request-1", sessionId, events, currentState: state, newEvidence: [a, b] });
    const valid = validateAndNormalizeProposal({
      proposal: {
        requestId: request.requestId,
        baseBoardRevision: 0,
        baseCueRevision: 0,
        steps: [
          {
            consumesCheckpointIds: ["A"],
            boardDelta: { action: "SET_ACTIVE", content: { kind: "TEXT", source: { checkpointId: "A", text: "Activation energy" } }, continuity: "same_thread", retainPrevious: false },
            cueDelta: { action: "KEEP" },
            evidenceRefs: [{ checkpointId: "A", text: "Activation energy" }],
          },
          {
            consumesCheckpointIds: ["B"],
            boardDelta: { action: "ADD_SUPPORT", support: { checkpointId: "B", text: "Temperature increases successful collisions" }, targetBoardItemId: "board-request-1-accepted-0" },
            cueDelta: { action: "SET", cueKind: "TASK", source: { checkpointId: "B", text: "Temperature increases successful collisions" } },
            evidenceRefs: [{ checkpointId: "B", text: "Temperature increases successful collisions" }],
          },
        ],
      },
      request,
      allCheckpoints: [a, b],
      state,
      model: "test-model",
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const replay = replayLessonEvents([
      ...events,
      ...valid.steps.map((step, index) => interpretationAcceptedEvent(sessionId, 4 + index, step)),
    ]);
    expect(replay.state.board).toMatchObject({ revision: 2, support: [{ targetBoardItemId: "board-request-1-accepted-0" }] });
    expect(replay.state.cue).toMatchObject({ revision: 1, active: { kind: "TASK" } });
    expect(replay.state.processedThroughSequence).toBe(2);

    const invalid = validateAndNormalizeProposal({
      proposal: { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, steps: [{ consumesCheckpointIds: ["B", "A"], boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "KEEP" }, evidenceRefs: [] }] },
      request,
      allCheckpoints: [a, b],
      state,
      model: "test-model",
    });
    expect(invalid).toEqual({ ok: false, error: "proposal-batch-coverage-invalid" });
  });

  it("applies non-conflicting Cue work when the Board revision changed", () => {
    const sessionId = "lesson-conflict";
    const item = checkpoint("A", 1, "Compare the two pathways. Which is faster?");
    const events = [lessonStartedEvent(sessionId, 1), groundedEvent(sessionId, 2, item)];
    const state = { ...createInitialTeachingState(), board: { ...createInitialTeachingState().board, revision: 2 } };
    const { request } = buildTeachingInterpretationRequest({ requestId: "request-conflict", sessionId, events, currentState: state, newEvidence: [item] });
    const result = validateAndNormalizeProposal({
      proposal: {
        requestId: request.requestId,
        baseBoardRevision: 1,
        baseCueRevision: 0,
        steps: [{
          consumesCheckpointIds: ["A"],
          boardDelta: { action: "SET_ACTIVE", content: { kind: "TEXT", source: { checkpointId: "A", text: "Compare the two pathways" } }, continuity: "same_thread", retainPrevious: false },
          cueDelta: { action: "SET", cueKind: "TASK", source: { checkpointId: "A", text: "Compare the two pathways. Which is faster?" } },
          evidenceRefs: [{ checkpointId: "A", text: "Compare the two pathways" }],
        }],
      },
      request,
      allCheckpoints: [item],
      state,
      model: "test-model",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.boardConflict).toBe(true);
      expect(result.steps[0]!.boardDelta.action).toBe("KEEP");
      expect(result.steps[0]!.cueDelta.action).toBe("SET");
    }
  });

  it("keeps Board and Cue independent, bounds retained context, and replays correction plus NOTE expiry", () => {
    const sessionId = "lesson-state";
    const items = [
      checkpoint("A", 1, "Define activation energy."),
      checkpoint("B", 2, "Temperature increases collision frequency."),
      checkpoint("C", 3, "More particles exceed activation energy."),
      checkpoint("D", 4, "The task is complete."),
      checkpoint("E", 5, "Correction: collision frequency was unchanged."),
      checkpoint("F", 6, "Take note of the corrected relationship."),
    ];
    const baseEvents = [lessonStartedEvent(sessionId, 1), ...items.map((item, index) => groundedEvent(sessionId, index + 2, item))];
    const setActive = (requestId: string, item: CompactEvidenceCheckpoint, retainPrevious: boolean, cueDelta: TeachingCueDelta = { action: "KEEP" }) => acceptedStep(requestId, [item.checkpointId], {
      action: "SET_ACTIVE",
      content: { kind: "TEXT", source: { checkpointId: item.checkpointId, text: item.text } },
      continuity: "same_thread",
      retainPrevious,
    }, cueDelta);
    const steps = [
      setActive("state-a", items[0]!, false, { action: "SET", cueKind: "TASK", source: { checkpointId: "A", text: "Define activation energy" } }),
      setActive("state-b", items[1]!, true),
      setActive("state-c", items[2]!, true),
      acceptedStep("state-d", ["D"], { action: "KEEP", reason: "no_board_value" }, { action: "RESOLVE_CURRENT", reason: "completed", evidence: { checkpointId: "D", text: "task is complete" } }),
      acceptedStep("state-e", ["E"], {
        action: "SET_ACTIVE",
        content: { kind: "TEXT", source: { checkpointId: "E", text: items[4]!.text } },
        continuity: "correction",
        retainPrevious: false,
        invalidatesBoardItemIds: ["board-state-c-accepted-0"],
      }),
      acceptedStep("state-f", ["F"], { action: "KEEP", reason: "no_board_value" }, { action: "SET", cueKind: "NOTE", source: { checkpointId: "F", text: "Take note of the corrected relationship" } }),
    ];
    const acceptedEvents = steps.map((step, index) => interpretationAcceptedEvent(sessionId, baseEvents.length + index + 1, step));
    const beforeExpiry = replayLessonEvents([...baseEvents, ...acceptedEvents]);
    expect(beforeExpiry.state.board.active?.content).toEqual({ kind: "TEXT", source: { checkpointId: "E", text: items[4]!.text } });
    expect(beforeExpiry.state.board.retained).toEqual([]);
    expect(beforeExpiry.state.board.support.length).toBeLessThanOrEqual(2);
    expect(beforeExpiry.state.cue.active).toMatchObject({ kind: "NOTE" });
    const cue = beforeExpiry.state.cue.active!;
    const afterExpiry = replayLessonEvents([...baseEvents, ...acceptedEvents, cueExpiredEvent(sessionId, 99, cue.id, beforeExpiry.state.cue.revision)]);
    expect(afterExpiry.state.cue.active).toBeUndefined();
    expect(afterExpiry.state.board).toEqual(beforeExpiry.state.board);
  });
});
