import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { BoardContent, ContributionMode, TeachingInterpretationProposal, TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";
import { ACTIVE_ALPHA_SEMANTIC_PROFILE, type AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import { buildAlphaTeachingPolicy } from "./alpha-policy.ts";

const id = z.string().min(1).max(160);
const text = z.string().min(1).max(600);
const checkpointReference = z.object({ checkpointId: id }).strict();
const stateReference = z.object({ kind: z.enum(["BOARD_ITEM", "ACTIVE_CUE"]), id }).strict();
const provenance = z.object({
  speechRefs: z.array(checkpointReference).max(12).nullable(),
  stateRefs: z.array(stateReference).max(6).nullable(),
  basis: z.enum(["SPEECH", "SPEECH_AND_STATE", "DOMAIN_KNOWLEDGE", "STATE_AND_DOMAIN_KNOWLEDGE"]),
}).strict();
const contribution = <T extends z.ZodType>(content: T, modes: readonly ContributionMode[]) => z.object({
  mode: z.enum(modes as [ContributionMode, ...ContributionMode[]]), content, provenance,
}).strict();
const keepReason = z.enum(["filler", "transition", "repetition", "unfinished", "insufficient_evidence", "ambiguous_reference", "classroom_management", "no_board_value"]);
const boardContent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), text }).strict(),
  z.object({ kind: z.literal("FOCUS"), target: text }).strict(),
  z.object({ kind: z.literal("RELATION"), relation: z.enum(["cause", "sequence", "contrast"]), targets: z.array(text).min(2).max(6) }).strict(),
  z.object({ kind: z.literal("TRANSFORM"), from: text, to: text }).strict(),
]);
const warning = z.object({ code: z.string().min(1).max(80), detail: z.string().min(1).max(240).nullable() }).strict();

export function createTeachingInterpretationSchema(profile: AlphaSemanticProfile, checkpointIds?: readonly string[], speechCheckpointIds = checkpointIds) {
  const continuous = profile.id === "alpha-continuous-p4-v8";
  const checkpointId = !continuous && checkpointIds?.length ? z.enum(checkpointIds as [string, ...string[]]) : id;
  const requestCheckpointReference = z.object({ checkpointId }).strict();
  const speechCheckpointId = !continuous && speechCheckpointIds?.length ? z.enum(speechCheckpointIds as [string, ...string[]]) : id;
  const speechCheckpointReference = z.object({ checkpointId: speechCheckpointId }).strict();
  const requestProvenance = provenance.extend({ speechRefs: z.array(speechCheckpointReference).max(12).nullable() }).strict();
  const requestContribution = <T extends z.ZodType>(content: T, modes: readonly ContributionMode[]) => z.object({
    mode: z.enum(modes as [ContributionMode, ...ContributionMode[]]), content, provenance: requestProvenance,
  }).strict();
  const boardActiveContribution = requestContribution(boardContent, profile.boardActiveModes);
  const boardSupportContribution = requestContribution(text, profile.boardSupportModes);
  const optionalBoardSupportContribution = requestContribution(text, ["RECONSTRUCT", "REPRESENT", "AUGMENT"]);
  const cueContribution = (kind: keyof AlphaSemanticProfile["cueModes"]) => requestContribution(text, profile.cueModes[kind]);
  const boardDelta = z.discriminatedUnion("action", [
    z.object({ action: z.literal("KEEP"), reason: keepReason }).strict(),
    z.object({ action: z.literal("SET_ACTIVE"), contribution: boardActiveContribution, continuity: z.enum(["same_thread", "topic_shift", "correction"]), retainPrevious: z.boolean(), support: z.array(optionalBoardSupportContribution).max(2).nullable(), invalidatesBoardItemIds: z.array(id).max(4).nullable() }).strict(),
    z.object({ action: z.literal("ADD_SUPPORT"), support: boardSupportContribution, targetBoardItemId: id }).strict(),
    ...(continuous ? [z.object({ action: z.literal("RETIRE_ACTIVE"), targetBoardItemId: id, disposition: z.enum(["retain", "discard"]), reason: z.enum(["teacher_moved_on", "completed", "no_longer_current"]) }).strict()] : []),
  ]);
  const resolutionReason = z.enum(["answered", "completed", "teacher_moved_on", "replaced"]);
  const cueDelta = z.union([
    z.object({ action: z.literal("KEEP") }).strict(),
    ...(continuous ? [
      z.object({ action: z.literal("ATTACH_HINT"), targetCueId: id, contribution: cueContribution("HINT") }).strict(),
      ...(["NOTE", "QUESTION", "TASK", "HINT"] as const).map((kind) => z.object({ action: z.literal("REPLACE_CURRENT"), targetCueId: id, reason: resolutionReason, evidence: requestCheckpointReference, cueKind: z.literal(kind), contribution: cueContribution(kind), targetBoardItemId: id.nullable() }).strict()),
    ] : []),
    z.object({ action: z.literal("SET"), cueKind: z.literal("NOTE"), contribution: cueContribution("NOTE"), targetBoardItemId: id.nullable() }).strict(),
    z.object({ action: z.literal("SET"), cueKind: z.literal("QUESTION"), contribution: cueContribution("QUESTION"), targetBoardItemId: id.nullable() }).strict(),
    z.object({ action: z.literal("SET"), cueKind: z.literal("TASK"), contribution: cueContribution("TASK"), targetBoardItemId: id.nullable() }).strict(),
    z.object({ action: z.literal("SET"), cueKind: z.literal("HINT"), contribution: cueContribution("HINT"), targetBoardItemId: id.nullable() }).strict(),
    z.object({ action: z.literal("RESOLVE_CURRENT"), reason: z.enum(["answered", "completed", "teacher_moved_on", "replaced"]), evidence: requestCheckpointReference }).strict(),
  ]);
  const step = z.object({ consumesCheckpointIds: z.array(checkpointId).min(1).max(20), boardDelta, cueDelta, evidenceRefs: z.array(requestCheckpointReference).max(12), warnings: z.array(warning).max(4).nullable() }).strict();
  return z.object({ requestId: id, baseBoardRevision: z.number().int().nonnegative(), baseCueRevision: z.number().int().nonnegative(), steps: z.array(step).min(1).max(20), warnings: z.array(warning).max(4).nullable() }).strict();
}

export function suppliedSpeechCheckpointIds(input: TeachingInterpretationRequest) {
  return [...new Set([...input.processedTimeline.flatMap((item) => item.type === "evidence" ? [item.checkpointId] : []), ...input.newEvidence.map((item) => item.checkpointId)])];
}

export const teachingInterpretationSchema = createTeachingInterpretationSchema(ACTIVE_ALPHA_SEMANTIC_PROFILE);

/** The exact safe, credential-free provider contract shared by call and audit paths. */
export function teachingProviderContract(profile: AlphaSemanticProfile = ACTIVE_ALPHA_SEMANTIC_PROFILE) {
  const schema = createTeachingInterpretationSchema(profile);
  return {
    reasoning: { effort: "low" as const },
    max_output_tokens: 2_048,
    semanticProfileId: profile.id,
    policyVersion: profile.policyVersion,
    systemPolicy: buildAlphaTeachingPolicy(profile),
    text: { format: zodTextFormat(schema, profile.id === "alpha-continuous-p4-v8" ? "teaching_interpretation_v8_1" : "teaching_interpretation") },
  };
}

export function teachingResponseRequest(input: TeachingInterpretationRequest, profile: AlphaSemanticProfile = ACTIVE_ALPHA_SEMANTIC_PROFILE) {
  if (input.semanticProfileId !== profile.id || input.policyVersion !== profile.policyVersion) throw new Error("teaching-capability-profile-mismatch");
  const contract = teachingProviderContract(profile);
  const schema = createTeachingInterpretationSchema(profile, input.newEvidence.map((item) => item.checkpointId), profile.id === "alpha-continuous-p4-v8" ? suppliedSpeechCheckpointIds(input) : undefined);
  return {
    reasoning: contract.reasoning,
    max_output_tokens: contract.max_output_tokens,
    input: [
      { role: "system" as const, content: contract.systemPolicy },
      { role: "user" as const, content: JSON.stringify(input) },
    ],
    text: { format: zodTextFormat(schema, profile.id === "alpha-continuous-p4-v8" ? "teaching_interpretation_v8_1" : "teaching_interpretation") },
  };
}

type ProviderProvenance = {
  speechRefs: Array<{ checkpointId: string }> | null;
  stateRefs: Array<{ kind: "BOARD_ITEM" | "ACTIVE_CUE"; id: string }> | null;
  basis: "SPEECH" | "SPEECH_AND_STATE" | "DOMAIN_KNOWLEDGE" | "STATE_AND_DOMAIN_KNOWLEDGE";
};
type ProviderContribution<T> = { mode: ContributionMode; content: T; provenance: ProviderProvenance };
type ProviderBoardDelta =
  | { action: "KEEP"; reason: "filler" | "transition" | "repetition" | "unfinished" | "insufficient_evidence" | "ambiguous_reference" | "classroom_management" | "no_board_value" }
  | { action: "SET_ACTIVE"; contribution: ProviderContribution<BoardContent>; continuity: "same_thread" | "topic_shift" | "correction"; retainPrevious: boolean; support: ProviderContribution<string>[] | null; invalidatesBoardItemIds: string[] | null }
  | { action: "RETIRE_ACTIVE"; targetBoardItemId: string; disposition: "retain" | "discard"; reason: "teacher_moved_on" | "completed" | "no_longer_current" }
  | { action: "ADD_SUPPORT"; support: ProviderContribution<string>; targetBoardItemId: string };
type ProviderCueDelta =
  | { action: "KEEP" }
  | { action: "SET"; cueKind: "NOTE" | "QUESTION" | "TASK" | "HINT"; contribution: ProviderContribution<string>; targetBoardItemId: string | null }
  | { action: "ATTACH_HINT"; targetCueId: string; contribution: ProviderContribution<string> }
  | { action: "REPLACE_CURRENT"; targetCueId: string; reason: "answered" | "completed" | "teacher_moved_on" | "replaced"; evidence: { checkpointId: string }; cueKind: "NOTE" | "QUESTION" | "TASK" | "HINT"; contribution: ProviderContribution<string>; targetBoardItemId: string | null }
  | { action: "RESOLVE_CURRENT"; reason: "answered" | "completed" | "teacher_moved_on" | "replaced"; evidence: { checkpointId: string } };
type ProviderWarning = { code: string; detail: string | null };
type ProviderProposal = {
  requestId: string;
  baseBoardRevision: number;
  baseCueRevision: number;
  steps: Array<{ consumesCheckpointIds: string[]; boardDelta: ProviderBoardDelta; cueDelta: ProviderCueDelta; evidenceRefs: Array<{ checkpointId: string }>; warnings: ProviderWarning[] | null }>;
  warnings: ProviderWarning[] | null;
};

function normalizeWarnings(warnings: ProviderWarning[] | null) {
  if (warnings === null) return undefined;
  return warnings.map((item) => item.detail === null ? { code: item.code } : { code: item.code, detail: item.detail });
}
function normalizeProvenance(item: ProviderProvenance, evidenceText: ReadonlyMap<string, string>) {
  return { ...(item.speechRefs === null ? {} : { speechRefs: item.speechRefs.map((ref) => ({ ...ref, quote: evidenceText.get(ref.checkpointId) ?? "" })) }), ...(item.stateRefs === null ? {} : { stateRefs: item.stateRefs }), basis: item.basis };
}
function normalizeContribution<T>(item: ProviderContribution<T>, evidenceText: ReadonlyMap<string, string>) {
  return { mode: item.mode, content: item.content, provenance: normalizeProvenance(item.provenance, evidenceText) };
}
function normalizeBoardDelta(delta: ProviderBoardDelta, evidenceText: ReadonlyMap<string, string>) {
  switch (delta.action) {
    case "KEEP": return { action: "KEEP" as const, reason: delta.reason };
    case "RETIRE_ACTIVE": return delta;
    case "ADD_SUPPORT": return { action: "ADD_SUPPORT" as const, support: normalizeContribution(delta.support, evidenceText), targetBoardItemId: delta.targetBoardItemId };
    case "SET_ACTIVE": return { action: "SET_ACTIVE" as const, contribution: normalizeContribution(delta.contribution, evidenceText), continuity: delta.continuity, retainPrevious: delta.retainPrevious, ...(delta.support === null ? {} : { support: delta.support.map((item) => normalizeContribution(item, evidenceText)) }), ...(delta.invalidatesBoardItemIds === null ? {} : { invalidatesBoardItemIds: delta.invalidatesBoardItemIds }) };
  }
}
function normalizeCueDelta(delta: ProviderCueDelta, evidenceText: ReadonlyMap<string, string>) {
  switch (delta.action) {
    case "KEEP": return { action: "KEEP" as const };
    case "ATTACH_HINT": return { ...delta, contribution: normalizeContribution(delta.contribution, evidenceText) };
    case "REPLACE_CURRENT": return { action: delta.action, targetCueId: delta.targetCueId, reason: delta.reason, evidence: { ...delta.evidence, quote: evidenceText.get(delta.evidence.checkpointId) ?? "" }, cueKind: delta.cueKind, contribution: normalizeContribution(delta.contribution, evidenceText), ...(delta.targetBoardItemId === null ? {} : { targetBoardItemId: delta.targetBoardItemId }) };
    case "RESOLVE_CURRENT": return { action: "RESOLVE_CURRENT" as const, reason: delta.reason, evidence: { ...delta.evidence, quote: evidenceText.get(delta.evidence.checkpointId) ?? "" } };
    case "SET": return { action: "SET" as const, cueKind: delta.cueKind, contribution: normalizeContribution(delta.contribution, evidenceText), ...(delta.targetBoardItemId === null ? {} : { targetBoardItemId: delta.targetBoardItemId }) };
  }
}

/** Converts nullable structured-output DTO fields into the optional domain representation. */
export function normalizeTeachingProposal(value: unknown, input: TeachingInterpretationRequest): TeachingInterpretationProposal {
  const parsed = value as ProviderProposal;
  const evidenceText = new Map([
    ...input.processedTimeline.flatMap((item) => item.type === "evidence" ? [[item.checkpointId, item.text] as const] : []),
    ...input.newEvidence.map((item) => [item.checkpointId, item.text] as const),
  ]);
  const warnings = normalizeWarnings(parsed.warnings);
  return {
    requestId: parsed.requestId,
    baseBoardRevision: parsed.baseBoardRevision,
    baseCueRevision: parsed.baseCueRevision,
    steps: parsed.steps.map((item) => {
      const stepWarnings = normalizeWarnings(item.warnings);
      return { consumesCheckpointIds: item.consumesCheckpointIds, boardDelta: normalizeBoardDelta(item.boardDelta, evidenceText), cueDelta: normalizeCueDelta(item.cueDelta, evidenceText), evidenceRefs: item.evidenceRefs.map((ref) => ({ ...ref, quote: evidenceText.get(ref.checkpointId) ?? "" })), ...(stepWarnings ? { warnings: stepWarnings } : {}) };
    }),
    ...(warnings ? { warnings } : {}),
  };
}
