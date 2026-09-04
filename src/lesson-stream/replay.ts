import { LESSON_EVENT_SCHEMA_VERSION, type CompactEvidenceCheckpoint, type GroundingRecord, type LessonEvent, type TeachingStateSnapshot } from "./contracts.ts";
import { createInitialTeachingState, reduceLessonEvent } from "./teaching-state.ts";

export type LessonReplay = {
  events: LessonEvent[];
  state: TeachingStateSnapshot;
  checkpoints: CompactEvidenceCheckpoint[];
  grounding: Map<string, GroundingRecord>;
  consumedCheckpointIds: Set<string>;
  acceptedStepKeys: Set<string>;
  ended: boolean;
};

export function replayLessonEvents(input: readonly LessonEvent[]): LessonReplay {
  const events: LessonEvent[] = [];
  const eventIds = new Set<string>();
  const checkpoints: CompactEvidenceCheckpoint[] = [];
  const checkpointIds = new Set<string>();
  const checkpointSequences = new Map<string, number>();
  const grounding = new Map<string, GroundingRecord>();
  const consumedCheckpointIds = new Set<string>();
  const acceptedStepKeys = new Set<string>();
  let state = createInitialTeachingState();
  let sessionId: string | undefined;
  let ended = false;
  const sequences = new Set<number>();

  for (const event of [...input].sort((left, right) => left.sequence - right.sequence)) {
    if (event.schemaVersion !== LESSON_EVENT_SCHEMA_VERSION) throw new Error("lesson-event-schema-incompatible");
    if (eventIds.has(event.eventId)) continue;
    if (sequences.has(event.sequence)) throw new Error("lesson-event-sequence-collision");
    if (sessionId && event.sessionId !== sessionId) throw new Error("lesson-event-session-mismatch");
    sessionId ??= event.sessionId;
    if (ended && event.type !== "lesson.ended") throw new Error("lesson-already-ended");

    if (event.type === "evidence.checkpoint_committed") {
      if (checkpointIds.has(event.checkpoint.checkpointId)) continue;
      checkpointIds.add(event.checkpoint.checkpointId);
      checkpointSequences.set(event.checkpoint.checkpointId, event.checkpoint.lessonSequence);
      checkpoints.push(event.checkpoint);
      grounding.set(event.checkpoint.checkpointId, event.grounding);
    }

    if (event.type === "interpretation.step_accepted") {
      const stepKey = `${event.step.requestId}:${event.step.stepIndex}`;
      if (acceptedStepKeys.has(stepKey)) continue;
      for (const checkpointId of event.step.consumesCheckpointIds) {
        if (!checkpointIds.has(checkpointId)) throw new Error("interpretation-consumes-unknown-checkpoint");
        if (consumedCheckpointIds.has(checkpointId)) throw new Error("checkpoint-consumed-more-than-once");
      }
      event.step.consumesCheckpointIds.forEach((id) => consumedCheckpointIds.add(id));
      acceptedStepKeys.add(stepKey);
    }

    state = reduceLessonEvent(state, event, checkpointSequences);
    if (event.type === "lesson.ended") ended = true;
    eventIds.add(event.eventId);
    sequences.add(event.sequence);
    events.push(event);
  }

  return { events, state, checkpoints, grounding, consumedCheckpointIds, acceptedStepKeys, ended };
}

export function pendingEvidence(replay: LessonReplay) {
  return replay.checkpoints.filter((checkpoint) => !replay.consumedCheckpointIds.has(checkpoint.checkpointId));
}
