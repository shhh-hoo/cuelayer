import { describe, expect, it } from "vitest";
import { validateAndNormalizeProposal } from "./accepted-interpretations";
import { buildTeachingInterpretationRequest, projectProcessedTimeline } from "./context-projection";
import { checkpointCommittedEvent, interpretationAcceptedEvent, lessonStartedEvent } from "./events";
import { replayLessonEvents } from "./replay";
import { createInitialTeachingState } from "./teaching-state";
import type { CompactEvidenceCheckpoint } from "./contracts";

const checkpoint: CompactEvidenceCheckpoint = { checkpointId: "A", lessonSequence: 1, speechRunId: 1, startMs: 0, endMs: 100, text: "Temperature increases successful collisions.", sourceFinalIds: ["final-A"], warnings: [] };
const grounding = { checkpointId: "A", canonicalSpanIds: [{ spanId: "span-A", spanRevision: 1 }], words: [], providerEvidence: [{ providerFinalId: "final-A" }] };
const speech = (quote = "Temperature increases") => ({ checkpointId: "A", quote });
const board = (mode: "RECONSTRUCT" | "REPRESENT" | "AUGMENT" = "REPRESENT") => ({ mode, content: { kind: "TEXT" as const, text: "Higher temperature → more successful collisions" }, provenance: { basis: "SPEECH" as const, speechRefs: [speech()] } });
const cue = (mode: "RECONSTRUCT" | "REPRESENT" | "AUGMENT" = "REPRESENT") => ({ mode, content: "Notice the collision-rate effect", provenance: { basis: "SPEECH" as const, speechRefs: [speech()] } });

function request() {
  const events = [lessonStartedEvent("s", 1), checkpointCommittedEvent("s", 2, checkpoint, grounding)];
  return { events, request: buildTeachingInterpretationRequest({ requestId: "request", sessionId: "s", events, currentState: createInitialTeachingState(), newEvidence: [checkpoint] }).request };
}
function proposal(boardDelta: unknown, cueDelta: unknown, evidenceRefs = [speech()]) {
  return { requestId: "request", baseBoardRevision: 0, baseCueRevision: 0, steps: [{ consumesCheckpointIds: ["A"], boardDelta, cueDelta, evidenceRefs }] };
}

describe("contribution provenance contract", () => {
  it("persists represented learner content separately from exact teacher speech", () => {
    const input = request();
    const accepted = validateAndNormalizeProposal({ proposal: proposal({ action: "SET_ACTIVE", contribution: board(), continuity: "same_thread", retainPrevious: false }, { action: "SET", cueKind: "NOTE", contribution: cue() }), request: input.request, allCheckpoints: [checkpoint], state: createInitialTeachingState(), model: "test" });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.steps[0]!.boardDelta).toMatchObject({ action: "SET_ACTIVE", contribution: { content: { text: "Higher temperature → more successful collisions" }, provenance: { speechRefs: [{ quote: "Temperature increases" }] } } });
    const events = [...input.events, interpretationAcceptedEvent("s", 3, accepted.steps[0]!)];
    const replay = replayLessonEvents(events);
    expect(replay.state.board.active?.contribution.content).toEqual({ kind: "TEXT", text: "Higher temperature → more successful collisions" });
    expect(projectProcessedTimeline(events)[1]).toMatchObject({ type: "accepted_interpretation", contributionIds: { board: "board-request-accepted-0", cue: "cue-request-accepted-0" } });
    expect(replay.state).toEqual(replayLessonEvents(events).state);
  });

  it("requires exact speech quotes but never requires display text to be a substring", () => {
    const input = request();
    const accepted = validateAndNormalizeProposal({ proposal: proposal({ action: "SET_ACTIVE", contribution: board(), continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }), request: input.request, allCheckpoints: [checkpoint], state: createInitialTeachingState(), model: "test" });
    expect(accepted.ok).toBe(true);
    const rejected = validateAndNormalizeProposal({ proposal: proposal({ action: "SET_ACTIVE", contribution: { ...board(), provenance: { basis: "SPEECH", speechRefs: [speech("invented quote")] } }, continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }, [speech("invented quote")]), request: input.request, allCheckpoints: [checkpoint], state: createInitialTeachingState(), model: "test" });
    expect(rejected).toEqual({ ok: false, error: "proposal-speech-grounding-invalid" });
  });

  it("enforces Alpha contribution modes and cue action boundary", () => {
    const input = request();
    const base = { request: input.request, allCheckpoints: [checkpoint], state: createInitialTeachingState(), model: "test" };
    expect(validateAndNormalizeProposal({ ...base, proposal: proposal({ action: "SET_ACTIVE", contribution: board("AUGMENT"), continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }) })).toMatchObject({ ok: false, error: "proposal-contribution-mode-not-permitted" });
    expect(validateAndNormalizeProposal({ ...base, allowAugment: true, proposal: proposal({ action: "SET_ACTIVE", contribution: board("AUGMENT"), continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }) }).ok).toBe(true);
    expect(validateAndNormalizeProposal({ ...base, proposal: proposal({ action: "KEEP", reason: "no_board_value" }, { action: "SET", cueKind: "NOTE", contribution: cue("AUGMENT") }) })).toMatchObject({ ok: false, error: "proposal-step-schema-invalid:step-0:cueDelta:object" });
    expect(validateAndNormalizeProposal({ ...base, proposal: proposal({ action: "KEEP", reason: "no_board_value" }, { action: "SET", cueKind: "TASK", contribution: cue() }) })).toMatchObject({ ok: false, error: "proposal-step-schema-invalid:step-0:cueDelta:object" });
  });

  it("makes old event records an explicit incompatible-session boundary", () => {
    expect(() => replayLessonEvents([{ type: "lesson.started", eventId: "legacy", sessionId: "s", sequence: 1, timestamp: "2026-09-03T00:00:00.000Z" } as never])).toThrow("lesson-event-schema-incompatible");
  });
});
