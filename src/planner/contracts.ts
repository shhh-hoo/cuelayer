import type { CaptionClip, EffectCue } from "../types";
import type { CanonicalSpeechSpan } from "../session/speech-types";

export type GroundedTextReference = { segmentId: string; text: string };
export type GroundedSpeechTurn = Pick<CanonicalSpeechSpan, "id" | "text" | "words">;

export type DisplayIntent =
  | { kind: "QUIET"; reason: "filler" | "transition" | "repetition" | "unfinished" | "insufficient-evidence" }
  /** The current planner work span, never model-generated text, owns the Plain caption surface. */
  | { kind: "TEXT" }
  | { kind: "FOCUS"; target: GroundedTextReference }
  | { kind: "RELATE"; relation: "cause" | "sequence" | "contrast"; targets: GroundedTextReference[] }
  | { kind: "TRANSFORM"; from: GroundedTextReference; to: GroundedTextReference };

export type LearnerIntent =
  | { kind: "NONE" }
  | { kind: "NOTE"; target?: GroundedTextReference }
  | { kind: "REFLECT"; target?: GroundedTextReference };

/** The full CueCaption dossier remains policy authority; this is the evidence needed for one live decision. */
export type CueCaptionWarningCode = "ASR_AMBIGUITY" | "MISSING_STRUCTURE" | "MISSING_REFERENCE" | "MISSING_REACTION_FACT" | "POSSIBLE_TEACHER_ERROR" | "CONTEXT_CONFLICT";
export type GroundedRewrite = { source: GroundedTextReference; displayText: string };
export type GroundedWarning = { code: CueCaptionWarningCode; target?: GroundedTextReference };
export type LiveDecisionEvidence = {
  protected?: GroundedTextReference[];
  rewrites?: GroundedRewrite[];
  warnings?: GroundedWarning[];
};

/** Planner output is compact semantic intent only. The compiler owns every renderer detail. */
export type RuntimeDecision = { display: DisplayIntent; learner: LearnerIntent; evidence?: LiveDecisionEvidence };

export type CaptionEpisodeStatus = "live" | "holding" | "locked";
export type CaptionEpisode = {
  id: string;
  clip: CaptionClip;
  cue?: EffectCue;
  status: CaptionEpisodeStatus;
  sourceSegmentIds: string[];
  activatedAt: number;
  expiresAt?: number;
};

/** Alpha semantic-caption lifecycle: one transient subtitle and one teacher-kept subtitle. */
export type TransientLearnerCue = { id: string; kind: "NOTE" | "REFLECT"; expiresAt: number };
export type CaptionRuntimeState = { current?: CaptionEpisode; locked?: CaptionEpisode; learnerCue?: TransientLearnerCue };
type CaptionEpisodeContext = { sourceSegmentIds: string[]; displayKind: DisplayIntent["kind"] };

export type PlannerInput = {
  recentSpeech: GroundedSpeechTurn[];
  activeCaption?: CaptionEpisodeContext;
  lockedCaption?: CaptionEpisodeContext;
};

export type PlannerStatus = "idle" | "planning" | "ready" | "error" | "unavailable";
export type PlannerDebugState = {
  status: PlannerStatus;
  requestId: number;
  inFlightRequestId?: number;
  latestDecision?: RuntimeDecision;
  runtime: CaptionRuntimeState;
  lastValidationError?: string;
  lastError?: string;
};
