import type { ContextProjectionDiagnostics, LessonEvent, ProcessedTimelineEntry, TeachingInterpretationRequest, TeachingStateSnapshot, CompactEvidenceCheckpoint } from "./contracts";
import { LESSON_POLICY_VERSION } from "./contracts";
import { createInitialTeachingState, reduceLessonEvent } from "./teaching-state";

const estimatedTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

export function projectProcessedTimeline(events: readonly LessonEvent[]): ProcessedTimelineEntry[] {
  const checkpointSequences = new Map<string, number>();
  const consumedCheckpointIds = new Set(events.flatMap((event) => event.type === "interpretation.step_accepted" ? event.step.consumesCheckpointIds : []));
  let state = createInitialTeachingState();
  const timeline: ProcessedTimelineEntry[] = [];
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === "evidence.checkpoint_committed") {
      checkpointSequences.set(event.checkpoint.checkpointId, event.checkpoint.lessonSequence);
      if (consumedCheckpointIds.has(event.checkpoint.checkpointId)) {
        timeline.push({ type: "evidence", checkpointId: event.checkpoint.checkpointId, sequence: event.checkpoint.lessonSequence, text: event.checkpoint.text, warnings: event.checkpoint.warnings });
      }
    }
    if (event.type === "interpretation.step_accepted") {
      state = reduceLessonEvent(state, event, checkpointSequences);
      timeline.push({
        type: "accepted_interpretation",
        interpretationId: event.step.interpretationId,
        consumesCheckpointIds: event.step.consumesCheckpointIds,
        boardDelta: event.step.boardDelta,
        cueDelta: event.step.cueDelta,
        resultingBoardRevision: state.board.revision,
        resultingCueRevision: state.cue.revision,
      });
    }
  }
  return timeline;
}

export function buildTeachingInterpretationRequest({
  requestId,
  sessionId,
  events,
  currentState,
  newEvidence,
}: {
  requestId: string;
  sessionId: string;
  events: readonly LessonEvent[];
  currentState: TeachingStateSnapshot;
  newEvidence: CompactEvidenceCheckpoint[];
}): { request: TeachingInterpretationRequest; diagnostics: ContextProjectionDiagnostics } {
  if (!newEvidence.length) throw new Error("interpretation-request-needs-evidence");
  const processedTimeline = projectProcessedTimeline(events);
  const request: TeachingInterpretationRequest = {
    requestId,
    sessionId,
    policyVersion: LESSON_POLICY_VERSION,
    processedTimeline,
    currentState,
    newEvidence,
    expected: {
      firstUnconsumedSequence: newEvidence[0]!.lessonSequence,
      lastUnconsumedSequence: newEvidence.at(-1)!.lessonSequence,
    },
  };
  const diagnostics = {
    policyTokens: estimatedTokens(LESSON_POLICY_VERSION),
    timelineTokens: estimatedTokens(processedTimeline),
    stateTokens: estimatedTokens(currentState),
    newEvidenceTokens: estimatedTokens(newEvidence),
    projectedInputTokens: estimatedTokens(request),
  };
  return { request, diagnostics };
}
