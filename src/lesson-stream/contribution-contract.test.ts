import { describe, expect, it } from "vitest";
import { validateAndNormalizeProposal } from "./accepted-interpretations";
import { buildTeachingInterpretationRequest, projectProcessedTimeline } from "./context-projection";
import { checkpointCommittedEvent, interpretationAcceptedEvent, lessonStartedEvent } from "./events";
import { replayLessonEvents } from "./replay";
import { createInitialTeachingState, reduceAcceptedStep } from "./teaching-state";
import { ALPHA_AUGMENT_CANDIDATE_P4, ALPHA_CORE_P4 } from "./semantic-profile";
import { LESSON_EVENT_SCHEMA_VERSION, interventionRiskFor, type AcceptedInterpretationStep, type CompactEvidenceCheckpoint, type ContributionMode, type ContributionProvenance, type TeachingStateSnapshot } from "./contracts";

const checkpoint: CompactEvidenceCheckpoint = { checkpointId: "A", lessonSequence: 1, speechRunId: 1, startMs: 0, endMs: 100, text: "The formula sounded like d6. Aluminium chloride forms a dimer. Write this as a note.", sourceFinalIds: ["final-A"], warnings: [] };
const grounding = { checkpointId: "A", canonicalSpanIds: [{ spanId: "span-A", spanRevision: 1 }], words: [], providerEvidence: [{ providerFinalId: "final-A" }] };
const speech = (quote = "d6") => ({ checkpointId: "A", quote });
const speechProvenance = (quote = "d6"): ContributionProvenance => ({ basis: "SPEECH", speechRefs: [speech(quote)] });
const board = (mode: ContributionMode, provenance: ContributionProvenance, text = "Al₂Cl₆") => ({ mode, content: { kind: "TEXT" as const, text }, provenance });
const cue = (mode: ContributionMode, provenance: ContributionProvenance, cueKind: "NOTE" | "QUESTION" | "TASK" | "HINT" = "NOTE") => ({ action: "SET" as const, cueKind, contribution: { mode, content: "Write this as a note", provenance } });

function stateWithBoard(): TeachingStateSnapshot {
  return { ...createInitialTeachingState(), board: { revision: 1, active: { id: "board-old", contribution: board("REPRESENT", speechProvenance()), sourceCheckpointIds: ["A"], establishedAtRevision: 1 }, support: [], retained: [] } };
}
function request(state = createInitialTeachingState(), profile = ALPHA_CORE_P4) {
  const events = [lessonStartedEvent("s", 1), checkpointCommittedEvent("s", 2, checkpoint, grounding)];
  return { events, request: buildTeachingInterpretationRequest({ requestId: "request", sessionId: "s", events, currentState: state, newEvidence: [checkpoint], profile }).request };
}
function proposal(boardDelta: unknown, cueDelta: unknown, evidenceRefs: unknown[] = [speech()], revisions = { board: 0, cue: 0 }) {
  return { requestId: "request", baseBoardRevision: revisions.board, baseCueRevision: revisions.cue, steps: [{ consumesCheckpointIds: ["A"], boardDelta, cueDelta, evidenceRefs }] };
}
function validate(boardDelta: unknown, cueDelta: unknown, options: { state?: TeachingStateSnapshot; profile?: typeof ALPHA_CORE_P4 | typeof ALPHA_AUGMENT_CANDIDATE_P4; evidenceRefs?: unknown[] } = {}) {
  const state = options.state ?? createInitialTeachingState();
  const profile = options.profile ?? ALPHA_CORE_P4;
  const input = request(state, profile);
  return validateAndNormalizeProposal({ proposal: proposal(boardDelta, cueDelta, options.evidenceRefs ?? [speech()], { board: state.board.revision, cue: state.cue.revision }), request: input.request, allCheckpoints: [checkpoint], state, model: "test", profile });
}

describe("Alpha contribution profile and provenance", () => {
  it("retains broad risk vocabulary without granting Alpha authority", () => {
    expect(interventionRiskFor("RECONSTRUCT")).toBe("LOW");
    expect(interventionRiskFor("AUGMENT")).toBe("MEDIUM");
    expect(interventionRiskFor("CORRECT")).toBe("HIGH");
    expect(interventionRiskFor("INITIATE", "TASK")).toBe("HIGH");
    expect(LESSON_EVENT_SCHEMA_VERSION).toBe("lesson-event-v3-learner-agency");
  });

  it("accepts grounded RECONSTRUCT and REPRESENT under the core profile", () => {
    for (const mode of ["RECONSTRUCT", "REPRESENT"] as const) {
      expect(validate({ action: "SET_ACTIVE", contribution: board(mode, speechProvenance()), continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }).ok).toBe(true);
    }
  });

  it("rejects CORRECT and INITIATE from manually submitted Alpha proposals", () => {
    const state = stateWithBoard();
    const correction = validate({ action: "SET_ACTIVE", contribution: board("CORRECT", { basis: "STATE_AND_DOMAIN_KNOWLEDGE", stateRefs: [{ kind: "BOARD_ITEM", id: "board-old" }] }), continuity: "correction", retainPrevious: false, invalidatesBoardItemIds: ["board-old"] }, { action: "KEEP" }, { state });
    expect(correction).toEqual({ ok: false, error: "proposal-mode-not-allowed" });
    expect(validate({ action: "KEEP", reason: "no_board_value" }, cue("INITIATE", { basis: "DOMAIN_KNOWLEDGE" }, "TASK"))).toEqual({ ok: false, error: "proposal-mode-not-allowed" });
  });

  it("keeps Board AUGMENT behind the candidate profile", () => {
    const delta = { action: "SET_ACTIVE", contribution: board("AUGMENT", { basis: "DOMAIN_KNOWLEDGE" }), continuity: "same_thread", retainPrevious: false };
    expect(validate(delta, { action: "KEEP" })).toEqual({ ok: false, error: "proposal-mode-not-allowed" });
    const candidate = validate(delta, { action: "KEEP" }, { profile: ALPHA_AUGMENT_CANDIDATE_P4 });
    expect(candidate.ok).toBe(true);
  });

  it("requires a current consumed trigger even for domain knowledge", () => {
    const delta = { action: "SET_ACTIVE", contribution: board("AUGMENT", { basis: "DOMAIN_KNOWLEDGE" }), continuity: "same_thread", retainPrevious: false };
    expect(validate(delta, { action: "KEEP" }, { profile: ALPHA_AUGMENT_CANDIDATE_P4, evidenceRefs: [] })).toEqual({ ok: false, error: "proposal-current-trigger-missing" });
  });

  it("resolves checkpoint references to canonical evidence without requiring model quote copying", () => {
    const visible = board("RECONSTRUCT", speechProvenance(), "Al₂Cl₆");
    expect(validate({ action: "SET_ACTIVE", contribution: visible, continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }).ok).toBe(true);
    const normalized = validate({ action: "SET_ACTIVE", contribution: visible, continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }, { evidenceRefs: [speech("harmless punctuation difference.")] });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) expect(normalized.steps[0]!.evidenceRefs).toEqual([{ checkpointId: "A", quote: checkpoint.text }]);
    const unknown = { checkpointId: "missing", quote: "The formula sounded like d6." };
    expect(validate({ action: "SET_ACTIVE", contribution: visible, continuity: "same_thread", retainPrevious: false }, { action: "KEEP" }, { evidenceRefs: [unknown] })).toEqual({ ok: false, error: "proposal-provenance-checkpoint-invalid" });
  });

  it("keeps a valid Active update while dropping an invalid optional Support deterministically", () => {
    const delta = {
      action: "SET_ACTIVE" as const,
      contribution: board("REPRESENT", speechProvenance("Aluminium chloride forms a dimer"), "Activation energy"),
      continuity: "same_thread" as const,
      retainPrevious: false,
      support: [{ mode: "REPRESENT" as const, content: "Standard symbol: Eₐ", provenance: { basis: "DOMAIN_KNOWLEDGE" as const } }],
    };
    const result = validate(delta, { action: "KEEP" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]!.boardDelta).not.toHaveProperty("support");
    expect(result.steps[0]!.warnings).toContainEqual({ code: "board_support_dropped" });
    const replayed = replayLessonEvents([...request().events, interpretationAcceptedEvent("s", 3, result.steps[0]!)]);
    expect(replayed.state.board.active?.contribution.content).toEqual({ kind: "TEXT", text: "Activation energy" });
    expect(replayed.state.board.support).toEqual([]);
  });

  it("requires speech-bearing provenance for RECONSTRUCT and REPRESENT", () => {
    for (const mode of ["RECONSTRUCT", "REPRESENT"] as const) {
      expect(validate({ action: "SET_ACTIVE", contribution: board(mode, { basis: "DOMAIN_KNOWLEDGE" }), continuity: "same_thread", retainPrevious: false }, { action: "KEEP" })).toEqual({ ok: false, error: "proposal-contribution-provenance-invalid" });
    }
  });

  it("requires teacher-originated speech provenance and disallows AUGMENT for every Cue", () => {
    for (const kind of ["NOTE", "QUESTION", "TASK", "HINT"] as const) {
      expect(validate({ action: "KEEP", reason: "no_board_value" }, cue("REPRESENT", speechProvenance("Write this as a note"), kind)).ok).toBe(true);
      expect(validate({ action: "KEEP", reason: "no_board_value" }, cue("REPRESENT", { basis: "DOMAIN_KNOWLEDGE" }, kind))).toEqual({ ok: false, error: "proposal-contribution-provenance-invalid" });
      expect(validate({ action: "KEEP", reason: "no_board_value" }, cue("AUGMENT", { basis: "DOMAIN_KNOWLEDGE" }, kind)).ok).toBe(false);
    }
  });

  it("supports teacher correction with REPRESENT and explicit invalidation", () => {
    const state = stateWithBoard();
    const result = validate({ action: "SET_ACTIVE", contribution: board("REPRESENT", { basis: "SPEECH_AND_STATE", speechRefs: [speech("The formula sounded like d6")], stateRefs: [{ kind: "BOARD_ITEM", id: "board-old" }] }, "The corrected claim"), continuity: "correction", retainPrevious: false, invalidatesBoardItemIds: ["board-old"] }, { action: "KEEP" }, { state });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const replay = replayLessonEvents([...request(state).events, interpretationAcceptedEvent("s", 3, result.steps[0]!)]);
    expect(replay.state.board.active?.contribution.mode).toBe("REPRESENT");
    expect(replay.state.board.retained).toEqual([]);
  });

  it("does not resolve an active TASK merely because Board changes", () => {
    const task: AcceptedInterpretationStep = { interpretationId: "task", requestId: "task", stepIndex: 0, consumesCheckpointIds: ["A"], baseBoardRevision: 0, baseCueRevision: 0, boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: cue("REPRESENT", speechProvenance("Write this as a note"), "TASK"), evidenceRefs: [speech("Write this as a note")], warnings: [], model: "test", policyVersion: ALPHA_CORE_P4.policyVersion, acceptedAt: "2026-09-03T00:00:00.000Z" };
    const afterTask = reduceAcceptedStep(createInitialTeachingState(), task, new Map([["A", 1]]));
    const boardStep: AcceptedInterpretationStep = { ...task, interpretationId: "board", requestId: "board", consumesCheckpointIds: ["B"], baseCueRevision: afterTask.cue.revision, boardDelta: { action: "SET_ACTIVE", contribution: board("REPRESENT", speechProvenance()), continuity: "same_thread", retainPrevious: false }, cueDelta: { action: "KEEP" } };
    expect(reduceAcceptedStep(afterTask, boardStep, new Map([["B", 2]])).cue.active?.kind).toBe("TASK");
  });

  it("keeps explicit Support attached to a newly established topic", () => {
    const step: AcceptedInterpretationStep = {
      interpretationId: "topic-with-support", requestId: "topic-with-support", stepIndex: 0,
      consumesCheckpointIds: ["A"], baseBoardRevision: 0, baseCueRevision: 0,
      boardDelta: {
        action: "SET_ACTIVE",
        contribution: board("REPRESENT", speechProvenance(), "Electrolysis"),
        continuity: "topic_shift", retainPrevious: false,
        support: [{ mode: "REPRESENT", content: "Reduction occurs at the cathode.", provenance: speechProvenance() }],
      },
      cueDelta: { action: "KEEP" }, evidenceRefs: [speech("Electrolysis")], warnings: [], model: "test",
      policyVersion: ALPHA_CORE_P4.policyVersion, acceptedAt: "2026-09-03T00:00:00.000Z",
    };
    const state = reduceAcceptedStep(createInitialTeachingState(), step, new Map([["A", 1]]));
    expect(state.board).toMatchObject({ active: { contribution: { content: { text: "Electrolysis" } } }, support: [{ targetBoardItemId: "board-topic-with-support-0", contribution: { content: "Reduction occurs at the cathode." } }] });
  });

  it("replays previously accepted broad-vocabulary events without current-profile validation", () => {
    const accepted: AcceptedInterpretationStep = { interpretationId: "legacy", requestId: "legacy", stepIndex: 0, consumesCheckpointIds: ["A"], baseBoardRevision: 0, baseCueRevision: 0, boardDelta: { action: "SET_ACTIVE", contribution: board("CORRECT", { basis: "DOMAIN_KNOWLEDGE" }, "Legacy correction"), continuity: "correction", retainPrevious: false, invalidatesBoardItemIds: ["historical"] }, cueDelta: { action: "SET", cueKind: "TASK", contribution: { mode: "INITIATE", content: "Legacy task", provenance: { basis: "DOMAIN_KNOWLEDGE" } } }, evidenceRefs: [], warnings: [], model: "legacy", policyVersion: "bounded-agent-p4-alpha-v2", acceptedAt: "2026-09-03T00:00:00.000Z" };
    const events = [...request().events, interpretationAcceptedEvent("s", 3, accepted)];
    const replay = replayLessonEvents(events);
    expect(projectProcessedTimeline(events)[1]).toMatchObject({ type: "accepted_interpretation", boardDelta: { contribution: { mode: "CORRECT" } }, cueDelta: { contribution: { mode: "INITIATE" } } });
    expect(replay.state.board.active?.contribution.mode).toBe("CORRECT");
    expect(replay.state.cue.active?.contribution.mode).toBe("INITIATE");
  });
});
