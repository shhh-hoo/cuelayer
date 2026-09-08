import { z } from "zod";
import { CORE_EVENT_SCHEMA_VERSION, coreStepSchema, type CoreEvent, type CoreStep } from "./contracts.ts";

const id = z.string().min(1);
const natural = z.number().int().nonnegative().safe();
const time = z.number().nonnegative().finite();
const checkpoint = z.object({
  checkpointId: id, lessonSequence: natural.min(1), speechRunId: z.union([id, natural]),
  startMs: time, endMs: time, text: z.string().refine(s => s.trim().length > 0), sourceFinalIds: z.array(id),
  warnings: z.array(z.object({ code: z.enum(["low_confidence", "possible_correction", "provider_gap", "asr_ambiguity"]), detail: z.string().optional() }).strict()),
}).strict().refine(c => c.endMs >= c.startMs, "checkpoint-time-order");
const grounding = z.object({
  checkpointId: id,
  canonicalSpanIds: z.array(z.object({ spanId: id, spanRevision: natural }).strict()).min(1),
  words: z.array(z.object({ text: z.string(), startMs: time, endMs: time, confidence: z.number().min(0).max(1).optional() }).strict()),
  providerEvidence: z.array(z.object({ providerFinalId: id }).strict()),
}).strict();
const identity = { schemaVersion: z.literal(CORE_EVENT_SCHEMA_VERSION), eventId: id, sessionId: id, sequence: natural.min(1) };
const timestamp = z.iso.datetime();
export const coreEventSchema = z.discriminatedUnion("type", [
  z.object({ ...identity, type: z.literal("lesson.started"), timestamp }).strict(),
  z.object({ ...identity, type: z.literal("speech.run_allocated"), timestamp, runId: id }).strict(),
  z.object({ ...identity, type: z.literal("evidence.checkpoint_committed"), timestamp, checkpoint, grounding }).strict(),
  z.object({ ...identity, type: z.literal("core.step_accepted"), step: coreStepSchema }).strict(),
  z.object({ ...identity, type: z.literal("teaching_cue.expired"), cueId: id, baseCueRevision: natural, timestamp }).strict(),
  z.object({ ...identity, type: z.literal("lesson.ended"), timestamp }).strict(),
]);

/** Identity is the immutable creation site, never text, current array position or renderer state. */
export function coreEntityId(sessionId: string, step: Pick<CoreStep, "requestId" | "stepIndex">, kind: "CORE" | "OBJECT" | "RELATION" | "SUPPORT" | "CUE", operationIndex: number) {
  return JSON.stringify([sessionId, step.requestId, step.stepIndex, kind, operationIndex]);
}

/** No randomness or clock access: the caller supplies durable acceptance metadata. */
export function coreAcceptedEvent(sessionId: string, sequence: number, step: CoreStep): CoreEvent {
  return coreEventSchema.parse({ schemaVersion: CORE_EVENT_SCHEMA_VERSION, sessionId, sequence,
    eventId: JSON.stringify([sessionId, "core.step_accepted", step.requestId, step.stepIndex]), type: "core.step_accepted", step });
}
