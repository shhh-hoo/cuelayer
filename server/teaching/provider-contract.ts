import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { BoardContent, ContributionMode, TeachingInterpretationProposal, TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";
import { ACTIVE_ALPHA_SEMANTIC_PROFILE, type AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import { buildAlphaTeachingPolicy } from "./alpha-policy.ts";

const id = z.string().min(1).max(160);
const text = z.string().min(1).max(600);
const speechReference = z.object({ checkpointId: id, quote: text }).strict();
const stateReference = z.object({ kind: z.enum(["BOARD_ITEM", "ACTIVE_CUE"]), id }).strict();
const provenance = z.object({
  speechRefs: z.array(speechReference).max(12).nullable(),
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

export function createTeachingInterpretationSchema(profile: AlphaSemanticProfile) {
  const boardActiveContribution = contribution(boardContent, profile.boardActiveModes);
  const boardSupportContribution = contribution(text, profile.boardSupportModes);
  const cueContribution = (kind: keyof AlphaSemanticProfile["cueModes"]) => contribution(text, profile.cueModes[kind]);
  const boardDelta = z.discriminatedUnion("action", [
    z.object({ action: z.literal("KEEP"), reason: keepReason }).strict(),
    z.object({ action: z.literal("SET_ACTIVE"), contribution: boardActiveContribution, continuity: z.enum(["same_thread", "topic_shift", "correction"]), retainPrevious: z.boolean(), support: z.array(boardSupportContribution).max(2).nullable(), invalidatesBoardItemIds: z.array(id).max(4).nullable() }).strict(),
    z.object({ action: z.literal("ADD_SUPPORT"), support: boardSupportContribution, targetBoardItemId: id }).strict(),
  ]);
  const cueDelta = z.union([
    z.object({ action: z.literal("KEEP") }).strict(),
    z.object({ action: z.literal("SET"), cueKind: z.literal("NOTE"), contribution: cueContribution("NOTE"), targetBoardItemId: id.nullable() }).strict(),
    z.object({ action: z.literal("SET"), cueKind: z.literal("QUESTION"), contribution: cueContribution("QUESTION"), targetBoardItemId: id.nullable() }).strict(),
    z.object({ action: z.literal("SET"), cueKind: z.literal("TASK"), contribution: cueContribution("TASK"), targetBoardItemId: id.nullable() }).strict(),
    z.object({ action: z.literal("SET"), cueKind: z.literal("HINT"), contribution: cueContribution("HINT"), targetBoardItemId: id.nullable() }).strict(),
    z.object({ action: z.literal("RESOLVE_CURRENT"), reason: z.enum(["answered", "completed", "teacher_moved_on", "replaced"]), evidence: speechReference }).strict(),
  ]);
  const step = z.object({ consumesCheckpointIds: z.array(id).min(1).max(20), boardDelta, cueDelta, evidenceRefs: z.array(speechReference).max(12), warnings: z.array(warning).max(4).nullable() }).strict();
  return z.object({ requestId: id, baseBoardRevision: z.number().int().nonnegative(), baseCueRevision: z.number().int().nonnegative(), steps: z.array(step).min(1).max(20), warnings: z.array(warning).max(4).nullable() }).strict();
}

export const teachingInterpretationSchema = createTeachingInterpretationSchema(ACTIVE_ALPHA_SEMANTIC_PROFILE);

/** The exact safe, credential-free provider contract shared by call and audit paths. */
export function teachingProviderContract(profile: AlphaSemanticProfile = ACTIVE_ALPHA_SEMANTIC_PROFILE) {
  const schema = createTeachingInterpretationSchema(profile);
  return {
    reasoning: { effort: "low" as const },
    temperature: 0,
    max_output_tokens: 2_048,
    semanticProfileId: profile.id,
    policyVersion: profile.policyVersion,
    systemPolicy: buildAlphaTeachingPolicy(profile),
    text: { format: zodTextFormat(schema, "teaching_interpretation") },
  };
}

export function teachingResponseRequest(input: TeachingInterpretationRequest, profile: AlphaSemanticProfile = ACTIVE_ALPHA_SEMANTIC_PROFILE) {
  if (input.semanticProfileId !== profile.id || input.policyVersion !== profile.policyVersion) throw new Error("teaching-capability-profile-mismatch");
  const contract = teachingProviderContract(profile);
  return {
    reasoning: contract.reasoning,
    temperature: contract.temperature,
    max_output_tokens: contract.max_output_tokens,
    input: [
      { role: "system" as const, content: contract.systemPolicy },
      { role: "user" as const, content: JSON.stringify(input) },
    ],
    text: contract.text,
  };
}

type ProviderProvenance = {
  speechRefs: Array<{ checkpointId: string; quote: string }> | null;
  stateRefs: Array<{ kind: "BOARD_ITEM" | "ACTIVE_CUE"; id: string }> | null;
  basis: "SPEECH" | "SPEECH_AND_STATE" | "DOMAIN_KNOWLEDGE" | "STATE_AND_DOMAIN_KNOWLEDGE";
};
type ProviderContribution<T> = { mode: ContributionMode; content: T; provenance: ProviderProvenance };
type ProviderBoardDelta =
  | { action: "KEEP"; reason: "filler" | "transition" | "repetition" | "unfinished" | "insufficient_evidence" | "ambiguous_reference" | "classroom_management" | "no_board_value" }
  | { action: "SET_ACTIVE"; contribution: ProviderContribution<BoardContent>; continuity: "same_thread" | "topic_shift" | "correction"; retainPrevious: boolean; support: ProviderContribution<string>[] | null; invalidatesBoardItemIds: string[] | null }
  | { action: "ADD_SUPPORT"; support: ProviderContribution<string>; targetBoardItemId: string };
type ProviderCueDelta =
  | { action: "KEEP" }
  | { action: "SET"; cueKind: "NOTE" | "QUESTION" | "TASK" | "HINT"; contribution: ProviderContribution<string>; targetBoardItemId: string | null }
  | { action: "RESOLVE_CURRENT"; reason: "answered" | "completed" | "teacher_moved_on" | "replaced"; evidence: { checkpointId: string; quote: string } };
type ProviderWarning = { code: string; detail: string | null };
type ProviderProposal = {
  requestId: string;
  baseBoardRevision: number;
  baseCueRevision: number;
  steps: Array<{ consumesCheckpointIds: string[]; boardDelta: ProviderBoardDelta; cueDelta: ProviderCueDelta; evidenceRefs: Array<{ checkpointId: string; quote: string }>; warnings: ProviderWarning[] | null }>;
  warnings: ProviderWarning[] | null;
};

function normalizeWarnings(warnings: ProviderWarning[] | null) {
  if (warnings === null) return undefined;
  return warnings.map((item) => item.detail === null ? { code: item.code } : { code: item.code, detail: item.detail });
}
function normalizeProvenance(item: ProviderProvenance) {
  return { ...(item.speechRefs === null ? {} : { speechRefs: item.speechRefs }), ...(item.stateRefs === null ? {} : { stateRefs: item.stateRefs }), basis: item.basis };
}
function normalizeContribution<T>(item: ProviderContribution<T>) {
  return { mode: item.mode, content: item.content, provenance: normalizeProvenance(item.provenance) };
}
function normalizeBoardDelta(delta: ProviderBoardDelta) {
  switch (delta.action) {
    case "KEEP": return { action: "KEEP" as const, reason: delta.reason };
    case "ADD_SUPPORT": return { action: "ADD_SUPPORT" as const, support: normalizeContribution(delta.support), targetBoardItemId: delta.targetBoardItemId };
    case "SET_ACTIVE": return { action: "SET_ACTIVE" as const, contribution: normalizeContribution(delta.contribution), continuity: delta.continuity, retainPrevious: delta.retainPrevious, ...(delta.support === null ? {} : { support: delta.support.map(normalizeContribution) }), ...(delta.invalidatesBoardItemIds === null ? {} : { invalidatesBoardItemIds: delta.invalidatesBoardItemIds }) };
  }
}
function normalizeCueDelta(delta: ProviderCueDelta) {
  switch (delta.action) {
    case "KEEP": return { action: "KEEP" as const };
    case "RESOLVE_CURRENT": return { action: "RESOLVE_CURRENT" as const, reason: delta.reason, evidence: delta.evidence };
    case "SET": return { action: "SET" as const, cueKind: delta.cueKind, contribution: normalizeContribution(delta.contribution), ...(delta.targetBoardItemId === null ? {} : { targetBoardItemId: delta.targetBoardItemId }) };
  }
}

/** Converts nullable structured-output DTO fields into the optional domain representation. */
export function normalizeTeachingProposal(value: unknown): TeachingInterpretationProposal {
  const parsed = value as ProviderProposal;
  const warnings = normalizeWarnings(parsed.warnings);
  return {
    requestId: parsed.requestId,
    baseBoardRevision: parsed.baseBoardRevision,
    baseCueRevision: parsed.baseCueRevision,
    steps: parsed.steps.map((item) => {
      const stepWarnings = normalizeWarnings(item.warnings);
      return { consumesCheckpointIds: item.consumesCheckpointIds, boardDelta: normalizeBoardDelta(item.boardDelta), cueDelta: normalizeCueDelta(item.cueDelta), evidenceRefs: item.evidenceRefs, ...(stepWarnings ? { warnings: stepWarnings } : {}) };
    }),
    ...(warnings ? { warnings } : {}),
  };
}
