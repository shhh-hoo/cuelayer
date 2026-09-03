import type { SpeechWord } from "../session/speech-types";

export const LESSON_POLICY_VERSION = "bounded-agent-p4-alpha-v2";
export const LESSON_EVENT_SCHEMA_VERSION = "lesson-event-v3-learner-agency";
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

/** Exact teacher-speech evidence. Quotes, unlike visible contributions, must be substrings. */
export type SpeechReference = {
  checkpointId: string;
  quote: string;
};

export type ContributionMode = "RECONSTRUCT" | "REPRESENT" | "AUGMENT" | "CORRECT" | "INITIATE";
export type InterventionRisk = "LOW" | "MEDIUM" | "HIGH";
/** A stable policy seam for future confidence thresholds; it never claims subject-matter correctness. */
export function interventionRiskFor(mode: ContributionMode, cueKind?: TeachingCueKind): InterventionRisk {
  if (mode === "CORRECT" || mode === "INITIATE") return "HIGH";
  if (mode === "AUGMENT" || cueKind === "NOTE") return "MEDIUM";
  return "LOW";
}
export type StateReference = { kind: "BOARD_ITEM" | "ACTIVE_CUE"; id: string };
export type ContributionProvenance = {
  speechRefs?: SpeechReference[];
  stateRefs?: StateReference[];
  basis: "SPEECH" | "SPEECH_AND_STATE" | "DOMAIN_KNOWLEDGE" | "STATE_AND_DOMAIN_KNOWLEDGE";
};
export type TeachingContribution<TContent> = {
  mode: ContributionMode;
  content: TContent;
  provenance: ContributionProvenance;
};

export type BoardContent =
  | { kind: "TEXT"; text: string }
  | { kind: "FOCUS"; target: string }
  | { kind: "RELATION"; relation: "cause" | "sequence" | "contrast"; targets: string[] }
  | { kind: "TRANSFORM"; from: string; to: string };

export type BoardDelta =
  | {
      action: "KEEP";
      reason: "filler" | "transition" | "repetition" | "unfinished" | "insufficient_evidence" | "ambiguous_reference" | "classroom_management" | "no_board_value";
    }
  | {
      action: "SET_ACTIVE";
      contribution: TeachingContribution<BoardContent>;
      continuity: "same_thread" | "topic_shift" | "correction";
      retainPrevious: boolean;
      support?: TeachingContribution<string>[];
      invalidatesBoardItemIds?: string[];
    }
  | { action: "ADD_SUPPORT"; support: TeachingContribution<string>; targetBoardItemId: string };

export type TeachingCueKind = "NOTE" | "QUESTION" | "TASK" | "HINT";

export type TeachingCueDelta =
  | { action: "KEEP" }
  | { action: "SET"; cueKind: TeachingCueKind; contribution: TeachingContribution<string>; targetBoardItemId?: string }
  | { action: "RESOLVE_CURRENT"; reason: "answered" | "completed" | "teacher_moved_on" | "replaced"; evidence: SpeechReference };

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
  evidenceRefs: SpeechReference[];
  warnings: InterpretationWarning[];
  model: string;
  policyVersion: string;
  acceptedAt: string;
};

export type BoardItem = {
  id: string;
  contribution: TeachingContribution<BoardContent>;
  sourceCheckpointIds: string[];
  establishedAtRevision: number;
};

export type BoardSupport = {
  id: string;
  targetBoardItemId: string;
  contribution: TeachingContribution<string>;
};

export type ActiveLessonCue = {
  id: string;
  kind: TeachingCueKind;
  contribution: TeachingContribution<string>;
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

type EventIdentity = { schemaVersion: typeof LESSON_EVENT_SCHEMA_VERSION; eventId: string; sessionId: string; sequence: number };
export type LessonEvent =
  | (EventIdentity & { type: "lesson.started"; timestamp: string })
  | (EventIdentity & { type: "evidence.checkpoint_committed"; timestamp: string; checkpoint: CompactEvidenceCheckpoint; grounding: GroundingRecord })
  | (EventIdentity & { type: "interpretation.step_accepted"; step: AcceptedInterpretationStep })
  | (EventIdentity & { type: "teaching_cue.expired"; cueId: string; baseCueRevision: number; timestamp: string })
  | (EventIdentity & { type: "teacher_override.applied"; operation: { kind: string; payload?: unknown } })
  | (EventIdentity & { type: "lesson.ended"; timestamp: string });

export type ProcessedTimelineEntry =
  | { type: "evidence"; checkpointId: string; sequence: number; text: string; warnings: SpeechEvidenceWarning[] }
  | {
      type: "accepted_interpretation";
      interpretationId: string;
      contributionIds: { board?: string; cue?: string };
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
  evidenceRefs: SpeechReference[];
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
