import type { SpeechWord } from "../session/speech-types";

export const LESSON_POLICY_VERSION = "live-state-p4-v1";
export const NOTE_EXPIRY_MS = 4_000;

export type SpeechEvidenceWarning = {
  code: "low_confidence" | "possible_correction" | "provider_gap" | "asr_ambiguity";
  detail?: string;
};

export type CompactEvidenceCheckpoint = {
  checkpointId: string;
  lessonSequence: number;
  speechRunId: number;
  startMs: number;
  endMs: number;
  text: string;
  sourceFinalIds: string[];
  warnings: SpeechEvidenceWarning[];
};

export type GroundingRecord = {
  checkpointId: string;
  canonicalSpanIds: Array<{ spanId: string; spanRevision: number }>;
  words: SpeechWord[];
  providerEvidence: Array<{ providerFinalId: string }>;
};

export type GroundedReference = {
  checkpointId: string;
  text: string;
};

export type BoardContent =
  | { kind: "TEXT"; source: GroundedReference }
  | { kind: "FOCUS"; target: GroundedReference }
  | { kind: "RELATION"; relation: "cause" | "sequence" | "contrast"; targets: GroundedReference[] }
  | { kind: "TRANSFORM"; from: GroundedReference; to: GroundedReference };

export type BoardDelta =
  | {
      action: "KEEP";
      reason: "filler" | "transition" | "repetition" | "unfinished" | "insufficient_evidence" | "ambiguous_reference" | "classroom_management" | "no_board_value";
    }
  | {
      action: "SET_ACTIVE";
      content: BoardContent;
      continuity: "same_thread" | "topic_shift" | "correction";
      retainPrevious: boolean;
      support?: GroundedReference[];
      invalidatesBoardItemIds?: string[];
    }
  | { action: "ADD_SUPPORT"; support: GroundedReference; targetBoardItemId: string };

export type TeachingCueDelta =
  | { action: "KEEP" }
  | { action: "SET"; cueKind: "QUESTION" | "TASK" | "NOTE" | "HINT"; source: GroundedReference; targetBoardItemId?: string }
  | { action: "RESOLVE_CURRENT"; reason: "answered" | "completed" | "teacher_moved_on" | "replaced"; evidence: GroundedReference };

export type InterpretationWarning = {
  code: string;
  detail?: string;
};

export type AcceptedInterpretationStep = {
  interpretationId: string;
  requestId: string;
  stepIndex: number;
  consumesCheckpointIds: string[];
  baseBoardRevision: number;
  baseCueRevision: number;
  boardDelta: BoardDelta;
  cueDelta: TeachingCueDelta;
  evidenceRefs: GroundedReference[];
  warnings: InterpretationWarning[];
  model: string;
  policyVersion: string;
  acceptedAt: string;
};

export type BoardItem = {
  id: string;
  content: BoardContent;
  sourceCheckpointIds: string[];
  establishedAtRevision: number;
};

export type BoardSupport = {
  id: string;
  targetBoardItemId: string;
  source: GroundedReference;
};

export type ActiveLessonCue = {
  id: string;
  kind: "QUESTION" | "TASK" | "NOTE" | "HINT";
  text: string;
  sourceSegmentIds: string[];
  activatedAt: number;
  targetBoardItemId?: string;
  expiresAt?: number;
};

export type TeachingStateSnapshot = {
  lessonRevision: number;
  processedThroughSequence: number;
  board: {
    revision: number;
    active?: BoardItem;
    support: BoardSupport[];
    retained: BoardItem[];
  };
  cue: {
    revision: number;
    active?: ActiveLessonCue;
  };
};

export type LessonEvent =
  | { type: "lesson.started"; eventId: string; sessionId: string; sequence: number; timestamp: string }
  | { type: "evidence.checkpoint_committed"; eventId: string; sessionId: string; sequence: number; timestamp: string; checkpoint: CompactEvidenceCheckpoint; grounding: GroundingRecord }
  | { type: "interpretation.step_accepted"; eventId: string; sessionId: string; sequence: number; step: AcceptedInterpretationStep }
  | { type: "teaching_cue.expired"; eventId: string; sessionId: string; sequence: number; cueId: string; baseCueRevision: number; timestamp: string }
  | { type: "teacher_override.applied"; eventId: string; sessionId: string; sequence: number; operation: { kind: string; payload?: unknown } }
  | { type: "lesson.ended"; eventId: string; sessionId: string; sequence: number; timestamp: string };

export type ProcessedTimelineEntry =
  | { type: "evidence"; checkpointId: string; sequence: number; text: string; warnings: SpeechEvidenceWarning[] }
  | {
      type: "accepted_interpretation";
      interpretationId: string;
      consumesCheckpointIds: string[];
      boardDelta: BoardDelta;
      cueDelta: TeachingCueDelta;
      resultingBoardRevision: number;
      resultingCueRevision: number;
    };

export type TeachingInterpretationRequest = {
  requestId: string;
  sessionId: string;
  policyVersion: string;
  processedTimeline: ProcessedTimelineEntry[];
  currentState: TeachingStateSnapshot;
  newEvidence: CompactEvidenceCheckpoint[];
  expected: { firstUnconsumedSequence: number; lastUnconsumedSequence: number };
};

export type TeachingInterpretationStepProposal = {
  consumesCheckpointIds: string[];
  boardDelta: BoardDelta;
  cueDelta: TeachingCueDelta;
  evidenceRefs: GroundedReference[];
  warnings?: InterpretationWarning[];
};

export type TeachingInterpretationProposal = {
  requestId: string;
  baseBoardRevision: number;
  baseCueRevision: number;
  steps: TeachingInterpretationStepProposal[];
  warnings?: InterpretationWarning[];
};

export type ContextProjectionDiagnostics = {
  policyTokens: number;
  timelineTokens: number;
  stateTokens: number;
  newEvidenceTokens: number;
  projectedInputTokens: number;
};
