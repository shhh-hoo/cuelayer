import { exactReferenceIsGrounded } from "./evidence-checkpoints";
import { reduceAcceptedStep } from "./teaching-state";
import type {
  AcceptedInterpretationStep,
  BoardContent,
  BoardDelta,
  CompactEvidenceCheckpoint,
  GroundedReference,
  TeachingCueDelta,
  TeachingInterpretationProposal,
  TeachingInterpretationRequest,
  TeachingStateSnapshot,
} from "./contracts";

type ValidationResult =
  | { ok: true; steps: AcceptedInterpretationStep[]; boardConflict: boolean; cueConflict: boolean }
  | { ok: false; error: string };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const reference = (value: unknown): value is GroundedReference => object(value) && typeof value.checkpointId === "string" && typeof value.text === "string" && value.text.trim().length > 0;
const warning = (value: unknown) => object(value) && typeof value.code === "string" && (value.detail === undefined || typeof value.detail === "string");
const valueType = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

function stepSchemaError(stepIndex: number, step: unknown) {
  const prefix = `proposal-step-schema-invalid:step-${stepIndex}`;
  if (!object(step)) return `${prefix}:step:${valueType(step)}`;
  if (!Array.isArray(step.consumesCheckpointIds) || !step.consumesCheckpointIds.length || !step.consumesCheckpointIds.every((id) => typeof id === "string")) return `${prefix}:consumesCheckpointIds:${valueType(step.consumesCheckpointIds)}`;
  if (!validBoardDelta(step.boardDelta)) {
    if (object(step.boardDelta) && step.boardDelta.action === "SET_ACTIVE") {
      if (step.boardDelta.support !== undefined && !Array.isArray(step.boardDelta.support)) return `${prefix}:boardDelta.support:${valueType(step.boardDelta.support)}`;
      if (step.boardDelta.invalidatesBoardItemIds !== undefined && !Array.isArray(step.boardDelta.invalidatesBoardItemIds)) return `${prefix}:boardDelta.invalidatesBoardItemIds:${valueType(step.boardDelta.invalidatesBoardItemIds)}`;
    }
    return `${prefix}:boardDelta:${valueType(step.boardDelta)}`;
  }
  if (!validCueDelta(step.cueDelta)) {
    if (object(step.cueDelta) && step.cueDelta.action === "SET" && step.cueDelta.targetBoardItemId !== undefined && typeof step.cueDelta.targetBoardItemId !== "string") return `${prefix}:cueDelta.targetBoardItemId:${valueType(step.cueDelta.targetBoardItemId)}`;
    return `${prefix}:cueDelta:${valueType(step.cueDelta)}`;
  }
  if (!Array.isArray(step.evidenceRefs) || !step.evidenceRefs.every(reference)) return `${prefix}:evidenceRefs:${valueType(step.evidenceRefs)}`;
  if (step.warnings !== undefined && (!Array.isArray(step.warnings) || step.warnings.length > 4 || !step.warnings.every(warning))) return `${prefix}:warnings:${valueType(step.warnings)}`;
  return undefined;
}

function contentReferences(content: BoardContent): GroundedReference[] {
  switch (content.kind) {
    case "TEXT": return [content.source];
    case "FOCUS": return [content.target];
    case "RELATION": return content.targets;
    case "TRANSFORM": return [content.from, content.to];
  }
}

function validBoardContent(value: unknown): value is BoardContent {
  if (!object(value) || typeof value.kind !== "string") return false;
  if (value.kind === "TEXT") return reference(value.source);
  if (value.kind === "FOCUS") return reference(value.target);
  if (value.kind === "RELATION") return ["cause", "sequence", "contrast"].includes(String(value.relation)) && Array.isArray(value.targets) && value.targets.length >= 2 && value.targets.every(reference);
  if (value.kind === "TRANSFORM") return reference(value.from) && reference(value.to);
  return false;
}

function validBoardDelta(value: unknown): value is BoardDelta {
  if (!object(value) || typeof value.action !== "string") return false;
  if (value.action === "KEEP") return ["filler", "transition", "repetition", "unfinished", "insufficient_evidence", "ambiguous_reference", "classroom_management", "no_board_value"].includes(String(value.reason));
  if (value.action === "ADD_SUPPORT") return reference(value.support) && typeof value.targetBoardItemId === "string";
  if (value.action !== "SET_ACTIVE" || !validBoardContent(value.content)) return false;
  return ["same_thread", "topic_shift", "correction"].includes(String(value.continuity))
    && typeof value.retainPrevious === "boolean"
    && (value.support === undefined || Array.isArray(value.support) && value.support.every(reference))
    && (value.invalidatesBoardItemIds === undefined || Array.isArray(value.invalidatesBoardItemIds) && value.invalidatesBoardItemIds.every((id) => typeof id === "string"));
}

function validCueDelta(value: unknown): value is TeachingCueDelta {
  if (!object(value) || typeof value.action !== "string") return false;
  if (value.action === "KEEP") return true;
  if (value.action === "SET") return ["QUESTION", "TASK", "NOTE", "HINT"].includes(String(value.cueKind)) && reference(value.source) && (value.targetBoardItemId === undefined || typeof value.targetBoardItemId === "string");
  return value.action === "RESOLVE_CURRENT" && ["answered", "completed", "teacher_moved_on", "replaced"].includes(String(value.reason)) && reference(value.evidence);
}

function boardReferences(delta: BoardDelta) {
  if (delta.action === "KEEP") return [];
  if (delta.action === "ADD_SUPPORT") return [delta.support];
  return [...contentReferences(delta.content), ...(delta.support ?? [])];
}

function cueReferences(delta: TeachingCueDelta) {
  if (delta.action === "SET") return [delta.source];
  if (delta.action === "RESOLVE_CURRENT") return [delta.evidence];
  return [];
}

export function validateAndNormalizeProposal({
  proposal: raw,
  request,
  allCheckpoints,
  state,
  model,
  acceptedAt = new Date().toISOString(),
}: {
  proposal: unknown;
  request: TeachingInterpretationRequest;
  allCheckpoints: CompactEvidenceCheckpoint[];
  state: TeachingStateSnapshot;
  model: string;
  acceptedAt?: string;
}): ValidationResult {
  if (!object(raw) || typeof raw.requestId !== "string" || typeof raw.baseBoardRevision !== "number" || !Number.isInteger(raw.baseBoardRevision) || raw.baseBoardRevision < 0 || typeof raw.baseCueRevision !== "number" || !Number.isInteger(raw.baseCueRevision) || raw.baseCueRevision < 0 || !Array.isArray(raw.steps) || !raw.steps.length || (raw.warnings !== undefined && (!Array.isArray(raw.warnings) || raw.warnings.length > 4 || !raw.warnings.every(warning)))) return { ok: false, error: "proposal-schema-invalid" };
  if (raw.requestId !== request.requestId) return { ok: false, error: "proposal-request-id-mismatch" };

  const proposal = raw as unknown as TeachingInterpretationProposal;
  const boardConflict = proposal.baseBoardRevision !== state.board.revision && proposal.steps.some((step) => step.boardDelta.action !== "KEEP");
  const cueConflict = proposal.baseCueRevision !== state.cue.revision && proposal.steps.some((step) => step.cueDelta.action !== "KEEP");
  const checkpointSequences = new Map(allCheckpoints.map((checkpoint) => [checkpoint.checkpointId, checkpoint.lessonSequence]));
  let coverageOffset = 0;
  let rollingState = state;
  const steps: AcceptedInterpretationStep[] = [];
  for (const [stepIndex, step] of proposal.steps.entries()) {
    const schemaError = stepSchemaError(stepIndex, step);
    if (schemaError) return { ok: false, error: schemaError };
    const expected = request.newEvidence.slice(coverageOffset, coverageOffset + step.consumesCheckpointIds.length).map((checkpoint) => checkpoint.checkpointId);
    if (expected.length !== step.consumesCheckpointIds.length || expected.some((id, index) => id !== step.consumesCheckpointIds[index])) return { ok: false, error: "proposal-batch-coverage-invalid" };
    coverageOffset += step.consumesCheckpointIds.length;

    const refs = [...step.evidenceRefs, ...boardReferences(step.boardDelta), ...cueReferences(step.cueDelta)];
    if (refs.some((item) => !exactReferenceIsGrounded(item, allCheckpoints))) return { ok: false, error: "proposal-grounding-invalid" };
    if (step.boardDelta.action !== "KEEP" || step.cueDelta.action !== "KEEP") {
      const currentIds = new Set(step.consumesCheckpointIds);
      if (!refs.some((item) => currentIds.has(item.checkpointId))) return { ok: false, error: "proposal-missing-current-trigger" };
    }
    if (step.boardDelta.action === "SET_ACTIVE" && step.boardDelta.continuity === "correction" && (step.boardDelta.retainPrevious || !step.boardDelta.invalidatesBoardItemIds?.length)) return { ok: false, error: "proposal-correction-invalid" };

    const effectiveBoardDelta = boardConflict ? { action: "KEEP" as const, reason: "insufficient_evidence" as const } : step.boardDelta;
    const effectiveCueDelta = cueConflict ? { action: "KEEP" as const } : step.cueDelta;
    const boardItemIds = new Set([
      ...(rollingState.board.active ? [rollingState.board.active.id] : []),
      ...rollingState.board.retained.map((item) => item.id),
    ]);
    if (effectiveBoardDelta.action === "ADD_SUPPORT" && !boardItemIds.has(effectiveBoardDelta.targetBoardItemId)) return { ok: false, error: "proposal-support-target-missing" };
    if (effectiveBoardDelta.action === "SET_ACTIVE" && effectiveBoardDelta.continuity === "correction" && effectiveBoardDelta.invalidatesBoardItemIds!.some((id) => !boardItemIds.has(id))) return { ok: false, error: "proposal-correction-target-missing" };
    if (effectiveCueDelta.action === "RESOLVE_CURRENT" && !rollingState.cue.active) return { ok: false, error: "proposal-cue-resolution-without-active-cue" };
    // A cue may optionally point at this step's Board item. This is deliberately
    // narrower than Board mutation targets: invalid optional presentation linkage
    // never discards an otherwise grounded, safe cue.
    const cueTargetIds = new Set(boardItemIds);
    if (effectiveBoardDelta.action === "SET_ACTIVE") cueTargetIds.add(`board-${request.requestId}-accepted-${stepIndex}`);
    const cueTargetDropped = effectiveCueDelta.action === "SET"
      && effectiveCueDelta.targetBoardItemId !== undefined
      && !cueTargetIds.has(effectiveCueDelta.targetBoardItemId);
    const normalizedCueDelta = cueTargetDropped
      ? (() => {
          const { targetBoardItemId: _droppedTarget, ...cueWithoutTarget } = effectiveCueDelta;
          return cueWithoutTarget;
        })()
      : effectiveCueDelta;

    const groundedReferences = refs.filter((item, index, items) => items.findIndex((candidate) => candidate.checkpointId === item.checkpointId && candidate.text === item.text) === index);
    const accepted: AcceptedInterpretationStep = {
      interpretationId: `${request.requestId}-accepted`,
      requestId: request.requestId,
      stepIndex,
      consumesCheckpointIds: [...step.consumesCheckpointIds],
      baseBoardRevision: rollingState.board.revision,
      baseCueRevision: rollingState.cue.revision,
      boardDelta: effectiveBoardDelta,
      cueDelta: normalizedCueDelta,
      evidenceRefs: groundedReferences,
      warnings: [
        ...(cueTargetDropped ? [{ code: "cue_target_dropped" }] : []),
        ...(step.warnings ?? []).slice(0, 4),
        ...(proposal.warnings ?? []).slice(0, 2),
        ...(boardConflict ? [{ code: "board_channel_conflict" }] : []),
        ...(cueConflict ? [{ code: "cue_channel_conflict" }] : []),
      ].slice(0, 6),
      model,
      policyVersion: request.policyVersion,
      acceptedAt,
    };
    steps.push(accepted);
    rollingState = reduceAcceptedStep(rollingState, accepted, checkpointSequences);
  }
  if (coverageOffset !== request.newEvidence.length) return { ok: false, error: "proposal-batch-coverage-invalid" };
  return { ok: true, steps, boardConflict, cueConflict };
}
