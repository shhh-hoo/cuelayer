import { LESSON_EVENT_SCHEMA_VERSION, type AcceptedInterpretationStep, type GroundingRecord, type LessonEvent, type CompactEvidenceCheckpoint } from "./contracts";

function randomId(prefix: string) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function lessonStartedEvent(sessionId: string, sequence: number, timestamp = new Date().toISOString()): LessonEvent {
  return { schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "lesson.started", eventId: randomId("lesson-started"), sessionId, sequence, timestamp };
}

export function checkpointCommittedEvent(sessionId: string, sequence: number, checkpoint: CompactEvidenceCheckpoint, grounding: GroundingRecord, timestamp = new Date().toISOString()): LessonEvent {
  return { schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "evidence.checkpoint_committed", eventId: randomId("checkpoint"), sessionId, sequence, timestamp, checkpoint, grounding };
}

export function interpretationAcceptedEvent(sessionId: string, sequence: number, step: AcceptedInterpretationStep): LessonEvent {
  return { schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "interpretation.step_accepted", eventId: randomId("interpretation"), sessionId, sequence, step };
}

export function cueExpiredEvent(sessionId: string, sequence: number, cueId: string, baseCueRevision: number, timestamp = new Date().toISOString()): LessonEvent {
  return { schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "teaching_cue.expired", eventId: randomId("cue-expired"), sessionId, sequence, cueId, baseCueRevision, timestamp };
}

export function lessonEndedEvent(sessionId: string, sequence: number, timestamp = new Date().toISOString()): LessonEvent {
  return { schemaVersion: LESSON_EVENT_SCHEMA_VERSION, type: "lesson.ended", eventId: randomId("lesson-ended"), sessionId, sequence, timestamp };
}
