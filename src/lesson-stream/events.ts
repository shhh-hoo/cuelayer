import type { AcceptedInterpretationStep, GroundingRecord, LessonEvent, CompactEvidenceCheckpoint } from "./contracts";

function randomId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function lessonStartedEvent(sessionId: string, sequence: number, timestamp = new Date().toISOString()): LessonEvent {
  return { type: "lesson.started", eventId: randomId("lesson-started"), sessionId, sequence, timestamp };
}

export function checkpointCommittedEvent(sessionId: string, sequence: number, checkpoint: CompactEvidenceCheckpoint, grounding: GroundingRecord, timestamp = new Date().toISOString()): LessonEvent {
  return { type: "evidence.checkpoint_committed", eventId: randomId("checkpoint"), sessionId, sequence, timestamp, checkpoint, grounding };
}

export function interpretationAcceptedEvent(sessionId: string, sequence: number, step: AcceptedInterpretationStep): LessonEvent {
  return { type: "interpretation.step_accepted", eventId: randomId("interpretation"), sessionId, sequence, step };
}

export function cueExpiredEvent(sessionId: string, sequence: number, cueId: string, baseCueRevision: number, timestamp = new Date().toISOString()): LessonEvent {
  return { type: "teaching_cue.expired", eventId: randomId("cue-expired"), sessionId, sequence, cueId, baseCueRevision, timestamp };
}

export function lessonEndedEvent(sessionId: string, sequence: number, timestamp = new Date().toISOString()): LessonEvent {
  return { type: "lesson.ended", eventId: randomId("lesson-ended"), sessionId, sequence, timestamp };
}
