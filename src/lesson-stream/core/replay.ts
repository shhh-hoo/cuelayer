import type { LiveProcessing, UnresolvedObligation } from "./session-processing.ts";
import type { CompactEvidenceCheckpoint, GroundingRecord } from "../contracts.ts";
import type { CoreEvent, CoreTeachingState } from "./contracts.ts";
import { coreEventSchema } from "./events.ts";
import { createCoreTeachingState, reduceCoreStep } from "./teaching-state.ts";

export type CoreReplay = {
  events: CoreEvent[];
  state: CoreTeachingState;
  checkpoints: CompactEvidenceCheckpoint[];
  grounding: Map<string, GroundingRecord>;
  consumedCheckpointIds: Set<string>;
  dispositions: Map<string, LiveProcessing["dispositions"][number]>;
  unresolved: Map<string, UnresolvedObligation>;
  reviews: Map<string, NonNullable<LiveProcessing["review"]>>;
  ended: boolean;
};

export function createCoreReplay(sessionId: string): CoreReplay {
  return { events: [], state: createCoreTeachingState(sessionId), checkpoints: [], grounding: new Map(), consumedCheckpointIds: new Set(), dispositions: new Map(), unresolved: new Map(), reviews: new Map(), ended: false };
}

/** Pure event fold, shared by offline acceptance and replay. This function does not persist or publish. */
export function appendCoreEvent(base: CoreReplay, input: unknown): CoreReplay {
  const event = coreEventSchema.parse(input);
  if (event.sessionId !== base.state.sessionId) throw new Error("core-event-session-mismatch");
  const duplicate = base.events.find(e => e.eventId === event.eventId);
  if (duplicate) {
    if (JSON.stringify(duplicate) !== JSON.stringify(event)) throw new Error("core-event-identity-collision");
    return base;
  }
  if (event.sequence !== (base.events.at(-1)?.sequence ?? 0) + 1) throw new Error("core-event-sequence-invalid");
  if (base.ended) throw new Error("core-lesson-ended");
  if (!base.events.length && event.type !== "lesson.started") throw new Error("core-lesson-not-started");
  if (base.events.length && event.type === "lesson.started") throw new Error("core-lesson-already-started");

  if (event.type === "speech.run_allocated" && base.events.some(e => e.type === "speech.run_allocated" && e.runId === event.runId)) throw new Error("core-speech-run-identity-collision");
  let next = base;
  if (event.type === "evidence.checkpoint_committed") {
    const { checkpoint, grounding } = event;
    if (base.checkpoints.some(c => c.checkpointId === checkpoint.checkpointId)) throw new Error("core-checkpoint-identity-collision");
    if (checkpoint.lessonSequence !== base.checkpoints.length + 1) throw new Error("core-checkpoint-sequence-invalid");
    if (grounding.checkpointId !== checkpoint.checkpointId
      || JSON.stringify(grounding.providerEvidence.map(p => p.providerFinalId)) !== JSON.stringify(checkpoint.sourceFinalIds)) throw new Error("core-grounding-mismatch");
    if (grounding.immutableFinal) {
      const final = grounding.immutableFinal;
      if (final.evidenceId !== JSON.stringify(["speech-final", final.speechRunId, final.providerFinalId])
        || checkpoint.checkpointId !== JSON.stringify(["checkpoint", final.evidenceId])
        || checkpoint.speechRunId !== final.speechRunId
        || JSON.stringify(checkpoint.sourceFinalIds) !== JSON.stringify([final.evidenceId])) throw new Error("core-final-grounding-mismatch");
    }
    next = { ...base, checkpoints: [...base.checkpoints, checkpoint], grounding: new Map([...base.grounding, [checkpoint.checkpointId, grounding]]) };
  }
  if (event.type === "core.step_accepted") {
    if (base.events.some(e => e.type === "core.step_accepted" && e.step.requestId === event.step.requestId && e.step.stepIndex === event.step.stepIndex)) throw new Error("core-step-identity-collision");
    const state = reduceCoreStep(base.state, event.step, base.checkpoints);
    const dispositions = new Map(base.dispositions), unresolved = new Map(base.unresolved), reviews = new Map(base.reviews);
    const processing = event.step.liveProcessing;
    const changed = state.knowledge.revision !== base.state.knowledge.revision || state.cue.revision !== base.state.cue.revision;
    const records = processing?.dispositions ?? event.step.consumesCheckpointIds.map(checkpointId => ({ checkpointId, kind: changed ? "semantic_change" as const : "resolved_no_change" as const }));
    if (JSON.stringify(records.map(r => r.checkpointId)) !== JSON.stringify(event.step.consumesCheckpointIds)) throw new Error("core-processing-coverage-invalid");
    for (const record of records) {
      if (record.kind === "semantic_change" && !changed || record.kind === "resolved_no_change" && changed) throw new Error("core-processing-disposition-invalid");
      if (record.kind === "deferred_unresolved") {
        if (!record.phrase.trim() || !base.checkpoints.find(c => c.checkpointId === record.checkpointId)?.text.includes(record.phrase)) throw new Error("core-processing-unresolved-grounding");
        unresolved.set(record.checkpointId, { checkpointId: record.checkpointId, phrase: record.phrase });
      }
      dispositions.set(record.checkpointId, record);
    }
    if (new Set(processing?.resolvedObligationIds).size !== (processing?.resolvedObligationIds.length ?? 0)) throw new Error("core-processing-resolution-duplicate");
    for (const id of processing?.resolvedObligationIds ?? []) {
      if (!base.unresolved.has(id)) throw new Error("core-processing-obligation-missing");
      unresolved.delete(id);
    }
    if (processing?.review) {
      if (JSON.stringify(processing.review.checkpointIds) !== JSON.stringify(event.step.consumesCheckpointIds) || reviews.has(processing.review.id)) throw new Error("core-processing-review-invalid");
      reviews.set(processing.review.id, processing.review);
    }
    next = { ...base, state, dispositions, unresolved, reviews, consumedCheckpointIds: new Set([...base.consumedCheckpointIds, ...event.step.consumesCheckpointIds]) };
  }
  if (event.type === "teaching_cue.expired" && base.state.cue.active?.id === event.cueId && base.state.cue.revision === event.baseCueRevision) {
    if (base.state.cue.active.kind !== "NOTE") throw new Error("core-only-note-can-expire");
    next = { ...base, state: { ...base.state, cue: { revision: base.state.cue.revision + 1 } } };
  }
  if (event.type === "lesson.ended" && base.checkpoints.some(c => !base.dispositions.has(c.checkpointId))) throw new Error("core-ended-with-pending-evidence");
  return { ...next, events: [...base.events, event], ended: event.type === "lesson.ended" };
}

export function replayCoreEvents(input: readonly unknown[], emptySessionId?: string): CoreReplay {
  // Validate every envelope before deduplication: a foreign generation cannot hide behind an ID.
  const events = input.map(event => coreEventSchema.parse(event)).sort((a, b) => a.sequence - b.sequence);
  const sessionId = events[0]?.sessionId ?? emptySessionId;
  if (!sessionId) throw new Error("core-session-id-required");
  return events.reduce(appendCoreEvent, createCoreReplay(sessionId));
}

export function pendingCoreEvidence(replay: CoreReplay) {
  return replay.checkpoints.slice(replay.state.processedThroughSequence);
}
