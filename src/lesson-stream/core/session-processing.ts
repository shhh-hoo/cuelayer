import { z } from "zod";

const id = z.string().min(1);
const obligation = z.object({ checkpointId: id, phrase: z.string().min(1) }).strict();
/** Operational metadata in the SAME accepted step/transaction as consumption. */
export const liveProcessingSchema = z.object({
  version: z.literal("session-live-processing-v1"),
  adapter: z.enum(["explicit", "legacy-propose"]),
  dispositions: z.array(z.discriminatedUnion("kind", [
    z.object({ checkpointId: id, kind: z.literal("semantic_change") }).strict(),
    z.object({ checkpointId: id, kind: z.literal("resolved_no_change") }).strict(),
    obligation.extend({ kind: z.literal("deferred_unresolved") }).strict(),
  ])).min(1),
  resolvedObligationIds: z.array(id),
  review: z.object({ id, checkpointIds: z.array(id).min(1), status: z.literal("incomplete") }).strict().optional(),
}).strict();
export type LiveProcessing = z.infer<typeof liveProcessingSchema>;
export type UnresolvedObligation = z.infer<typeof obligation>;
/** An adapter must explicitly supply these decisions; punctuation is never a disposition. */
export const liveDecisionSchema = z.object({
  deferred: z.array(obligation), resolvedObligationIds: z.array(id), reviewRequired: z.boolean(),
}).strict();
export type LiveDecision = z.infer<typeof liveDecisionSchema>;
export const liveResultSchema = z.object({
  version: z.literal("session-live-result-v1"), proposal: z.unknown(), processing: liveDecisionSchema,
}).strict();
export type SessionTask =
  | { lane: "LIVE"; taskId: string; checkpointIds: readonly string[]; knowledgeRevision: number; cueRevision: number }
  | { lane: "STAGE"; taskId: string; reviewSnapshot: Readonly<{ eventId: string; throughSequence: number; knowledgeRevision: number; cueRevision: number }>; obligationIds: readonly string[] };
