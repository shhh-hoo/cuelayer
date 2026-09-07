// Synthetic offline domain fixtures; not a provider corpus or product ontology.
import { CORE_EVENT_SCHEMA_VERSION, type CoreEvent, type CoreStep, type Provenance } from "./contracts.ts";
import { appendCoreEvent, createCoreReplay, type CoreReplay } from "./replay.ts";
import { acceptCoreStep } from "./accepted-steps.ts";
import { coreEntityId } from "./events.ts";

export const timestamp = "2026-09-07T00:00:00.000Z";
export const evidenceText = "Synthetic teaching. Compare A and B. Correction: the earlier statement changes.";
export const speechRef = (checkpointId: string) => ({ checkpointId, quote: evidenceText });
export const provenance = (checkpointId: string): Provenance => ({ speechRefs: [speechRef(checkpointId)], stateRefs: [] });
export const fact = (checkpointId: string, text = "Synthetic proposition") => ({ text, provenance: provenance(checkpointId) });
export function envelope(base: CoreReplay) {
  const sequence = base.events.length + 1;
  return { schemaVersion: CORE_EVENT_SCHEMA_VERSION, sessionId: base.state.sessionId, eventId: `fixture-${sequence}`, sequence, timestamp } as const;
}
export function start(sessionId = "synthetic-lesson") {
  const base = createCoreReplay(sessionId);
  return appendCoreEvent(base, { ...envelope(base), type: "lesson.started" });
}
export function evidence(base: CoreReplay) {
  const lessonSequence = base.checkpoints.length + 1;
  const checkpointId = `checkpoint-${lessonSequence}`;
  return appendCoreEvent(base, { ...envelope(base), type: "evidence.checkpoint_committed",
    checkpoint: { checkpointId, lessonSequence, speechRunId: "synthetic-run", startMs: lessonSequence, endMs: lessonSequence + 1, text: evidenceText, sourceFinalIds: [], warnings: [] },
    grounding: { checkpointId, canonicalSpanIds: [{ spanId: `span-${lessonSequence}`, spanRevision: 1 }], words: [], providerEvidence: [] },
  });
}
export function stepFor(base: CoreReplay, override: Partial<CoreStep> = {}): CoreStep {
  const id = base.checkpoints.find(c => c.lessonSequence > base.state.processedThroughSequence)!.checkpointId;
  return { requestId: `request-${base.events.length}`, stepIndex: 0, baseKnowledgeRevision: base.state.knowledge.revision,
    baseCueRevision: base.state.cue.revision, consumesCheckpointIds: [id], knowledgeOps: [], cueDelta: { action: "KEEP" },
    evidenceRefs: [speechRef(id)], stateRefs: [], warnings: [], acceptedAt: timestamp, ...override };
}
export function foundation(base = evidence(start())) {
  const step = stepFor(base);
  const cp = step.consumesCheckpointIds[0]!;
  const id = (kind: Parameters<typeof coreEntityId>[2], index: number) => coreEntityId(base.state.sessionId, step, kind, index);
  const coreId = id("CORE", 0), a = id("OBJECT", 1), b = id("OBJECT", 2), relationId = id("RELATION", 3), supportId = id("SUPPORT", 4);
  step.knowledgeOps = [
    { action: "CREATE_CORE", id: coreId, provenance: provenance(cp) },
    { action: "ADD_OBJECT", coreId, id: a, value: fact(cp, "A definition") },
    { action: "ADD_OBJECT", coreId, id: b, value: fact(cp, "B proposition") },
    { action: "ADD_RELATION", coreId, id: relationId, value: { ...fact(cp, "A relates to B"), fromObjectId: a, toObjectId: b } },
    { action: "ADD_SUPPORT", coreId, id: supportId, value: { ...fact(cp, "An illustrative example"), target: { kind: "OBJECT", coreId, id: a } } },
    { action: "SET_CURRENT_CORE", coreId },
  ];
  const cueId = id("CUE", step.knowledgeOps.length);
  const value = { ...fact(cp, "Compare A and B"), kind: "QUESTION" as const, target: { kind: "RELATION" as const, coreId, id: relationId } };
  step.cueDelta = base.state.cue.active
    ? { action: "REPLACE", targetCueId: base.state.cue.active.id, id: cueId, evidence: speechRef(cp), value }
    : { action: "SET", id: cueId, value };
  const replay = acceptCoreStep(base, step).replay;
  return { base, replay, step, coreId, a, b, relationId, supportId, cueId };
}
export function expire(base: CoreReplay, cueId = base.state.cue.active!.id, baseCueRevision = base.state.cue.revision): CoreEvent {
  return { ...envelope(base), type: "teaching_cue.expired", cueId, baseCueRevision };
}
