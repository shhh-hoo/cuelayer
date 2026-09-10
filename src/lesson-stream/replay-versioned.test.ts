import { describe, expect, it } from "vitest";
import type { AcceptedInterpretationStep, LessonEvent } from "./contracts.ts";
import { replayLessonEvents } from "./replay.ts";
import { replayVersionedLessonEvents } from "./replay-versioned.ts";
import { replayCoreEvents } from "./core/replay.ts";
import { foundation, timestamp } from "./core/test-fixtures.ts";

function legacyEvents(version: LessonEvent["schemaVersion"]): LessonEvent[] {
  const identity = (sequence: number) => ({ schemaVersion: version, sessionId: "legacy", sequence, eventId: `legacy-${sequence}` });
  const checkpoint = (sequence: number, n: number): LessonEvent => ({ ...identity(sequence), type: "evidence.checkpoint_committed", timestamp,
    checkpoint: { checkpointId: `c${n}`, lessonSequence: n, speechRunId: "run", startMs: n, endMs: n + 1, text: "Synthetic legacy teaching", sourceFinalIds: [], warnings: [] },
    grounding: { checkpointId: `c${n}`, canonicalSpanIds: [{ spanId: `s${n}`, spanRevision: 1 }], words: [], providerEvidence: [] } });
  const contribution = (n: number) => ({ mode: "REPRESENT" as const, content: "Synthetic legacy teaching", provenance: { basis: "SPEECH" as const, speechRefs: [{ checkpointId: `c${n}`, quote: "Synthetic legacy teaching" }] } });
  const step = (n: number): AcceptedInterpretationStep => ({ interpretationId: `legacy-step-${n}`, requestId: `legacy-request-${n}`, stepIndex: 0,
    baseBoardRevision: n - 1, baseCueRevision: n === 1 ? 0 : 1, consumesCheckpointIds: [`c${n}`], acceptedAt: timestamp, model: "offline", policyVersion: "historical",
    evidenceRefs: [], warnings: [], boardDelta: { action: "SET_ACTIVE", continuity: "same_thread", retainPrevious: true,
      contribution: { ...contribution(n), content: { kind: "TEXT", text: `Legacy ${n}` } }, ...(n === 1 ? { support: [contribution(n)] } : {}) },
    cueDelta: n === 1 ? { action: "SET", cueKind: "NOTE", contribution: contribution(n) } : { action: "KEEP" } });
  const noOp = { ...step(3), boardDelta: { action: "KEEP" as const, reason: "filler" as const } };
  return [
    { ...identity(1), type: "lesson.started", timestamp }, checkpoint(2, 1),
    { ...identity(3), type: "interpretation.step_accepted", step: step(1) }, checkpoint(4, 2),
    { ...identity(5), type: "interpretation.step_accepted", step: step(2) },
    { ...identity(6), type: "teaching_cue.expired", cueId: "cue-legacy-step-1-0", baseCueRevision: 1, timestamp }, checkpoint(7, 3),
    { ...identity(8), type: "interpretation.step_accepted", step: noOp }, { ...identity(9), type: "lesson.ended", timestamp },
  ];
}

describe("offline semantic-generation dispatch", () => {
  it.each(["lesson-event-v3-learner-agency", "lesson-event-v4-continuous", "mixed"] as const)("preserves %s legacy replay, bytes and original Support behavior", version => {
    const events = legacyEvents(version === "mixed" ? "lesson-event-v3-learner-agency" : version);
    if (version === "mixed") events[4]!.schemaVersion = "lesson-event-v4-continuous";
    const bytes = JSON.stringify(events);
    const direct = replayLessonEvents(events), dispatched = replayVersionedLessonEvents(events);
    expect(dispatched.generation).toBe("legacy");
    expect(dispatched.replay).toEqual(direct);
    expect(JSON.stringify(dispatched.replay.events)).toBe(bytes);
    expect(JSON.stringify(events)).toBe(bytes);
    expect(direct.state).toMatchObject({ lessonRevision: 3, processedThroughSequence: 3, board: { revision: 2 }, cue: { revision: 2 } });
    expect(direct.state.board.retained.map(item => item.id)).toEqual(["board-legacy-step-1-0"]);
    expect(direct.state.board.support).toHaveLength(version === "lesson-event-v3-learner-agency" ? 0 : 1);
    expect(direct.consumedCheckpointIds).toEqual(new Set(["c1", "c2", "c3"]));
    expect(direct.ended).toBe(true);
  });

  it("preserves v3 rejection of v4-only operations rather than converting them", () => {
    const events = legacyEvents("lesson-event-v3-learner-agency");
    const event = events[4]!;
    if (event.type !== "interpretation.step_accepted") throw Error("fixture");
    event.step.boardDelta = { action: "RETIRE_ACTIVE", targetBoardItemId: "board-legacy-step-1-0", disposition: "retain", reason: "completed" };
    expect(() => replayLessonEvents(events)).toThrow("v4-operation-in-v3-event");
    expect(() => replayVersionedLessonEvents(events)).toThrow("v4-operation-in-v3-event");
    event.schemaVersion = "lesson-event-v4-continuous";
    expect(replayVersionedLessonEvents(events).replay).toEqual(replayLessonEvents(events));
  });

  it("returns only Core state for Core events", () => {
    const events = foundation().replay.events;
    const result = replayVersionedLessonEvents(events);
    expect(result).toEqual({ generation: "core", replay: replayCoreEvents(events) });
    expect(result.replay.state).not.toHaveProperty("board");
    expect(() => replayLessonEvents(events as unknown as LessonEvent[])).toThrow("lesson-event-schema-incompatible");
  });

  it.each(["lesson-event-v3-learner-agency", "lesson-event-v4-continuous"] as const)("rejects Core with %s before deduplication, in either order", version => {
    const core = foundation().replay.events;
    const legacy = { ...legacyEvents(version)[0]!, eventId: core[0]!.eventId };
    for (const events of [[...core, legacy], [legacy, ...core]]) {
      expect(() => replayVersionedLessonEvents(events)).toThrow("lesson-domain-generation-mixed");
      expect(() => replayCoreEvents(events)).toThrow();
    }
  });

  it("preserves empty legacy replay and rejects unknown generations", () => {
    expect(replayVersionedLessonEvents([])).toEqual({ generation: "legacy", replay: replayLessonEvents([]) });
    expect(() => replayVersionedLessonEvents([{ schemaVersion: "future" }])).toThrow("lesson-event-schema-incompatible");
  });
});
