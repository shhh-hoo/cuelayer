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
import type { AcceptedInterpretationStep, BoardDelta, CompactEvidenceCheckpoint, LessonEvent, TeachingCueDelta } from "./contracts";

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

const speech = (checkpointId: string, quote: string) => ({ checkpointId, quote });
const visibleText = (checkpointId: string, quote: string, text = quote) => ({ mode: "RECONSTRUCT" as const, content: text, provenance: { basis: "SPEECH" as const, speechRefs: [speech(checkpointId, quote)] } });
const boardText = (checkpointId: string, quote: string, text = quote) => ({ mode: "RECONSTRUCT" as const, content: { kind: "TEXT" as const, text }, provenance: { basis: "SPEECH" as const, speechRefs: [speech(checkpointId, quote)] } });

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

  it("keeps accepted work and new local span revisions distinct across a lesson reload", async () => {
    const events: LessonEvent[] = [];
    const store: LessonEventStore = { append: async (batch) => { events.push(...batch); }, readSession: async () => events };
    const first = await LessonStreamRuntime.open("durable-identity", store);
    const runA = await first.allocateSpeechRunId(() => "run-a");
    const evidenceA = await first.commitClosedSpan(span({ id: `speech-span-run-${runA}-0`, sourceFinalIds: [`provider-final-run-${runA}-0`] }), runA);
    await first.acceptSteps([acceptedStep(`interpretation-${runA}-1`, [evidenceA!.checkpointId], {
      action: "SET_ACTIVE", contribution: boardText(evidenceA!.checkpointId, "Activation energy"), continuity: "topic_shift", retainPrevious: false,
    }, { action: "SET", cueKind: "NOTE", contribution: visibleText(evidenceA!.checkpointId, "Notice activation energy") })]);
    first.close();

    const reloaded = await LessonStreamRuntime.open("durable-identity", store);
    const runB = await reloaded.allocateSpeechRunId(() => "run-b");
    const evidenceB = await reloaded.commitClosedSpan(span({ id: `speech-span-run-${runB}-0`, sourceFinalIds: [`provider-final-run-${runB}-0`] }), runB);
    await reloaded.acceptSteps([acceptedStep(`interpretation-${runB}-1`, [evidenceB!.checkpointId], {
      action: "SET_ACTIVE", contribution: boardText(evidenceB!.checkpointId, "Activation energy"), continuity: "topic_shift", retainPrevious: false,
    }, { action: "SET", cueKind: "NOTE", contribution: visibleText(evidenceB!.checkpointId, "Notice activation energy") })]);

    expect(runA).not.toBe(runB);
    expect(evidenceA!.checkpointId).not.toBe(evidenceB!.checkpointId);
    expect(reloaded.checkpoints.map((item) => item.checkpointId)).toEqual([evidenceA!.checkpointId, evidenceB!.checkpointId]);
    expect(reloaded.replay.acceptedStepKeys.size).toBe(2);
    expect(reloaded.state.board.active?.id).toBe(`board-interpretation-${runB}-1-accepted-0`);
    expect(reloaded.state.cue.active?.id).toBe(`cue-interpretation-${runB}-1-accepted-0`);
    reloaded.close();
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

  it("uses checkpoint identity, not reusable span identity, across speech reconnects and reload", async () => {
    const persisted: import("./contracts").LessonEvent[] = [];
    const store: LessonEventStore = {
      async append(events) { persisted.push(...events); },
      async readSession(sessionId) { return persisted.filter((event) => event.sessionId === sessionId); },
    };
    const runtime = await LessonStreamRuntime.open("lesson-reconnect", store);
    await runtime.start();
    const first = await runtime.commitClosedSpan(span({ id: "speech-span-0" }), 1);
    const duplicate = await runtime.commitClosedSpan(span({ id: "speech-span-0" }), 1);
    const second = await runtime.commitClosedSpan(span({ id: "speech-span-0", text: "A new run has independent evidence." }), 2);
    expect(duplicate).toBeUndefined();
    expect([first?.checkpointId, second?.checkpointId]).toEqual(["checkpoint-1-speech-span-0-2", "checkpoint-2-speech-span-0-2"]);
    expect(runtime.pending.map((item) => item.checkpointId)).toEqual([first!.checkpointId, second!.checkpointId]);
    const restored = await LessonStreamRuntime.open("lesson-reconnect", store);
    expect(restored.pending.map((item) => item.checkpointId)).toEqual([first!.checkpointId, second!.checkpointId]);
    await restored.acceptSteps([
      acceptedStep("reconnect-one", [first!.checkpointId]),
      { ...acceptedStep("reconnect-two", [second!.checkpointId]), stepIndex: 1 },
    ]);
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

  it("allocates unique strictly increasing sequences for overlapping domain operations", async () => {
    const persisted: import("./contracts").LessonEvent[] = [];
    const store: LessonEventStore = { async append(events) { persisted.push(...events); }, async readSession() { return persisted; } };
    const runtime = await LessonStreamRuntime.open("lesson-sequences", store);
    await runtime.start();
    await Promise.all([
      runtime.commitClosedSpan(span({ id: "span-a" }), 1),
      runtime.commitClosedSpan(span({ id: "span-b", text: "A second closed sentence." }), 1),
      runtime.end(),
    ]);
    const sequences = persisted.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toEqual(sequences.map((_, index) => index + 1));
  });

  it("validates a proposal at commit time after a queued Cue expiry", async () => {
    const persisted: import("./contracts").LessonEvent[] = [];
    const store: LessonEventStore = {
      async append(events) { persisted.push(...events); },
      async readSession() { return persisted; },
    };
    const runtime = await LessonStreamRuntime.open("lesson-commit-time", store);
    await runtime.start();
    const a = await runtime.commitClosedSpan(span({ id: "span-a", text: "Set a task." }), 1);
    await runtime.acceptSteps([acceptedStep("existing-cue", [a!.checkpointId], { action: "KEEP", reason: "no_board_value" }, { action: "SET", cueKind: "NOTE", contribution: visibleText(a!.checkpointId, "Set a task") })]);
    const b = await runtime.commitClosedSpan(span({ id: "span-b", text: "Add a Board item and another cue." }), 1);
    const { request } = buildTeachingInterpretationRequest({ requestId: "commit-time", sessionId: "lesson-commit-time", events: runtime.events, currentState: runtime.state, newEvidence: [b!] });
    const expiry = runtime.expireCue(runtime.state.cue.active!.id, runtime.state.cue.revision);
    const acceptance = runtime.acceptProposal({
      request,
      model: "test-model",
      proposal: { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 1, steps: [{
        consumesCheckpointIds: [b!.checkpointId],
        boardDelta: { action: "SET_ACTIVE", contribution: boardText(b!.checkpointId, "Add a Board item"), continuity: "same_thread", retainPrevious: false },
        cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText(b!.checkpointId, "another cue") },
        evidenceRefs: [speech(b!.checkpointId, "Add a Board item"), speech(b!.checkpointId, "another cue")],
      }] },
    });
    await expiry;
    const result = await acceptance;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cueConflict).toBe(true);
    expect(result.steps[0]!.boardDelta.action).toBe("SET_ACTIVE");
    expect(result.steps[0]!.cueDelta.action).toBe("KEEP");
  });

  it("does not advance materialized state when an accepted batch fails to append", async () => {
    const persisted: import("./contracts").LessonEvent[] = [];
    const store: LessonEventStore = {
      async append(events) {
        if (events.some((event) => event.type === "interpretation.step_accepted")) throw new Error("store-down");
        persisted.push(...events);
      },
      async readSession() { return persisted; },
    };
    const runtime = await LessonStreamRuntime.open("lesson-append-failure", store);
    await runtime.start();
    const item = await runtime.commitClosedSpan(span(), 1);
    const { request } = buildTeachingInterpretationRequest({ requestId: "append-failure", sessionId: "lesson-append-failure", events: runtime.events, currentState: runtime.state, newEvidence: [item!] });
    await expect(runtime.acceptProposal({ request, model: "test-model", proposal: { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, steps: [{ consumesCheckpointIds: [item!.checkpointId], boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "KEEP" }, evidenceRefs: [] }] } })).rejects.toThrow("store-down");
    expect(runtime.pending.map((checkpoint) => checkpoint.checkpointId)).toEqual([item!.checkpointId]);
    expect(runtime.state).toEqual(createInitialTeachingState());
  });

  it("returns exact per-step state transitions for an ordered accepted batch", async () => {
    const persisted: import("./contracts").LessonEvent[] = [];
    const store: LessonEventStore = { async append(events) { persisted.push(...events); }, async readSession() { return persisted; } };
    const runtime = await LessonStreamRuntime.open("lesson-step-transitions", store);
    await runtime.start();
    const a = await runtime.commitClosedSpan(span({ id: "span-a", text: "Set the task." }), 1);
    const b = await runtime.commitClosedSpan(span({ id: "span-b", text: "The task is complete." }), 1);
    const { request } = buildTeachingInterpretationRequest({ requestId: "step-transitions", sessionId: "lesson-step-transitions", events: runtime.events, currentState: runtime.state, newEvidence: [a!, b!] });
    const result = await runtime.acceptProposal({
      request, model: "test-model",
      proposal: { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, steps: [
        { consumesCheckpointIds: [a!.checkpointId], boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText(a!.checkpointId, "Set the task") }, evidenceRefs: [speech(a!.checkpointId, "Set the task")] },
        { consumesCheckpointIds: [b!.checkpointId], boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "RESOLVE_CURRENT", reason: "completed", evidence: speech(b!.checkpointId, "The task is complete") }, evidenceRefs: [speech(b!.checkpointId, "The task is complete")] },
      ] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transitions.map((transition) => [transition.stateBefore.cue.revision, transition.stateAfter.cue.revision])).toEqual([[0, 1], [1, 2]]);
    expect(result.transitions[0]!.stateBefore.cue.active).toBeUndefined();
    expect(result.transitions[1]!.stateBefore.cue.active?.id).toBe("cue-step-transitions-accepted-0");
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
  it("validates same-batch cue lifecycle against rolling Cue state", () => {
    const a = checkpoint("A", 1, "Set the task now.");
    const b = checkpoint("B", 2, "The task is complete.");
    const sessionId = "lesson-rolling-cue";
    const events = [lessonStartedEvent(sessionId, 1), groundedEvent(sessionId, 2, a), groundedEvent(sessionId, 3, b)];
    const { request } = buildTeachingInterpretationRequest({ requestId: "rolling-cue", sessionId, events, currentState: createInitialTeachingState(), newEvidence: [a, b] });
    const result = validateAndNormalizeProposal({
      proposal: {
        requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0,
        steps: [
          { consumesCheckpointIds: ["A"], boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText("A", "Set the task now") }, evidenceRefs: [speech("A", "Set the task now")] },
          { consumesCheckpointIds: ["B"], boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "RESOLVE_CURRENT", reason: "completed", evidence: speech("B", "The task is complete") }, evidenceRefs: [speech("B", "The task is complete")] },
        ],
      }, request, allCheckpoints: [a, b], state: createInitialTeachingState(), model: "test-model",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const replay = replayLessonEvents([...events, ...result.steps.map((step, index) => interpretationAcceptedEvent(sessionId, 4 + index, step))]);
    expect(replay.state.cue.active).toBeUndefined();
    expect(replay.consumedCheckpointIds).toEqual(new Set(["A", "B"]));
  });

  it("keeps a Cue SET target when this step creates that Board item", () => {
    const a = checkpoint("A", 1, "Set the task beside activation energy.");
    const sessionId = "lesson-cue-prospective-target";
    const events = [lessonStartedEvent(sessionId, 1), groundedEvent(sessionId, 2, a)];
    const state = createInitialTeachingState();
    const { request } = buildTeachingInterpretationRequest({ requestId: "cue-prospective", sessionId, events, currentState: state, newEvidence: [a] });
    const result = validateAndNormalizeProposal({
      proposal: { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, steps: [{
        consumesCheckpointIds: ["A"],
        boardDelta: { action: "SET_ACTIVE", contribution: boardText("A", "activation energy"), continuity: "same_thread", retainPrevious: false },
        cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText("A", "Set the task"), targetBoardItemId: "board-cue-prospective-accepted-0" },
        evidenceRefs: [speech("A", "Set the task")],
      }] }, request, allCheckpoints: [a], state, model: "test-model",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.steps[0]!.cueDelta).toMatchObject({ action: "SET", targetBoardItemId: "board-cue-prospective-accepted-0" });
  });

  it("keeps a Cue SET target for the current active Board item", () => {
    const a = checkpoint("A", 1, "Complete the current task.");
    const sessionId = "lesson-cue-current-target";
    const events = [lessonStartedEvent(sessionId, 1), groundedEvent(sessionId, 2, a)];
    const existing = { id: "board-current", contribution: boardText("A", "Complete the current task"), sourceCheckpointIds: ["A"], establishedAtRevision: 1 };
    const state = { ...createInitialTeachingState(), board: { revision: 1, active: existing, support: [], retained: [] } };
    const { request } = buildTeachingInterpretationRequest({ requestId: "cue-current", sessionId, events, currentState: state, newEvidence: [a] });
    const result = validateAndNormalizeProposal({
      proposal: { requestId: request.requestId, baseBoardRevision: 1, baseCueRevision: 0, steps: [{
        consumesCheckpointIds: ["A"], boardDelta: { action: "KEEP", reason: "no_board_value" },
        cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText("A", "Complete the current task"), targetBoardItemId: "board-current" }, evidenceRefs: [speech("A", "Complete the current task")],
      }] }, request, allCheckpoints: [a], state, model: "test-model",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.steps[0]!.cueDelta).toMatchObject({ targetBoardItemId: "board-current" });
  });

  it("drops an invalid optional Cue target while accepting the grounded Cue SET", () => {
    const a = checkpoint("A", 1, "Complete the task.");
    const sessionId = "lesson-cue-drop-target";
    const events = [lessonStartedEvent(sessionId, 1), groundedEvent(sessionId, 2, a)];
    const state = createInitialTeachingState();
    const { request } = buildTeachingInterpretationRequest({ requestId: "cue-drop", sessionId, events, currentState: state, newEvidence: [a] });
    const result = validateAndNormalizeProposal({
      proposal: { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, steps: [{
        consumesCheckpointIds: ["A"], boardDelta: { action: "KEEP", reason: "no_board_value" },
        cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText("A", "Complete the task"), targetBoardItemId: "hallucinated-board" }, evidenceRefs: [speech("A", "Complete the task")],
      }] }, request, allCheckpoints: [a], state, model: "test-model",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]!.cueDelta).toEqual({ action: "SET", cueKind: "NOTE", contribution: visibleText("A", "Complete the task") });
    expect(result.steps[0]!.warnings).toContainEqual({ code: "cue_target_dropped" });
  });

  it("keeps a Cue SET target for an earlier same-batch Board item", () => {
    const a = checkpoint("A", 1, "Write activation energy.");
    const b = checkpoint("B", 2, "Complete the activation energy task.");
    const sessionId = "lesson-cue-earlier-target";
    const events = [lessonStartedEvent(sessionId, 1), groundedEvent(sessionId, 2, a), groundedEvent(sessionId, 3, b)];
    const state = createInitialTeachingState();
    const { request } = buildTeachingInterpretationRequest({ requestId: "cue-earlier", sessionId, events, currentState: state, newEvidence: [a, b] });
    const result = validateAndNormalizeProposal({
      proposal: { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, steps: [
        { consumesCheckpointIds: ["A"], boardDelta: { action: "SET_ACTIVE", contribution: boardText("A", "activation energy"), continuity: "same_thread", retainPrevious: false }, cueDelta: { action: "KEEP" }, evidenceRefs: [speech("A", "activation energy")] },
        { consumesCheckpointIds: ["B"], boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText("B", "Complete the activation energy task"), targetBoardItemId: "board-cue-earlier-accepted-0" }, evidenceRefs: [speech("B", "Complete the activation energy task")] },
      ] }, request, allCheckpoints: [a, b], state, model: "test-model",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.steps[1]!.cueDelta).toMatchObject({ targetBoardItemId: "board-cue-earlier-accepted-0" });
  });

  it("rejects a Board support target retired earlier in the same batch before persistence", () => {
    const a = checkpoint("A", 1, "Change topic entirely.");
    const b = checkpoint("B", 2, "Support the old topic.");
    const existing = { id: "existing", contribution: boardText("A", "Change topic entirely"), sourceCheckpointIds: ["A"], establishedAtRevision: 1 };
    const state = { ...createInitialTeachingState(), board: { revision: 1, active: existing, support: [], retained: [] } };
    const sessionId = "lesson-retired-target";
    const events = [lessonStartedEvent(sessionId, 1), groundedEvent(sessionId, 2, a), groundedEvent(sessionId, 3, b)];
    const { request } = buildTeachingInterpretationRequest({ requestId: "retired-target", sessionId, events, currentState: state, newEvidence: [a, b] });
    const result = validateAndNormalizeProposal({
      proposal: { requestId: request.requestId, baseBoardRevision: 1, baseCueRevision: 0, steps: [
        { consumesCheckpointIds: ["A"], boardDelta: { action: "SET_ACTIVE", contribution: boardText("A", "Change topic entirely"), continuity: "topic_shift", retainPrevious: false }, cueDelta: { action: "KEEP" }, evidenceRefs: [speech("A", "Change topic entirely")] },
        { consumesCheckpointIds: ["B"], boardDelta: { action: "ADD_SUPPORT", targetBoardItemId: "existing", support: visibleText("B", "Support the old topic") }, cueDelta: { action: "KEEP" }, evidenceRefs: [speech("B", "Support the old topic")] },
      ] }, request, allCheckpoints: [a, b], state, model: "test-model",
    });
    expect(result).toEqual({ ok: false, error: "proposal-support-target-missing" });
  });
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
            boardDelta: { action: "SET_ACTIVE", contribution: boardText("A", "Activation energy", "Energy threshold"), continuity: "same_thread", retainPrevious: false },
            cueDelta: { action: "KEEP" },
            evidenceRefs: [speech("A", "Activation energy")],
          },
          {
            consumesCheckpointIds: ["B"],
            boardDelta: { action: "ADD_SUPPORT", support: visibleText("B", "Temperature increases successful collisions", "More successful collisions"), targetBoardItemId: "board-request-1-accepted-0" },
            cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText("B", "Temperature increases successful collisions", "Notice the collision change") },
            evidenceRefs: [speech("B", "Temperature increases successful collisions")],
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
    expect(replay.state.cue).toMatchObject({ revision: 1, active: { kind: "NOTE" } });
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
          boardDelta: { action: "SET_ACTIVE", contribution: boardText("A", "Compare the two pathways", "Compare pathways"), continuity: "same_thread", retainPrevious: false },
          cueDelta: { action: "SET", cueKind: "NOTE", contribution: visibleText("A", "Compare the two pathways. Which is faster?", "Compare pathways") },
          evidenceRefs: [speech("A", "Compare the two pathways")],
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
      contribution: boardText(item.checkpointId, item.text),
      continuity: "same_thread",
      retainPrevious,
    }, cueDelta);
    const steps = [
      setActive("state-a", items[0]!, false, { action: "SET", cueKind: "NOTE", contribution: visibleText("A", "Define activation energy") }),
      setActive("state-b", items[1]!, true),
      setActive("state-c", items[2]!, true),
      acceptedStep("state-d", ["D"], { action: "KEEP", reason: "no_board_value" }, { action: "RESOLVE_CURRENT", reason: "completed", evidence: speech("D", "task is complete") }),
      acceptedStep("state-e", ["E"], {
        action: "SET_ACTIVE",
        contribution: boardText("E", items[4]!.text),
        continuity: "correction",
        retainPrevious: false,
        invalidatesBoardItemIds: ["board-state-c-accepted-0"],
      }),
      acceptedStep("state-f", ["F"], { action: "KEEP", reason: "no_board_value" }, { action: "SET", cueKind: "NOTE", contribution: visibleText("F", "Take note of the corrected relationship") }),
    ];
    const acceptedEvents = steps.map((step, index) => interpretationAcceptedEvent(sessionId, baseEvents.length + index + 1, step));
    const beforeExpiry = replayLessonEvents([...baseEvents, ...acceptedEvents]);
    expect(beforeExpiry.state.board.active?.contribution.content).toEqual({ kind: "TEXT", text: items[4]!.text });
    expect(beforeExpiry.state.board.retained).toEqual([]);
    expect(beforeExpiry.state.board.support.length).toBeLessThanOrEqual(2);
    expect(beforeExpiry.state.cue.active).toMatchObject({ kind: "NOTE" });
    const cue = beforeExpiry.state.cue.active!;
    const afterExpiry = replayLessonEvents([...baseEvents, ...acceptedEvents, cueExpiredEvent(sessionId, 99, cue.id, beforeExpiry.state.cue.revision)]);
    expect(afterExpiry.state.cue.active).toBeUndefined();
    expect(afterExpiry.state.board).toEqual(beforeExpiry.state.board);
  });
});
