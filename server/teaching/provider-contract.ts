import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { TeachingInterpretationProposal, TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";

const id = z.string().min(1).max(160);
const text = z.string().min(1).max(600);
const speechReference = z.object({ checkpointId: id, quote: text }).strict();
const stateReference = z.object({ kind: z.enum(["BOARD_ITEM", "ACTIVE_CUE"]), id }).strict();
const provenance = z.object({
  speechRefs: z.array(speechReference).max(12).nullable(),
  stateRefs: z.array(stateReference).max(6).nullable(),
  basis: z.enum(["SPEECH", "SPEECH_AND_STATE", "DOMAIN_KNOWLEDGE", "STATE_AND_DOMAIN_KNOWLEDGE"]),
}).strict();
const contribution = <T extends z.ZodType>(content: T) => z.object({
  mode: z.enum(["RECONSTRUCT", "REPRESENT", "AUGMENT", "CORRECT", "INITIATE"]), content, provenance,
}).strict();
const keepReason = z.enum(["filler", "transition", "repetition", "unfinished", "insufficient_evidence", "ambiguous_reference", "classroom_management", "no_board_value"]);
const boardContent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), text }).strict(),
  z.object({ kind: z.literal("FOCUS"), target: text }).strict(),
  z.object({ kind: z.literal("RELATION"), relation: z.enum(["cause", "sequence", "contrast"]), targets: z.array(text).min(2).max(6) }).strict(),
  z.object({ kind: z.literal("TRANSFORM"), from: text, to: text }).strict(),
]);
const boardDelta = z.discriminatedUnion("action", [
  z.object({ action: z.literal("KEEP"), reason: keepReason }).strict(),
  z.object({
    action: z.literal("SET_ACTIVE"),
    contribution: contribution(boardContent),
    continuity: z.enum(["same_thread", "topic_shift", "correction"]),
    retainPrevious: z.boolean(),
    support: z.array(contribution(text)).max(2).nullable(),
    invalidatesBoardItemIds: z.array(id).max(4).nullable(),
  }).strict(),
  z.object({ action: z.literal("ADD_SUPPORT"), support: contribution(text), targetBoardItemId: id }).strict(),
]);
const cueDelta = z.discriminatedUnion("action", [
  z.object({ action: z.literal("KEEP") }).strict(),
  z.object({ action: z.literal("SET"), cueKind: z.enum(["NOTE", "QUESTION", "TASK", "HINT"]), contribution: contribution(text), targetBoardItemId: id.nullable() }).strict(),
  z.object({ action: z.literal("RESOLVE_CURRENT"), reason: z.enum(["answered", "completed", "teacher_moved_on", "replaced"]), evidence: speechReference }).strict(),
]);
const warning = z.object({ code: z.string().min(1).max(80), detail: z.string().min(1).max(240).nullable() }).strict();
const step = z.object({
  consumesCheckpointIds: z.array(id).min(1).max(20),
  boardDelta,
  cueDelta,
  evidenceRefs: z.array(speechReference).max(12),
  warnings: z.array(warning).max(4).nullable(),
}).strict();

export const teachingInterpretationSchema = z.object({
  requestId: id,
  baseBoardRevision: z.number().int().nonnegative(),
  baseCueRevision: z.number().int().nonnegative(),
  steps: z.array(step).min(1).max(20),
  warnings: z.array(warning).max(4).nullable(),
}).strict();

export const teachingInterpretationPolicy = `You are CueLayer's live Teaching State interpreter. You propose ordered bounded deltas; deterministic code owns state, layout, timing, and rendering.

Authority order:
1. This policy and output schema.
2. processedTimeline is historical evidence and accepted work; it may contain claims later corrected.
3. currentState is current authority and overrides contradictory history.
4. newEvidence is the only allowed trigger for new changes.
5. Output must cover every newEvidence checkpoint exactly once, in the same order, using contiguous consumesCheckpointIds.

Copy requestId exactly. Set baseBoardRevision and baseCueRevision to currentState.board.revision and currentState.cue.revision.

The learner surface optimizes for the learner's current learning state, not fidelity to the teacher transcript. Teacher speech is primary classroom evidence and context; newEvidence is the sole deliberation trigger, not a content-permission boundary. Once triggered, you may reason from new evidence, processed history, currentState, and domain knowledge. Never return HTML, CSS, layout, timing, animation, TeX, or a whole replacement state.

Provenance is accountability, not authorization. SPEECH requires one or more exact SpeechReference quotes. SPEECH_AND_STATE requires exact speech quotes and existing state references. DOMAIN_KNOWLEDGE needs neither speech nor state references. STATE_AND_DOMAIN_KNOWLEDGE requires existing state references and may include exact speech quotes. Never fabricate a speech quote. If a speech quote is supplied, it must be an exact non-empty substring of its checkpoint text.

Board supports KEEP, SET_ACTIVE, and ADD_SUPPORT. Board contributions may use RECONSTRUCT, REPRESENT, AUGMENT, or CORRECT; INITIATE is not a Board mode. CORRECT requires continuity=correction, retainPrevious=false, and explicit invalidatesBoardItemIds. Board content is limited to TEXT, FOCUS, RELATION(cause|sequence|contrast), and TRANSFORM. Keep augmentation concise and contextually useful; correct but irrelevant knowledge should remain QUIET.

Within one ordered proposal only, a SET_ACTIVE in step N creates the deterministic Board item ID \`board-\${requestId}-accepted-N\`. A later step may reference that exact ID in targetBoardItemId; replace N with the zero-based earlier step index. Do not invent another intra-batch ID, and do not target a Board item that has been retired or invalidated by an earlier step.

Cue supports KEEP, SET(NOTE|QUESTION|TASK|HINT), and RESOLVE_CURRENT. NOTE may use RECONSTRUCT, REPRESENT, or AUGMENT. QUESTION, TASK, and HINT may use RECONSTRUCT, REPRESENT, or INITIATE; INITIATE is appropriate only for a bounded learner action. CORRECT is not a Cue mode. High-risk CORRECT and INITIATE interventions need strong contextual justification and must protect active learning: do not reveal a complete answer while a genuine QUESTION or TASK remains unresolved, and explicitly resolve an active QUESTION or TASK before replacing it. Cue SET targetBoardItemId is optional: include it only for a current active or retained Board item, an earlier step's deterministic SET_ACTIVE ID, or this step's own deterministic SET_ACTIVE ID. If no target is confidently valid, omit targetBoardItemId. Board changes never resolve Cue; Cue resolution never clears Board.`;

export function teachingResponseRequest(input: TeachingInterpretationRequest) {
  return {
    reasoning: { effort: "none" as const },
    temperature: 0,
    max_output_tokens: 2_048,
    input: [
      { role: "system" as const, content: teachingInterpretationPolicy },
      { role: "user" as const, content: JSON.stringify(input) },
    ],
    text: { format: zodTextFormat(teachingInterpretationSchema, "teaching_interpretation") },
  };
}

function normalizeWarnings(warnings: z.infer<typeof warning>[] | null) {
  if (warnings === null) return undefined;
  return warnings.map((item) => item.detail === null ? { code: item.code } : { code: item.code, detail: item.detail });
}

function normalizeProvenance(item: z.infer<typeof provenance>) {
  return { ...(item.speechRefs === null ? {} : { speechRefs: item.speechRefs }), ...(item.stateRefs === null ? {} : { stateRefs: item.stateRefs }), basis: item.basis };
}
function normalizeContribution<T>(item: { mode: "RECONSTRUCT" | "REPRESENT" | "AUGMENT" | "CORRECT" | "INITIATE"; content: T; provenance: z.infer<typeof provenance> }) {
  return { mode: item.mode, content: item.content, provenance: normalizeProvenance(item.provenance) };
}

function normalizeBoardDelta(delta: z.infer<typeof boardDelta>) {
  switch (delta.action) {
    case "KEEP": return { action: "KEEP" as const, reason: delta.reason };
    case "ADD_SUPPORT": return { action: "ADD_SUPPORT" as const, support: normalizeContribution(delta.support), targetBoardItemId: delta.targetBoardItemId };
    case "SET_ACTIVE": return {
      action: "SET_ACTIVE" as const,
      contribution: normalizeContribution(delta.contribution),
      continuity: delta.continuity,
      retainPrevious: delta.retainPrevious,
      ...(delta.support === null ? {} : { support: delta.support.map(normalizeContribution) }),
      ...(delta.invalidatesBoardItemIds === null ? {} : { invalidatesBoardItemIds: delta.invalidatesBoardItemIds }),
    };
  }
}

function normalizeCueDelta(delta: z.infer<typeof cueDelta>) {
  switch (delta.action) {
    case "KEEP": return { action: "KEEP" as const };
    case "RESOLVE_CURRENT": return { action: "RESOLVE_CURRENT" as const, reason: delta.reason, evidence: delta.evidence };
    case "SET": return {
      action: "SET" as const,
      cueKind: delta.cueKind,
      contribution: normalizeContribution(delta.contribution),
      ...(delta.targetBoardItemId === null ? {} : { targetBoardItemId: delta.targetBoardItemId }),
    };
  }
}

/** Converts nullable structured-output DTO fields into the optional domain representation. */
export function normalizeTeachingProposal(parsed: z.infer<typeof teachingInterpretationSchema>): TeachingInterpretationProposal {
  const warnings = normalizeWarnings(parsed.warnings);
  return {
    requestId: parsed.requestId,
    baseBoardRevision: parsed.baseBoardRevision,
    baseCueRevision: parsed.baseCueRevision,
    steps: parsed.steps.map((item) => {
      const warnings = normalizeWarnings(item.warnings);
      return {
        consumesCheckpointIds: item.consumesCheckpointIds,
        boardDelta: normalizeBoardDelta(item.boardDelta),
        cueDelta: normalizeCueDelta(item.cueDelta),
        evidenceRefs: item.evidenceRefs,
        ...(warnings ? { warnings } : {}),
      };
    }),
    ...(warnings ? { warnings } : {}),
  };
}
