import { exactSpeechReferenceIsGrounded } from "./evidence-checkpoints";
import { reduceAcceptedStep } from "./teaching-state";
import type {
  AcceptedInterpretationStep,
  BoardContent,
  BoardDelta,
  CompactEvidenceCheckpoint,
  ContributionMode,
  ContributionProvenance,
  SpeechReference,
  StateReference,
  TeachingContribution,
  TeachingCueDelta,
  TeachingInterpretationProposal,
  TeachingInterpretationRequest,
  TeachingStateSnapshot,
} from "./contracts";

type ValidationResult =
  | { ok: true; steps: AcceptedInterpretationStep[]; boardConflict: boolean; cueConflict: boolean }
  | { ok: false; error: string };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const reference = (value: unknown): value is SpeechReference => object(value) && typeof value.checkpointId === "string" && typeof value.quote === "string" && value.quote.trim().length > 0;
const stateReference = (value: unknown): value is StateReference => object(value) && ["BOARD_ITEM", "ACTIVE_CUE"].includes(String(value.kind)) && typeof value.id === "string" && value.id.length > 0;
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

function validBoardContent(value: unknown): value is BoardContent {
  if (!object(value)) return false;
  if (value.kind === "TEXT") return typeof value.text === "string" && value.text.trim().length > 0;
  if (value.kind === "FOCUS") return typeof value.target === "string" && value.target.trim().length > 0;
  if (value.kind === "RELATION") return ["cause", "sequence", "contrast"].includes(String(value.relation)) && Array.isArray(value.targets) && value.targets.length >= 2 && value.targets.every((target) => typeof target === "string" && target.trim().length > 0);
  return value.kind === "TRANSFORM" && typeof value.from === "string" && value.from.trim().length > 0 && typeof value.to === "string" && value.to.trim().length > 0;
}

function validProvenance(value: unknown): value is ContributionProvenance {
  if (!object(value) || !["SPEECH", "SPEECH_AND_STATE", "DOMAIN_KNOWLEDGE", "STATE_AND_DOMAIN_KNOWLEDGE"].includes(String(value.basis))) return false;
  if (value.speechRefs !== undefined && (!Array.isArray(value.speechRefs) || !value.speechRefs.every(reference))) return false;
  if (value.stateRefs !== undefined && (!Array.isArray(value.stateRefs) || !value.stateRefs.every(stateReference))) return false;
  const hasSpeech = Boolean(value.speechRefs?.length);
  const hasState = Boolean(value.stateRefs?.length);
  if (value.basis === "SPEECH") return hasSpeech && !hasState;
  if (value.basis === "SPEECH_AND_STATE") return hasSpeech && hasState;
  if (value.basis === "DOMAIN_KNOWLEDGE") return !hasState;
  return hasState;
}

function contribution<T>(value: unknown, content: (candidate: unknown) => candidate is T): value is TeachingContribution<T> {
  return object(value) && ["RECONSTRUCT", "REPRESENT", "AUGMENT", "CORRECT", "INITIATE"].includes(String(value.mode)) && content(value.content) && validProvenance(value.provenance);
}
function textContribution(value: unknown): value is TeachingContribution<string> { return contribution(value, (item): item is string => typeof item === "string" && item.trim().length > 0); }
function boardContribution<T>(value: unknown, content: (candidate: unknown) => candidate is T): value is TeachingContribution<T> {
  return contribution(value, content) && value.mode !== "INITIATE";
}

function validBoardDelta(value: unknown): value is BoardDelta {
  if (!object(value) || typeof value.action !== "string") return false;
  if (value.action === "KEEP") return ["filler", "transition", "repetition", "unfinished", "insufficient_evidence", "ambiguous_reference", "classroom_management", "no_board_value"].includes(String(value.reason));
  if (value.action === "ADD_SUPPORT") return boardContribution(value.support, (item): item is string => typeof item === "string" && item.trim().length > 0) && typeof value.targetBoardItemId === "string";
  if (value.action !== "SET_ACTIVE" || !boardContribution(value.contribution, validBoardContent)) return false;
  return ["same_thread", "topic_shift", "correction"].includes(String(value.continuity))
    && typeof value.retainPrevious === "boolean"
    && (value.support === undefined || Array.isArray(value.support) && value.support.every(textContribution))
    && (value.invalidatesBoardItemIds === undefined || Array.isArray(value.invalidatesBoardItemIds) && value.invalidatesBoardItemIds.every((id) => typeof id === "string"));
}

function validCueDelta(value: unknown): value is TeachingCueDelta {
  if (!object(value) || typeof value.action !== "string") return false;
  if (value.action === "KEEP") return true;
  if (value.action === "SET") {
    if (!["NOTE", "QUESTION", "TASK", "HINT"].includes(String(value.cueKind)) || !textContribution(value.contribution)) return false;
    const actionCue = ["QUESTION", "TASK", "HINT"].includes(String(value.cueKind));
    if (actionCue ? value.contribution.mode === "CORRECT" : ["CORRECT", "INITIATE"].includes(value.contribution.mode)) return false;
    if (value.contribution.mode === "INITIATE" && !actionCue) return false;
    return value.targetBoardItemId === undefined || typeof value.targetBoardItemId === "string";
  }
  return value.action === "RESOLVE_CURRENT" && ["answered", "completed", "teacher_moved_on", "replaced"].includes(String(value.reason)) && reference(value.evidence);
}

function boardReferences(delta: BoardDelta): SpeechReference[] {
  if (delta.action === "KEEP") return [];
  if (delta.action === "ADD_SUPPORT") return delta.support.provenance.speechRefs ?? [];
  return [...(delta.contribution.provenance.speechRefs ?? []), ...(delta.support ?? []).flatMap((support) => support.provenance.speechRefs ?? [])];
}

function cueReferences(delta: TeachingCueDelta): SpeechReference[] {
  if (delta.action === "SET") return delta.contribution.provenance.speechRefs ?? [];
  if (delta.action === "RESOLVE_CURRENT") return [delta.evidence];
  return [];
}

function stateReferences(delta: BoardDelta | TeachingCueDelta): StateReference[] {
  if (delta.action === "SET") return delta.contribution.provenance.stateRefs ?? [];
  if (delta.action === "SET_ACTIVE") return [...(delta.contribution.provenance.stateRefs ?? []), ...(delta.support ?? []).flatMap((support) => support.provenance.stateRefs ?? [])];
  if (delta.action === "ADD_SUPPORT") return delta.support.provenance.stateRefs ?? [];
  return [];
}
function stateReferencesExist(refs: readonly StateReference[], state: TeachingStateSnapshot) {
  const boardIds = new Set([...(state.board.active ? [state.board.active.id] : []), ...state.board.retained.map((item) => item.id)]);
  return refs.every((ref) => ref.kind === "BOARD_ITEM" ? boardIds.has(ref.id) : state.cue.active?.id === ref.id);
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
    if (refs.some((item) => !exactSpeechReferenceIsGrounded(item, allCheckpoints))) return { ok: false, error: "proposal-speech-grounding-invalid" };
    if (!stateReferencesExist([...stateReferences(step.boardDelta), ...stateReferences(step.cueDelta)], rollingState)) return { ok: false, error: "proposal-state-reference-missing" };
    if (step.boardDelta.action === "SET_ACTIVE" && step.boardDelta.continuity === "correction" && (step.boardDelta.retainPrevious || !step.boardDelta.invalidatesBoardItemIds?.length)) return { ok: false, error: "proposal-correction-invalid" };
    if (step.boardDelta.action === "SET_ACTIVE" && step.boardDelta.contribution.mode === "CORRECT" && step.boardDelta.continuity !== "correction") return { ok: false, error: "proposal-correction-invalid" };

    const effectiveBoardDelta = boardConflict ? { action: "KEEP" as const, reason: "insufficient_evidence" as const } : step.boardDelta;
    const effectiveCueDelta = cueConflict ? { action: "KEEP" as const } : step.cueDelta;
    const boardItemIds = new Set([
      ...(rollingState.board.active ? [rollingState.board.active.id] : []),
      ...rollingState.board.retained.map((item) => item.id),
    ]);
    if (effectiveBoardDelta.action === "ADD_SUPPORT" && !boardItemIds.has(effectiveBoardDelta.targetBoardItemId)) return { ok: false, error: "proposal-support-target-missing" };
    if (effectiveBoardDelta.action === "SET_ACTIVE" && effectiveBoardDelta.continuity === "correction" && effectiveBoardDelta.invalidatesBoardItemIds!.some((id) => !boardItemIds.has(id))) return { ok: false, error: "proposal-correction-target-missing" };
    if (effectiveCueDelta.action === "RESOLVE_CURRENT" && !rollingState.cue.active) return { ok: false, error: "proposal-cue-resolution-without-active-cue" };
    if (effectiveCueDelta.action === "SET" && ["TASK", "QUESTION"].includes(rollingState.cue.active?.kind ?? "")) return { ok: false, error: "proposal-active-learning-action-must-resolve-first" };
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

    const groundedReferences = refs.filter((item, index, items) => items.findIndex((candidate) => candidate.checkpointId === item.checkpointId && candidate.quote === item.quote) === index);
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
