import { describe, expect, it } from "vitest";
import { validateAndNormalizeProposal } from "./accepted-interpretations";
import { buildTeachingInterpretationRequest, projectProcessedTimeline } from "./context-projection";
import { checkpointCommittedEvent, interpretationAcceptedEvent, lessonStartedEvent } from "./events";
import { replayLessonEvents } from "./replay";
import { createInitialTeachingState, reduceAcceptedStep } from "./teaching-state";
import { interventionRiskFor, type AcceptedInterpretationStep, type CompactEvidenceCheckpoint, type ContributionProvenance, type TeachingStateSnapshot } from "./contracts";

const checkpoint: CompactEvidenceCheckpoint = { checkpointId: "A", lessonSequence: 1, speechRunId: 1, startMs: 0, endMs: 100, text: "The formula sounded like d6.", sourceFinalIds: ["final-A"], warnings: [] };
const grounding = { checkpointId: "A", canonicalSpanIds: [{ spanId: "span-A", spanRevision: 1 }], words: [], providerEvidence: [{ providerFinalId: "final-A" }] };
const speech = (quote = "d6") => ({ checkpointId: "A", quote });
const speechBoard = () => ({ mode: "REPRESENT" as const, content: { kind: "TEXT" as const, text: "Higher temperature → more successful collisions" }, provenance: { basis: "SPEECH" as const, speechRefs: [speech()] } });
const domainBoard = (mode: "AUGMENT" | "CORRECT" = "AUGMENT", provenance: ContributionProvenance = { basis: "DOMAIN_KNOWLEDGE" }) => ({ mode, content: { kind: "TEXT" as const, text: "Al₂Cl₆" }, provenance });
const initiatedCue = (cueKind: "QUESTION" | "TASK" | "HINT") => ({ action: "SET" as const, cueKind, contribution: { mode: "INITIATE" as const, content: `Consider ${cueKind.toLowerCase()}`, provenance: { basis: "DOMAIN_KNOWLEDGE" as const } } });

function request(state = createInitialTeachingState()) {
  const events = [lessonStartedEvent("s", 1), checkpointCommittedEvent("s", 2, checkpoint, grounding)];
  return { events, request: buildTeachingInterpretationRequest({ requestId: "request", sessionId: "s", events, currentState: state, newEvidence: [checkpoint] }).request };
}
function proposal(boardDelta: unknown, cueDelta: unknown, evidenceRefs: unknown[] = [speech()], revisions = { board: 0, cue: 0 }) {
  return { requestId: "request", baseBoardRevision: revisions.board, baseCueRevision: revisions.cue, steps: [{ consumesCheckpointIds: ["A"], boardDelta, cueDelta, evidenceRefs }] };
}
function stateWithBoard(): TeachingStateSnapshot {
  return {
    ...createInitialTeachingState(),
    board: {
      revision: 1,
      active: { id: "board-old", contribution: { mode: "REPRESENT", content: { kind: "TEXT", text: "AlCl₃ is monomeric." }, provenance: { basis: "DOMAIN_KNOWLEDGE" } }, sourceCheckpointIds: [], establishedAtRevision: 1 },
      support: [], retained: [],
    },
  };
}

describe("contribution provenance and learner-agency contract", () => {
  it("classifies intervention risk without using it as an authorship prohibition", () => {
    expect(interventionRiskFor("RECONSTRUCT")).toBe("LOW");
    expect(interventionRiskFor("AUGMENT")).toBe("MEDIUM");
    expect(interventionRiskFor("CORRECT")).toBe("HIGH");
    expect(interventionRiskFor("INITIATE", "TASK")).toBe("HIGH");
  });

  it("reconstructs Al₂Cl₆ from corrupted speech with contextual provenance", () => {
    const state = stateWithBoard();
    const input = request(state);
    const result = validateAndNormalizeProposal({
      proposal: proposal({ action: "SET_ACTIVE", contribution: { mode: "RECONSTRUCT", content: { kind: "TEXT", text: "Al₂Cl₆" }, provenance: { basis: "SPEECH_AND_STATE", speechRefs: [speech()], stateRefs: [{ kind: "BOARD_ITEM", id: "board-old" }] } }, continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }, [speech()], { board: 1, cue: 0 }),
      request: input.request, allCheckpoints: [checkpoint], state, model: "test",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an unspoken AUGMENT with DOMAIN_KNOWLEDGE and no fabricated quote", () => {
    const input = request();
    const result = validateAndNormalizeProposal({ proposal: proposal({ action: "SET_ACTIVE", contribution: domainBoard(), continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }, []), request: input.request, allCheckpoints: [checkpoint], state: createInitialTeachingState(), model: "test" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]!.boardDelta).toMatchObject({ action: "SET_ACTIVE", contribution: { mode: "AUGMENT", content: { text: "Al₂Cl₆" }, provenance: { basis: "DOMAIN_KNOWLEDGE" } } });
  });

  it("validates STATE_AND_DOMAIN_KNOWLEDGE against existing state", () => {
    const state = stateWithBoard();
    const input = request(state);
    const valid = validateAndNormalizeProposal({ proposal: proposal({ action: "ADD_SUPPORT", targetBoardItemId: "board-old", support: { mode: "AUGMENT", content: "Dimerization is contextually useful", provenance: { basis: "STATE_AND_DOMAIN_KNOWLEDGE", stateRefs: [{ kind: "BOARD_ITEM", id: "board-old" }] } } }, { action: "KEEP" }, [], { board: 1, cue: 0 }), request: input.request, allCheckpoints: [checkpoint], state, model: "test" });
    expect(valid.ok).toBe(true);
    const invalid = validateAndNormalizeProposal({ proposal: proposal({ action: "ADD_SUPPORT", targetBoardItemId: "board-old", support: { mode: "AUGMENT", content: "Unsupported state", provenance: { basis: "STATE_AND_DOMAIN_KNOWLEDGE", stateRefs: [{ kind: "BOARD_ITEM", id: "missing" }] } } }, { action: "KEEP" }, [], { board: 1, cue: 0 }), request: input.request, allCheckpoints: [checkpoint], state, model: "test" });
    expect(invalid).toEqual({ ok: false, error: "proposal-state-reference-missing" });
  });

  it("accepts AI-initiated QUESTION, TASK, and HINT", () => {
    const input = request();
    for (const cue of [initiatedCue("QUESTION"), initiatedCue("TASK"), initiatedCue("HINT")]) {
      expect(validateAndNormalizeProposal({ proposal: proposal({ action: "KEEP", reason: "no_board_value" }, cue, []), request: input.request, allCheckpoints: [checkpoint], state: createInitialTeachingState(), model: "test" }).ok).toBe(true);
    }
  });

  it("records a CORRECT contribution that invalidates the superseded Board item", () => {
    const state = stateWithBoard();
    const input = request(state);
    const result = validateAndNormalizeProposal({
      proposal: proposal({ action: "SET_ACTIVE", contribution: domainBoard("CORRECT", { basis: "STATE_AND_DOMAIN_KNOWLEDGE", stateRefs: [{ kind: "BOARD_ITEM", id: "board-old" }] }), continuity: "correction", retainPrevious: false, invalidatesBoardItemIds: ["board-old"] }, { action: "KEEP" }, [], { board: 1, cue: 0 }),
      request: input.request, allCheckpoints: [checkpoint], state, model: "test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = [...input.events, interpretationAcceptedEvent("s", 3, result.steps[0]!)];
    const replay = replayLessonEvents(events);
    expect(replay.state.board.active?.contribution).toMatchObject({ mode: "CORRECT", provenance: { basis: "STATE_AND_DOMAIN_KNOWLEDGE" } });
    expect(replay.state.board.retained).toEqual([]);
  });

  it("preserves an unresolved TASK across unrelated Board work", () => {
    const task: AcceptedInterpretationStep = {
      interpretationId: "task", requestId: "task", stepIndex: 0, consumesCheckpointIds: ["A"], baseBoardRevision: 0, baseCueRevision: 0,
      boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: initiatedCue("TASK"), evidenceRefs: [], warnings: [], model: "test", policyVersion: "test", acceptedAt: "2026-09-03T00:00:00.000Z",
    };
    const afterTask = reduceAcceptedStep(createInitialTeachingState(), task, new Map([["A", 1]]));
    const board: AcceptedInterpretationStep = { ...task, interpretationId: "board", requestId: "board", consumesCheckpointIds: ["B"], baseCueRevision: afterTask.cue.revision, boardDelta: { action: "SET_ACTIVE", contribution: domainBoard(), continuity: "same_thread", retainPrevious: false }, cueDelta: { action: "KEEP" } };
    const afterBoard = reduceAcceptedStep(afterTask, board, new Map([["A", 1], ["B", 2]]));
    expect(afterBoard.cue.active).toMatchObject({ kind: "TASK", contribution: { mode: "INITIATE" } });
  });

  it("requires explicit resolution before replacing an unresolved QUESTION or TASK", () => {
    const task: AcceptedInterpretationStep = {
      interpretationId: "task", requestId: "task", stepIndex: 0, consumesCheckpointIds: ["A"], baseBoardRevision: 0, baseCueRevision: 0,
      boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: initiatedCue("TASK"), evidenceRefs: [], warnings: [], model: "test", policyVersion: "test", acceptedAt: "2026-09-03T00:00:00.000Z",
    };
    const state = reduceAcceptedStep(createInitialTeachingState(), task, new Map([["A", 1]]));
    const input = request(state);
    const replacement = validateAndNormalizeProposal({ proposal: proposal({ action: "KEEP", reason: "no_board_value" }, initiatedCue("HINT"), [], { board: 0, cue: 1 }), request: input.request, allCheckpoints: [checkpoint], state, model: "test" });
    expect(replacement).toEqual({ ok: false, error: "proposal-active-learning-action-must-resolve-first" });
  });

  it("still enforces exact claimed speech quotes and persists mode/provenance through replay", () => {
    const input = request();
    const rejected = validateAndNormalizeProposal({ proposal: proposal({ action: "SET_ACTIVE", contribution: { ...speechBoard(), provenance: { basis: "SPEECH", speechRefs: [speech("invented quote")] } }, continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }, [speech("invented quote")]), request: input.request, allCheckpoints: [checkpoint], state: createInitialTeachingState(), model: "test" });
    expect(rejected).toEqual({ ok: false, error: "proposal-speech-grounding-invalid" });
    const accepted = validateAndNormalizeProposal({ proposal: proposal({ action: "SET_ACTIVE", contribution: domainBoard(), continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }, []), request: input.request, allCheckpoints: [checkpoint], state: createInitialTeachingState(), model: "test" });
    if (!accepted.ok) throw new Error("expected accepted domain contribution");
    const events = [...input.events, interpretationAcceptedEvent("s", 3, accepted.steps[0]!)];
    expect(projectProcessedTimeline(events)[1]).toMatchObject({ type: "accepted_interpretation", boardDelta: { action: "SET_ACTIVE", contribution: { mode: "AUGMENT", provenance: { basis: "DOMAIN_KNOWLEDGE" } } } });
    expect(replayLessonEvents(events).state).toEqual(replayLessonEvents(events).state);
  });

  it("makes old event records an explicit incompatible-session boundary", () => {
    expect(() => replayLessonEvents([{ type: "lesson.started", eventId: "legacy", sessionId: "s", sequence: 1, timestamp: "2026-09-03T00:00:00.000Z" } as never])).toThrow("lesson-event-schema-incompatible");
  });
});
