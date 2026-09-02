export const TEACHING_CUE_KINDS = ["QUESTION", "TASK", "NOTE", "HINT"] as const;

export type TeachingCueKind = (typeof TEACHING_CUE_KINDS)[number];

/** One learner-facing teaching cue may remain active independently of board updates. */
export type ActiveTeachingCue = {
  id: string;
  kind: TeachingCueKind;
  text: string;
  sourceSegmentIds: string[];
  activatedAt: number;
  /** Absence means the cue remains until explicitly resolved or replaced. */
  expiresAt?: number;
};

export type TeachingCueDraft = {
  id: string;
  kind: TeachingCueKind;
  text: string;
  sourceSegmentIds?: string[];
  /** Overrides the default lifetime. Omit for kind-specific policy. */
  durationMs?: number;
};

export type TeachingCueState = {
  active?: ActiveTeachingCue;
};
