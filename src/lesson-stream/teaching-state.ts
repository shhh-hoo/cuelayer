import { NOTE_EXPIRY_MS, type AcceptedInterpretationStep, type BoardItem, type BoardSupport, type LessonEvent, type TeachingStateSnapshot } from "./contracts";

export function createInitialTeachingState(): TeachingStateSnapshot {
  return {
    lessonRevision: 0,
    processedThroughSequence: 0,
    board: { revision: 0, support: [], retained: [] },
    cue: { revision: 0 },
  };
}

function boardItemFor(step: AcceptedInterpretationStep, revision: number): BoardItem {
  if (step.boardDelta.action !== "SET_ACTIVE") throw new Error("board-item-needs-active-delta");
  return {
    id: `board-${step.interpretationId}-${step.stepIndex}`,
    contribution: step.boardDelta.contribution,
    sourceCheckpointIds: [...new Set((step.boardDelta.contribution.provenance.speechRefs ?? []).map((reference) => reference.checkpointId))],
    establishedAtRevision: revision,
  };
}

function reduceBoard(state: TeachingStateSnapshot["board"], step: AcceptedInterpretationStep): TeachingStateSnapshot["board"] {
  const delta = step.boardDelta;
  if (delta.action === "KEEP") return state;
  if (delta.action === "ADD_SUPPORT") {
    const targetExists = state.active?.id === delta.targetBoardItemId || state.retained.some((item) => item.id === delta.targetBoardItemId);
    if (!targetExists) return state;
    if (state.support.some((support) => support.targetBoardItemId === delta.targetBoardItemId && support.contribution.content === delta.support.content && support.contribution.mode === delta.support.mode)) return state;
    const revision = state.revision + 1;
    const support: BoardSupport = { id: `support-${step.interpretationId}-${step.stepIndex}`, targetBoardItemId: delta.targetBoardItemId, contribution: delta.support };
    return { ...state, revision, support: [...state.support, support].slice(-2) };
  }

  const revision = state.revision + 1;
  const active = boardItemFor(step, revision);
  if (delta.continuity === "topic_shift") return { revision, active, support: [], retained: [] };

  const invalidated = new Set(delta.invalidatesBoardItemIds ?? []);
  const previous = [state.active, ...state.retained].filter((item): item is BoardItem => item !== undefined && !invalidated.has(item.id));
  const retainPrevious = delta.continuity === "same_thread" && delta.retainPrevious;
  const retained = retainPrevious ? previous.slice(0, 2) : [];
  const support = (delta.support ?? []).slice(0, 2).map((contribution, index): BoardSupport => ({
    id: `support-${step.interpretationId}-${step.stepIndex}-${index}`,
    targetBoardItemId: active.id,
    contribution,
  }));
  return { revision, active, support, retained };
}

function reduceCue(state: TeachingStateSnapshot["cue"], step: AcceptedInterpretationStep): TeachingStateSnapshot["cue"] {
  const delta = step.cueDelta;
  if (delta.action === "KEEP") return state;
  if (delta.action === "RESOLVE_CURRENT") return state.active ? { revision: state.revision + 1 } : state;
  const activatedAt = Date.parse(step.acceptedAt);
  const revision = state.revision + 1;
  return {
    revision,
    active: {
      id: `cue-${step.interpretationId}-${step.stepIndex}`,
      kind: delta.cueKind,
      contribution: delta.contribution,
      sourceSegmentIds: [...new Set((delta.contribution.provenance.speechRefs ?? []).map((reference) => reference.checkpointId))],
      activatedAt,
      ...(delta.targetBoardItemId ? { targetBoardItemId: delta.targetBoardItemId } : {}),
      ...(delta.cueKind === "NOTE" ? { expiresAt: activatedAt + NOTE_EXPIRY_MS } : {}),
    },
  };
}

export function reduceAcceptedStep(
  state: TeachingStateSnapshot,
  step: AcceptedInterpretationStep,
  checkpointSequences: ReadonlyMap<string, number>,
): TeachingStateSnapshot {
  const board = reduceBoard(state.board, step);
  const cue = reduceCue(state.cue, step);
  const changed = board !== state.board || cue !== state.cue;
  const processedThroughSequence = Math.max(
    state.processedThroughSequence,
    ...step.consumesCheckpointIds.map((id) => checkpointSequences.get(id) ?? 0),
  );
  return {
    lessonRevision: state.lessonRevision + (changed ? 1 : 0),
    processedThroughSequence,
    board,
    cue,
  };
}

export function reduceLessonEvent(
  state: TeachingStateSnapshot,
  event: LessonEvent,
  checkpointSequences: ReadonlyMap<string, number>,
): TeachingStateSnapshot {
  if (event.type === "interpretation.step_accepted") return reduceAcceptedStep(state, event.step, checkpointSequences);
  if (event.type === "teaching_cue.expired" && state.cue.active?.id === event.cueId && state.cue.revision === event.baseCueRevision) {
    return { ...state, lessonRevision: state.lessonRevision + 1, cue: { revision: state.cue.revision + 1 } };
  }
  return state;
}
