import { z } from "zod";

export const CORE_PROPOSAL_VERSION = "core-interpretation-proposal-v4";
export const CORE_PROPOSAL_LIMITS = Object.freeze({ steps: 8, operations: 24, text: 1200, references: 16, verificationRequests: 4 });
const handle = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const text = z.string().min(1).max(CORE_PROPOSAL_LIMITS.text);
export const proposalReferenceSchema = z.union([
  z.object({ existing: handle }).strict(), z.object({ created: handle }).strict(),
]);
const ref = proposalReferenceSchema;
const refs = z.array(ref).max(CORE_PROPOSAL_LIMITS.references);
const evidence = z.array(handle).max(CORE_PROPOSAL_LIMITS.references);
const standardProvenance = z.object({
  speech: evidence, state: refs,
  domain: z.object({ rule: handle }).strict().nullable(),
}).strict();
const aiCorrectionProvenance = z.object({
  speech: z.array(handle).max(0),
  state: z.array(ref).max(0),
  domain: z.null(),
  aiCorrection: z.object({
    trigger: handle,
    // Must resolve to a host-supplied trusted evidence/domain rule. The model
    // cannot mint its own settled factual authority by writing prose here.
    evidenceRule: handle,
    rationale: text,
  }).strict(),
}).strict();
const provenance = z.union([standardProvenance, aiCorrectionProvenance]);
const fact = z.object({ text, provenance }).strict();
const relation = fact.extend({ from: ref, to: ref }).strict();
const support = fact.extend({ target: ref }).strict();
const correctionEvidence = handle.nullable();
export const proposalOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE_CORE"), as: handle, provenance }).strict(),
  z.object({ action: z.literal("SET_CURRENT_CORE"), core: ref }).strict(),
  z.object({ action: z.literal("ADD_OBJECT"), core: ref, as: handle, value: fact }).strict(),
  z.object({ action: z.literal("REVISE_OBJECT"), target: ref, value: fact, correctionEvidence }).strict(),
  z.object({ action: z.literal("ADD_RELATION"), core: ref, as: handle, value: relation }).strict(),
  z.object({ action: z.literal("REVISE_RELATION"), target: ref, value: relation, correctionEvidence }).strict(),
  z.object({ action: z.literal("ADD_SUPPORT"), core: ref, as: handle, value: support }).strict(),
  z.object({ action: z.literal("REVISE_SUPPORT"), target: ref, value: support, correctionEvidence }).strict(),
  z.object({ action: z.literal("INVALIDATE"), target: ref, correctionEvidence: handle }).strict(),
  z.object({ action: z.literal("SUPERSEDE"), target: ref, replacement: ref, correctionEvidence: handle }).strict(),
]);
const cueOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEACHER"), evidence: handle }).strict(),
  z.object({ kind: z.literal("AI"), trigger: handle, rationale: text }).strict(),
]);
// Internal compatibility schema accepts historical omission (and provider null).
// OpenAI Structured Outputs uses the separate provider schema below, where every
// field is required and origin is explicitly nullable.
const cueValue = fact.extend({
  kind: z.enum(["NOTE", "QUESTION", "TASK", "HINT"]),
  target: ref.nullable(),
  origin: cueOrigin.nullable().optional(),
}).strict();
const providerCueValue = fact.extend({
  kind: z.enum(["NOTE", "QUESTION", "TASK", "HINT"]),
  target: ref.nullable(),
  origin: cueOrigin.nullable(),
}).strict();
const cue = z.discriminatedUnion("action", [
  z.object({ action: z.literal("KEEP") }).strict(),
  z.object({ action: z.literal("SET"), as: handle, value: cueValue }).strict(),
  z.object({ action: z.literal("REVISE"), target: ref, value: cueValue }).strict(),
  z.object({ action: z.literal("REPLACE"), target: ref, as: handle, value: cueValue, evidence: handle }).strict(),
  z.object({ action: z.literal("RESOLVE"), target: ref, evidence: handle }).strict(),
]);
const providerCue = z.discriminatedUnion("action", [
  z.object({ action: z.literal("KEEP") }).strict(),
  z.object({ action: z.literal("SET"), as: handle, value: providerCueValue }).strict(),
  z.object({ action: z.literal("REVISE"), target: ref, value: providerCueValue }).strict(),
  z.object({ action: z.literal("REPLACE"), target: ref, as: handle, value: providerCueValue, evidence: handle }).strict(),
  z.object({ action: z.literal("RESOLVE"), target: ref, evidence: handle }).strict(),
]);
export const proposalStepSchema = z.object({
  consumes: evidence.min(1), knowledgeOps: z.array(proposalOperationSchema).max(CORE_PROPOSAL_LIMITS.operations),
  cueDelta: cue, evidenceRefs: evidence, readRefs: refs,
  // Request-level reads include absence and state-dependent no-ops. Never durable identity.
  reads: z.object({ knowledge: z.boolean(), cue: z.boolean() }).strict(),
  warnings: z.array(z.string().min(1).max(160)).max(4),
}).strict();
const providerProposalStepSchema = z.object({
  consumes: evidence.min(1), knowledgeOps: z.array(proposalOperationSchema).max(CORE_PROPOSAL_LIMITS.operations),
  cueDelta: providerCue, evidenceRefs: evidence, readRefs: refs,
  reads: z.object({ knowledge: z.boolean(), cue: z.boolean() }).strict(),
  warnings: z.array(z.string().min(1).max(160)).max(4),
}).strict();
export const verificationRequestSchema = z.object({
  evidence: evidence.min(1),
  query: text,
  claim: text,
  candidateEvidence: text,
}).strict();
// Internal/exemplar parsing deliberately treats the sidecar as untrusted/best-effort.
// A malformed sidecar must not make otherwise valid semantic steps non-accepting.
const internalOutcome = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PROPOSE"),
    steps: z.array(proposalStepSchema).min(1).max(CORE_PROPOSAL_LIMITS.steps),
    verificationRequests: z.unknown().optional().default([]),
  }).strict(),
  z.object({ kind: z.literal("NEEDS_CONTEXT"), evidence: evidence.min(1), query: text }).strict(),
]);
const providerOutcome = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PROPOSE"),
    steps: z.array(providerProposalStepSchema).min(1).max(CORE_PROPOSAL_LIMITS.steps),
    // Required on the wire (use [] when none) so Structured Outputs has no optional fields.
    verificationRequests: z.array(verificationRequestSchema).max(CORE_PROPOSAL_LIMITS.verificationRequests),
  }).strict(),
  z.object({ kind: z.literal("NEEDS_CONTEXT"), evidence: evidence.min(1), query: text }).strict(),
]);
export const coreProposalSchema = z.object({ outcome: internalOutcome }).strict();
export const providerCoreProposalSchema = z.object({ outcome: providerOutcome }).strict();
export type ProposalReference = z.infer<typeof ref>;
export type ProposalProvenance = z.infer<typeof provenance>;
export type ProposalStep = z.infer<typeof proposalStepSchema>;
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
export type CoreProposal = z.infer<typeof coreProposalSchema>;
