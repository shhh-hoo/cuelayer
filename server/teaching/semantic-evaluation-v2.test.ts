import { describe, expect, it } from "vitest";
import { buildTeachingInterpretationRequest } from "../../src/lesson-stream/context-projection";
import { LESSON_EVENT_SCHEMA_VERSION, type AcceptedInterpretationStep, type LessonEvent } from "../../src/lesson-stream/contracts";
import { pendingEvidence, replayLessonEvents } from "../../src/lesson-stream/replay";
import { ALPHA_CORE_P4 } from "../../src/lesson-stream/semantic-profile";
import {
  assessSemanticResultV2,
  loadSemanticCorpusV2,
  matchSemanticPredicate,
  validateSemanticCorpusV2,
} from "./semantic-evaluation-v2";

function committedEvent(item: ReturnType<typeof loadSemanticCorpusV2>["cases"][number], sequence: number): LessonEvent {
  const checkpoint = item.orderedNewCheckpoints[0]!;
  return {
    schemaVersion: LESSON_EVENT_SCHEMA_VERSION,
    type: "evidence.checkpoint_committed",
    eventId: `${item.id}-deterministic-commit`,
    sessionId: item.id,
    sequence,
    timestamp: "2026-09-04T01:00:00.000Z",
    checkpoint,
    grounding: {
      checkpointId: checkpoint.checkpointId,
      canonicalSpanIds: [{ spanId: `${item.id}-current-1`, spanRevision: 1 }],
      words: [],
      providerEvidence: checkpoint.sourceFinalIds.map((providerFinalId) => ({ providerFinalId })),
    },
  };
}

function keepStep(item: ReturnType<typeof loadSemanticCorpusV2>["cases"][number]): AcceptedInterpretationStep {
  return {
    interpretationId: `${item.id}-keep`, requestId: `${item.id}-keep`, stepIndex: 0,
    consumesCheckpointIds: [item.orderedNewCheckpoints[0]!.checkpointId],
    baseBoardRevision: item.expectedInitialState.board.revision,
    baseCueRevision: item.expectedInitialState.cue.revision,
    boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta: { action: "KEEP" },
    evidenceRefs: [], warnings: [], model: "deterministic", policyVersion: ALPHA_CORE_P4.policyVersion,
    acceptedAt: "2026-09-04T01:00:01.000Z",
  };
}

function acceptedEvent(item: ReturnType<typeof loadSemanticCorpusV2>["cases"][number], step: AcceptedInterpretationStep, sequence: number, suffix: string): LessonEvent {
  return {
    schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "interpretation.step_accepted",
    eventId: `${item.id}-${suffix}`, sessionId: item.id, sequence, step,
  };
}

describe("SEMANTICS v2 frozen benchmark", () => {
  it("validates hash, split, matched scenario pairs, profile gold, and augmentation coverage", () => {
    expect(validateSemanticCorpusV2()).toMatchObject({ ok: true, errors: [], caseCount: 60, developmentCount: 40, holdoutCount: 20 });
    const holdout = loadSemanticCorpusV2().cases.filter((item) => item.split === "holdout");
    expect(holdout.filter((item) => item.goldByProfile.augment.mustAugment)).toHaveLength(5);
    expect(holdout.filter((item) => item.tags.includes("negative-augment-trap"))).toHaveLength(3);
    expect(holdout.every((item) => item.goldByProfile.core && item.goldByProfile.augment)).toBe(true);
  });

  it("matches structured conditions, polarity, direction, uncertainty, quantities, and leakage without conjunction proxies", () => {
    expect(matchSemanticPredicate("Exothermic forward reaction; a temperature rise favours reverse.", {
      conditions: [{ antecedent: { allOf: [["forward"], ["exothermic"]] }, consequence: { allOf: [["temperature rise"], ["reverse"]] } }],
    }).ok).toBe(true);
    expect(matchSemanticPredicate("The route does not raise activation energy; it lowers the barrier.", {
      propositions: [{ allOf: [["lowers", "lower"], ["barrier", "activation energy"]] }],
      polarity: [{ claim: { allOf: [["activation energy", "barrier"], ["raise", "raises", "higher"]] }, value: "negated" }],
    }).ok).toBe(true);
    expect(matchSemanticPredicate("This may need 25 kilojoules, and the class should predict the direction.", {
      uncertainty: [{ claim: { allOf: [["need"], ["25"]] }, markers: ["may", "might"] }],
      quantities: [{ value: ["25"], unit: ["kilojoules", "kj"] }],
      answerLeakage: [{ allOf: [["shift right", "moves right"]] }],
    }).ok).toBe(true);
  });

  it("builds requests through the production P4 projection and selected profile", () => {
    const item = loadSemanticCorpusV2().cases[0]!;
    const replay = replayLessonEvents(item.initialLessonEvents);
    const { request } = buildTeachingInterpretationRequest({
      requestId: "v2-production-path", sessionId: item.id, events: replay.events,
      currentState: replay.state, newEvidence: item.orderedNewCheckpoints, profile: ALPHA_CORE_P4,
    });
    expect(request).toMatchObject({ semanticProfileId: ALPHA_CORE_P4.id, currentState: replay.state, newEvidence: item.orderedNewCheckpoints });
  });
});

describe("SEMANTICS v2 deterministic runtime invariants", () => {
  const augmentCoreCase = () => loadSemanticCorpusV2().cases.find((item) => item.id === "SEM2-H-13")!;
  const keepOnlyCase = () => {
    const item = structuredClone(augmentCoreCase());
    item.goldByProfile.core = {
      expectedBoardActions: ["KEEP"], expectedCueActions: ["KEEP"], expectedCueKinds: [null],
      allowedContributionModes: [], requiredCurrentTriggerCheckpointIds: [],
      finalState: { boardActive: "INITIAL", support: "INITIAL", retained: "INITIAL", cue: "INITIAL" },
      mustAugment: false,
    };
    return item;
  };

  it("counts a rejected proposal's committed checkpoint as preserved while it remains pending", () => {
    const item = keepOnlyCase();
    const replayEvents = [...item.initialLessonEvents, committedEvent(item, item.initialLessonEvents.length + 1)];
    const replay = replayLessonEvents(replayEvents);
    expect(pendingEvidence(replay).map((checkpoint) => checkpoint.checkpointId)).toEqual([item.orderedNewCheckpoints[0]!.checkpointId]);
    const assessed = assessSemanticResultV2(item, ALPHA_CORE_P4, {
      normalizedSteps: [], resultingState: replay.state, replayEvents, replayEqual: true,
      accepted: false, rejectedReason: "proposal-mode-not-allowed",
    } as never);
    expect(assessed.lostCheckpointIds).toEqual([]);
    expect(assessed.safetyViolations).not.toContain("checkpoint_loss");
  });

  it("exempts accepted KEEP from current-trigger credit while consuming its checkpoint exactly once", () => {
    const item = keepOnlyCase();
    const step = keepStep(item);
    const replayEvents = [
      ...item.initialLessonEvents,
      committedEvent(item, item.initialLessonEvents.length + 1),
      acceptedEvent(item, step, item.initialLessonEvents.length + 2, "keep-event"),
    ];
    const replay = replayLessonEvents(replayEvents);
    const assessed = assessSemanticResultV2(item, ALPHA_CORE_P4, {
      normalizedSteps: [step], resultingState: replay.state, replayEvents, replayEqual: true, accepted: true,
    } as never);
    expect(assessed.currentTriggerPass).toBe(true);
    expect(assessed.lostCheckpointIds).toEqual([]);
    expect(assessed.pendingCheckpointIds).toEqual([]);
  });

  it("rejects duplicate consumption deterministically during replay", () => {
    const item = augmentCoreCase();
    const step = keepStep(item);
    const events = [
      ...item.initialLessonEvents,
      committedEvent(item, item.initialLessonEvents.length + 1),
      acceptedEvent(item, step, item.initialLessonEvents.length + 2, "first-consumption"),
      acceptedEvent(item, { ...step, interpretationId: `${item.id}-keep-again`, requestId: `${item.id}-keep-again` }, item.initialLessonEvents.length + 3, "second-consumption"),
    ];
    expect(() => replayLessonEvents(events)).toThrow("checkpoint-consumed-more-than-once");
  });

  it("replays prior broad contribution vocabulary without applying the current profile schema", () => {
    const item = augmentCoreCase();
    const checkpoint = item.orderedNewCheckpoints[0]!;
    const ref = { checkpointId: checkpoint.checkpointId, quote: checkpoint.text };
    const legacy: AcceptedInterpretationStep = {
      ...keepStep(item), interpretationId: `${item.id}-legacy`,
      boardDelta: { action: "SET_ACTIVE", contribution: { mode: "CORRECT", content: { kind: "TEXT", text: "Persisted legacy correction" }, provenance: { basis: "DOMAIN_KNOWLEDGE" } }, continuity: "correction", retainPrevious: false, invalidatesBoardItemIds: ["historical-id"] },
      cueDelta: { action: "SET", cueKind: "TASK", contribution: { mode: "INITIATE", content: "Persisted legacy task", provenance: { basis: "DOMAIN_KNOWLEDGE" } } },
      evidenceRefs: [ref],
    };
    const replay = replayLessonEvents([
      ...item.initialLessonEvents,
      committedEvent(item, item.initialLessonEvents.length + 1),
      acceptedEvent(item, legacy, item.initialLessonEvents.length + 2, "legacy-event"),
    ]);
    expect(replay.state.board.active?.contribution.mode).toBe("CORRECT");
    expect(replay.state.cue.active?.contribution.mode).toBe("INITIATE");
  });

  it("preserves an earlier valid Board change after later speech is accepted as KEEP", () => {
    const item = loadSemanticCorpusV2().cases.find((candidate) => candidate.id === "SEM2-H-11")!;
    const [first, second] = item.orderedNewCheckpoints;
    const firstRef = { checkpointId: first!.checkpointId, quote: first!.text };
    const set: AcceptedInterpretationStep = {
      interpretationId: `${item.id}-set`, requestId: `${item.id}-set`, stepIndex: 0,
      consumesCheckpointIds: [first!.checkpointId], baseBoardRevision: item.expectedInitialState.board.revision,
      baseCueRevision: item.expectedInitialState.cue.revision,
      boardDelta: { action: "SET_ACTIVE", contribution: { mode: "REPRESENT", content: { kind: "TEXT", text: "Organic nomenclature is now the main topic." }, provenance: { basis: "SPEECH", speechRefs: [firstRef] } }, continuity: "topic_shift", retainPrevious: false },
      cueDelta: { action: "KEEP" }, evidenceRefs: [firstRef], warnings: [], model: "deterministic",
      policyVersion: ALPHA_CORE_P4.policyVersion, acceptedAt: "2026-09-04T01:00:01.000Z",
    };
    const keep: AcceptedInterpretationStep = {
      ...set, interpretationId: `${item.id}-quiet`, requestId: `${item.id}-quiet`,
      consumesCheckpointIds: [second!.checkpointId], baseBoardRevision: item.expectedInitialState.board.revision + 1,
      boardDelta: { action: "KEEP", reason: "classroom_management" }, evidenceRefs: [],
    };
    const commit = (checkpoint: typeof first, sequence: number): LessonEvent => ({
      schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "evidence.checkpoint_committed", eventId: `${checkpoint!.checkpointId}-event`,
      sessionId: item.id, sequence, timestamp: "2026-09-04T01:00:00.000Z", checkpoint: checkpoint!,
      grounding: { checkpointId: checkpoint!.checkpointId, canonicalSpanIds: [], words: [], providerEvidence: checkpoint!.sourceFinalIds.map((providerFinalId) => ({ providerFinalId })) },
    });
    const base = item.initialLessonEvents.length;
    const events = [...item.initialLessonEvents, commit(first, base + 1), acceptedEvent(item, set, base + 2, "set-event"), commit(second, base + 3), acceptedEvent(item, keep, base + 4, "quiet-event")];
    const replay = replayLessonEvents(events);
    expect(replay.state.board.active?.contribution.content).toEqual({ kind: "TEXT", text: "Organic nomenclature is now the main topic." });
    expect(replay.consumedCheckpointIds).toEqual(new Set([first!.checkpointId, second!.checkpointId, ...item.initialLessonEvents.filter((event) => event.type === "interpretation.step_accepted").flatMap((event) => event.step.consumesCheckpointIds)]));
    expect(replayLessonEvents(events).state).toEqual(replay.state);
  });
});
