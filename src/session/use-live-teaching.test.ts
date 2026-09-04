import { describe, expect, it } from "vitest";
import type { AcceptedInterpretationStep } from "../lesson-stream/contracts";
import { createInitialTeachingState, reduceAcceptedStep } from "../lesson-stream/teaching-state";
import type { SessionTraceDraft } from "../trace/contracts";
import { checkpointTraceIdentity, emitAcceptedStepTrace } from "./use-live-teaching";

const step = (stepIndex: number, cueDelta: AcceptedInterpretationStep["cueDelta"]): AcceptedInterpretationStep => ({
  interpretationId: "batch-accepted", requestId: "batch", stepIndex, consumesCheckpointIds: [stepIndex ? "B" : "A"], baseBoardRevision: 0, baseCueRevision: stepIndex, boardDelta: { action: "KEEP", reason: "no_board_value" }, cueDelta, evidenceRefs: [], warnings: [], model: "test", policyVersion: "test", acceptedAt: "2026-09-03T00:00:00.000Z",
});

describe("live teaching trace correlation", () => {
  it("keeps checkpoint-open trace identity scoped to the speech run", () => {
    expect(checkpointTraceIdentity(1, "speech-span-0")).not.toBe(checkpointTraceIdentity(2, "speech-span-0"));
  });

  it("emits exact ordered Cue transitions for same-batch SET then RESOLVE", () => {
    const first = step(0, { action: "SET", cueKind: "NOTE", contribution: { mode: "RECONSTRUCT", content: "Complete the task", provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "A", quote: "Complete the task" }] } } });
    const beforeFirst = createInitialTeachingState();
    const afterFirst = reduceAcceptedStep(beforeFirst, first, new Map([["A", 1], ["B", 2]]));
    const second = step(1, { action: "RESOLVE_CURRENT", reason: "completed", evidence: { checkpointId: "B", quote: "Completed" } });
    const afterSecond = reduceAcceptedStep(afterFirst, second, new Map([["A", 1], ["B", 2]]));
    const drafts: SessionTraceDraft[] = [];
    emitAcceptedStepTrace({ transition: { step: first, stateBefore: beforeFirst, stateAfter: afterFirst }, speechRunId: 3, plannerRequestId: "batch", emit: (draft) => drafts.push(draft) });
    emitAcceptedStepTrace({ transition: { step: second, stateBefore: afterFirst, stateAfter: afterSecond }, speechRunId: 3, plannerRequestId: "batch", emit: (draft) => drafts.push(draft) });
    const set = drafts.find((draft) => draft.type === "teaching_cue.set");
    const resolved = drafts.find((draft) => draft.type === "teaching_cue.resolved");
    expect(set).toMatchObject({ payload: { cueId: "cue-batch-accepted-0", kind: "NOTE" }, correlation: { cueId: "cue-batch-accepted-0", cueRevision: 1 } });
    expect(resolved).toMatchObject({ payload: { cueId: "cue-batch-accepted-0", reason: "completed" }, correlation: { cueId: "cue-batch-accepted-0", cueRevision: 2 } });
  });

  it("projects bounded accepted learner content and provenance into exportable trace facts", () => {
    const accepted: AcceptedInterpretationStep = {
      ...step(0, { action: "SET", cueKind: "QUESTION", contribution: { mode: "INITIATE", content: "Which particle crosses the threshold?", provenance: { basis: "DOMAIN_KNOWLEDGE" } } }),
      interpretationId: "audit", requestId: "audit-request", consumesCheckpointIds: ["A"], warnings: [{ code: "checked" }],
      boardDelta: { action: "SET_ACTIVE", continuity: "same_thread", retainPrevious: false, contribution: { mode: "AUGMENT", content: { kind: "TEXT", text: "Al₂Cl₆" }, provenance: { basis: "DOMAIN_KNOWLEDGE" } }, support: [{ mode: "REPRESENT", content: "Teacher said aluminium chloride", provenance: { basis: "SPEECH", speechRefs: [{ checkpointId: "A", quote: "aluminium chloride" }] } }] },
    };
    const before = createInitialTeachingState();
    const after = reduceAcceptedStep(before, accepted, new Map([["A", 1]]));
    const drafts: SessionTraceDraft[] = [];
    emitAcceptedStepTrace({ transition: { step: accepted, stateBefore: before, stateAfter: after }, speechRunId: "speech-run-audit", plannerRequestId: accepted.requestId, emit: (draft) => drafts.push(draft) });
    const event = drafts.find((draft) => draft.type === "interpretation.step_accepted");
    expect(JSON.parse(JSON.stringify(event))).toMatchObject({
      payload: {
        acceptedContribution: {
          board: { action: "SET_ACTIVE", contribution: { mode: "AUGMENT", content: "Al₂Cl₆", provenance: { basis: "DOMAIN_KNOWLEDGE", speechRefs: [] } }, support: [{ mode: "REPRESENT", provenance: { speechRefs: [{ checkpointId: "A", quote: "aluminium chloride" }] } }] },
          cue: { action: "SET", kind: "QUESTION", contribution: { mode: "INITIATE", content: "Which particle crosses the threshold?" } },
          warnings: [{ code: "checked" }],
        },
      },
    });
  });
});
