import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { TeachingInterpretationProposal, TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";

const id = z.string().min(1).max(160);
const text = z.string().min(1).max(600);
const reference = z.object({ checkpointId: id, text }).strict();
const keepReason = z.enum(["filler", "transition", "repetition", "unfinished", "insufficient_evidence", "ambiguous_reference", "classroom_management", "no_board_value"]);
const boardContent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), source: reference }).strict(),
  z.object({ kind: z.literal("FOCUS"), target: reference }).strict(),
  z.object({ kind: z.literal("RELATION"), relation: z.enum(["cause", "sequence", "contrast"]), targets: z.array(reference).min(2).max(6) }).strict(),
  z.object({ kind: z.literal("TRANSFORM"), from: reference, to: reference }).strict(),
]);
const boardDelta = z.discriminatedUnion("action", [
  z.object({ action: z.literal("KEEP"), reason: keepReason }).strict(),
  z.object({
    action: z.literal("SET_ACTIVE"),
    content: boardContent,
    continuity: z.enum(["same_thread", "topic_shift", "correction"]),
    retainPrevious: z.boolean(),
    support: z.array(reference).max(2).nullable(),
    invalidatesBoardItemIds: z.array(id).max(4).nullable(),
  }).strict(),
  z.object({ action: z.literal("ADD_SUPPORT"), support: reference, targetBoardItemId: id }).strict(),
]);
const cueDelta = z.discriminatedUnion("action", [
  z.object({ action: z.literal("KEEP") }).strict(),
  z.object({ action: z.literal("SET"), cueKind: z.enum(["QUESTION", "TASK", "NOTE", "HINT"]), source: reference, targetBoardItemId: id.nullable() }).strict(),
  z.object({ action: z.literal("RESOLVE_CURRENT"), reason: z.enum(["answered", "completed", "teacher_moved_on", "replaced"]), evidence: reference }).strict(),
]);
const warning = z.object({ code: z.string().min(1).max(80), detail: z.string().min(1).max(240).nullable() }).strict();
const step = z.object({
  consumesCheckpointIds: z.array(id).min(1).max(20),
  boardDelta,
  cueDelta,
  evidenceRefs: z.array(reference).max(12),
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

Ground every learner-visible reference as an exact non-empty substring of its checkpoint text. Historical evidence may clarify a relation or reference, but every non-KEEP step needs a reference from a checkpoint it consumes now. Prefer KEEP plus a warning when evidence is ambiguous. Never invent a hint, answer, teaching claim, paraphrase, HTML, CSS, layout, timing, animation, TeX, or whole replacement state.

Board supports KEEP, SET_ACTIVE, and ADD_SUPPORT. Use correction only with retainPrevious=false and explicit invalidatesBoardItemIds. Board content is limited to TEXT, FOCUS, RELATION(cause|sequence|contrast), and TRANSFORM.

Within one ordered proposal only, a SET_ACTIVE in step N creates the deterministic Board item ID \`board-\${requestId}-accepted-N\`. A later step may reference that exact ID in targetBoardItemId; replace N with the zero-based earlier step index. Do not invent another intra-batch ID, and do not target a Board item that has been retired or invalidated by an earlier step.

Cue supports KEEP, SET(QUESTION|TASK|NOTE|HINT), and RESOLVE_CURRENT. Cue SET targetBoardItemId is optional: include it only for a current active or retained Board item, an earlier step's deterministic SET_ACTIVE ID, or this step's own deterministic SET_ACTIVE ID. If no target is confidently valid, omit targetBoardItemId. An instruction containing a question is one TASK. HINT must quote a hint the teacher actually gave. Board changes never resolve Cue; Cue resolution never clears Board.`;

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

function normalizeBoardDelta(delta: z.infer<typeof boardDelta>) {
  switch (delta.action) {
    case "KEEP": return { action: "KEEP" as const, reason: delta.reason };
    case "ADD_SUPPORT": return { action: "ADD_SUPPORT" as const, support: delta.support, targetBoardItemId: delta.targetBoardItemId };
    case "SET_ACTIVE": return {
      action: "SET_ACTIVE" as const,
      content: delta.content,
      continuity: delta.continuity,
      retainPrevious: delta.retainPrevious,
      ...(delta.support === null ? {} : { support: delta.support }),
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
      source: delta.source,
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
