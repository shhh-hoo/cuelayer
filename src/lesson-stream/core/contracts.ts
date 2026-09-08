import { z } from "zod";
import type { CompactEvidenceCheckpoint, GroundingRecord } from "../contracts.ts";

/** Offline semantic generation; never change the production legacy version here. */
export const CORE_EVENT_SCHEMA_VERSION = "lesson-event-v5-core";
const id = z.string().min(1);
const text = z.string().refine(value => value.trim().length > 0, "empty-text");
const revision = z.number().int().nonnegative().safe();
export const speechReferenceSchema = z.object({ checkpointId: id, quote: text }).strict();
const coreReference = z.object({ kind: z.literal("CORE"), id }).strict();
export const unitReferenceSchema = z.object({ kind: z.enum(["OBJECT", "RELATION", "SUPPORT"]), coreId: id, id }).strict();
export const knowledgeReferenceSchema = z.union([coreReference, unitReferenceSchema]);
// Target capabilities are narrower than provenance references in M1.
const objectOrRelationReference = unitReferenceSchema.extend({ kind: z.enum(["OBJECT", "RELATION"]) });
export const supportTargetSchema = z.union([coreReference, objectOrRelationReference]);
export const cueTargetSchema = z.union([coreReference, objectOrRelationReference]);
export const semanticReferenceSchema = z.union([knowledgeReferenceSchema, z.object({ kind: z.literal("CUE"), id }).strict()]);
// revision identifies the accepted knowledge/Cue snapshot, not a mutable entity counter.
const stateReference = z.object({ target: semanticReferenceSchema, revision }).strict();
const aiCorrection = z.object({
  trigger: speechReferenceSchema,
  rationale: text,
  confidence: z.literal("high"),
}).strict();
export const provenanceSchema = z.object({
  speechRefs: z.array(speechReferenceSchema),
  stateRefs: z.array(stateReference),
  // Explicit host-authorized domain attribution; not a hidden domain oracle.
  domainBasis: text.optional(),
  // Autonomous factual correction is a distinct, auditable basis. The triggering
  // teacher evidence is not itself claimed as factual support for the corrected content.
  aiCorrection: aiCorrection.optional(),
}).strict()
  .refine(p => p.speechRefs.length > 0 || p.stateRefs.length > 0 || p.domainBasis !== undefined || p.aiCorrection !== undefined, "provenance-required")
  .refine(p => !p.aiCorrection || (p.speechRefs.length === 0 && p.stateRefs.length === 0 && p.domainBasis === undefined), "ai-correction-provenance-exclusive");
const fact = z.object({ text, provenance: provenanceSchema }).strict();
// A stated relationship between identified objects, with no taxonomy or rendering vocabulary.
const relation = fact.extend({ fromObjectId: id, toObjectId: id }).strict();
const support = fact.extend({ target: supportTargetSchema }).strict();
const correction = { correctionEvidence: speechReferenceSchema };
export const knowledgeOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_CORE"), id, provenance: provenanceSchema }).strict(),
  z.object({ action: z.literal("SET_CURRENT_CORE"), coreId: id }).strict(),
  z.object({ action: z.literal("ADD_OBJECT"), coreId: id, id, value: fact }).strict(),
  z.object({ action: z.literal("REVISE_OBJECT"), coreId: id, id, value: fact, correctionEvidence: speechReferenceSchema.optional() }).strict(),
  z.object({ action: z.literal("ADD_RELATION"), coreId: id, id, value: relation }).strict(),
  z.object({ action: z.literal("REVISE_RELATION"), coreId: id, id, value: relation, correctionEvidence: speechReferenceSchema.optional() }).strict(),
  z.object({ action: z.literal("ADD_SUPPORT"), coreId: id, id, value: support }).strict(),
  z.object({ action: z.literal("REVISE_SUPPORT"), coreId: id, id, value: support, correctionEvidence: speechReferenceSchema.optional() }).strict(),
  z.object({ action: z.literal("INVALIDATE"), target: unitReferenceSchema, ...correction }).strict(),
  z.object({ action: z.literal("SUPERSEDE"), target: unitReferenceSchema, replacement: unitReferenceSchema, ...correction }).strict(),
]);
const cueValue = fact.extend({ kind: z.enum(["NOTE", "QUESTION", "TASK", "HINT"]), target: cueTargetSchema.optional() }).strict();
export const cueMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("KEEP") }).strict(),
  z.object({ action: z.literal("SET"), id, value: cueValue }).strict(),
  z.object({ action: z.literal("REVISE"), targetCueId: id, value: cueValue }).strict(),
  z.object({ action: z.literal("REPLACE"), targetCueId: id, id, value: cueValue, evidence: speechReferenceSchema }).strict(),
  z.object({ action: z.literal("RESOLVE"), targetCueId: id, evidence: speechReferenceSchema }).strict(),
]);
export const coreStepSchema = z.object({
  requestId: id,
  stepIndex: revision,
  baseKnowledgeRevision: revision,
  baseCueRevision: revision,
  consumesCheckpointIds: z.array(id).min(1),
  knowledgeOps: z.array(knowledgeOperationSchema),
  cueDelta: cueMutationSchema,
  evidenceRefs: z.array(speechReferenceSchema),
  // Includes dependencies of a state-dependent no-op. Acceptance owns this field, not a provider.
  stateRefs: z.array(stateReference),
  warnings: z.array(z.object({ code: id, detail: z.string().optional() }).strict()),
  acceptedAt: z.iso.datetime(),
}).strict();

export type CoreStep = z.infer<typeof coreStepSchema>;
export type KnowledgeOperation = z.infer<typeof knowledgeOperationSchema>;
export type KnowledgeReference = z.infer<typeof knowledgeReferenceSchema>;
export type UnitReference = z.infer<typeof unitReferenceSchema>;
export type SemanticReference = z.infer<typeof semanticReferenceSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type CoreCue = z.infer<typeof cueValue> & { id: string };
type Unit<T> = { id: string; value: T; status: "valid" | "invalidated" | "superseded"; supersededBy?: UnitReference };
export type SemanticObject = Unit<z.infer<typeof fact>>;
export type SemanticRelation = Unit<z.infer<typeof relation>>;
export type CoreSupport = Unit<z.infer<typeof support>>;
export type Core = {
  id: string;
  provenance: Provenance;
  objects: Record<string, SemanticObject>;
  relations: Record<string, SemanticRelation>;
  supports: Record<string, CoreSupport>;
};
export type CoreTeachingState = {
  sessionId: string;
  processedThroughSequence: number;
  knowledge: { revision: number; currentCoreId?: string; cores: Record<string, Core> };
  cue: { revision: number; active?: CoreCue };
};

type Identity = { schemaVersion: typeof CORE_EVENT_SCHEMA_VERSION; eventId: string; sessionId: string; sequence: number };
export type CoreEvent = Identity & (
  | { type: "lesson.started"; timestamp: string }
  | { type: "evidence.checkpoint_committed"; timestamp: string; checkpoint: CompactEvidenceCheckpoint; grounding: GroundingRecord }
  | { type: "core.step_accepted"; step: CoreStep }
  | { type: "teaching_cue.expired"; cueId: string; baseCueRevision: number; timestamp: string }
  | { type: "lesson.ended"; timestamp: string }
);
