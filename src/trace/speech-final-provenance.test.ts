import { describe, expect, it } from "vitest";
import { validateAndNormalizeProposal } from "../lesson-stream/accepted-interpretations";
import { buildTeachingInterpretationRequest } from "../lesson-stream/context-projection";
import { checkpointFromClosedSpan } from "../lesson-stream/evidence-checkpoints";
import { createInitialTeachingState, reduceAcceptedStep } from "../lesson-stream/teaching-state";
import { closeOpenCanonicalSpeechSpans, applySpeechEvent, createInitialCanonicalSpeechState } from "../session/canonical-speech";
import { emitAcceptedStepTrace } from "../session/use-live-teaching";
import { traceDraft, type SessionTraceDraft } from "./contracts";
import { canonicalFinalTraceDraft } from "./use-canonical-trace";

describe("speech final provenance", () => {
  it("joins one speech final through canonical evidence, accepted Board work, and the teaching surface", () => {
    const runId = 4;
    const speechEventId = "speech-event-4-19";
    const speechFinal = traceDraft("speech.final_received", { runId, transcript: "Activation energy is required", wordCount: 4 }, {
      correlation: { rootId: `speech:${runId}`, runId, speechEventId },
    });
    const canonical = applySpeechEvent(createInitialCanonicalSpeechState(), {
      kind: "committed",
      speechEventId,
      text: "Activation energy is required",
      words: [{ text: "Activation", startMs: 0, endMs: 100 }],
    }, 100).state;
    const final = canonical.finals[0]!;
    const canonicalFinal = canonicalFinalTraceDraft(runId, final);
    const closed = closeOpenCanonicalSpeechSpans(canonical, "explicit_stop", 101);
    const closedSpan = closed.spans[0]!;
    const canonicalSpan = traceDraft("canonical.span_changed", {
      runId, spanId: closedSpan.id, revision: closedSpan.revision, status: closedSpan.status,
      closeReason: closedSpan.closeReason, transcript: closedSpan.text, sourceFinalIds: closedSpan.sourceFinalIds,
    }, { correlation: { rootId: `speech:${runId}:span:${closedSpan.id}@${closedSpan.revision}`, runId, spanId: closedSpan.id, spanRevision: closedSpan.revision } });
    const evidence = checkpointFromClosedSpan(closedSpan, runId, 1)!.checkpoint;
    const checkpoint = traceDraft("evidence.checkpoint_committed", {
      runId, checkpointId: evidence.checkpointId, lessonSequence: evidence.lessonSequence, sourceFinalIds: evidence.sourceFinalIds, warningCodes: [],
    }, { correlation: { rootId: `checkpoint:${evidence.checkpointId}`, runId, checkpointId: evidence.checkpointId, lessonSequence: evidence.lessonSequence } });
    const before = createInitialTeachingState();
    const { request } = buildTeachingInterpretationRequest({ requestId: "provenance-request", sessionId: "provenance-session", events: [], currentState: before, newEvidence: [evidence] });
    const accepted = validateAndNormalizeProposal({
      proposal: { requestId: request.requestId, baseBoardRevision: 0, baseCueRevision: 0, steps: [{
        consumesCheckpointIds: [evidence.checkpointId],
        boardDelta: { action: "SET_ACTIVE", content: { kind: "TEXT", source: { checkpointId: evidence.checkpointId, text: "Activation energy" } }, continuity: "same_thread", retainPrevious: false },
        cueDelta: { action: "KEEP" }, evidenceRefs: [{ checkpointId: evidence.checkpointId, text: "Activation energy" }],
      }] }, request, allCheckpoints: [evidence], state: before, model: "test",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const step = accepted.steps[0]!;
    const after = reduceAcceptedStep(before, step, new Map([[evidence.checkpointId, evidence.lessonSequence]]));
    const interpretation: SessionTraceDraft[] = [];
    emitAcceptedStepTrace({ transition: { step, stateBefore: before, stateAfter: after }, speechRunId: runId, plannerRequestId: request.requestId, emit: (draft) => interpretation.push(draft) });
    const board = interpretation.find((draft) => draft.type === "board.active_set")!;
    const surface = traceDraft("teaching_surface.rendered", { renderId: "render-1", boardRevision: after.board.revision, cueRevision: after.cue.revision, presentationMode: "presentationless" }, {
      correlation: { rootId: `teaching-state:${after.board.revision}:${after.cue.revision}`, renderId: "render-1", boardRevision: after.board.revision, cueRevision: after.cue.revision },
    });

    expect(speechFinal.correlation?.speechEventId).toBe(speechEventId);
    expect(canonicalFinal).toMatchObject({ payload: { speechEventId, finalId: final.id }, correlation: { speechEventId, finalId: final.id } });
    expect(canonicalSpan.payload.sourceFinalIds).toEqual([final.id]);
    expect(checkpoint.payload.sourceFinalIds).toEqual([final.id]);
    expect(request.newEvidence.map((item) => item.checkpointId)).toEqual([evidence.checkpointId]);
    expect(interpretation[0]).toMatchObject({ type: "interpretation.step_accepted", payload: { checkpointIds: [evidence.checkpointId] }, correlation: { plannerRequestId: request.requestId, boardRevision: after.board.revision } });
    expect(board).toMatchObject({ payload: { boardItemId: "board-provenance-request-accepted-0" }, correlation: { boardRevision: after.board.revision } });
    expect(surface.correlation).toMatchObject({ boardRevision: after.board.revision, cueRevision: after.cue.revision });
  });
});
