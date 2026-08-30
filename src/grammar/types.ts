export type TranscriptToken = {
  id: string;
  text: string;
  joinerBefore: string;
  startMs: number;
  endMs: number;
};

/** Backwards-compatible name for raw transcript tokens. */
export type CaptionToken = TranscriptToken;

export type Transcript = {
  id: string;
  tokens: TranscriptToken[];
};

export type SourceRef =
  | { kind: "speech"; tokenIds: string[] }
  | { kind: "lesson-source"; sourceId: string; locator: string; exactText: string }
  | { kind: "normalization-rule"; ruleId: "punctuation" | "spacing-repair" | "filler-removal" | "duplicate-removal" | "notation-normalization" };

export type CaptionFragment = {
  id: string;
  text: string;
  provenance: SourceRef[];
  transformation: "verbatim" | "cleanup" | "term-correction" | "referent-resolution" | "canonicalization";
  confidence: number;
};

export type SuppressedSpeech = {
  tokenIds: string[];
  reason: "filler" | "duplicate" | "false-start" | "non-instructional-housekeeping";
  preserveAsPedagogicalCue: boolean;
};

export type PedagogicalCue = { kind: "FOCUS"; source: SourceRef[]; reason: string };

export type GroundedCaption = { fragments: CaptionFragment[]; suppressed: SuppressedSpeech[]; pedagogicalCues: PedagogicalCue[] };

export type CaptionSpanRef = { fragmentId: string; startOffset: number; endOffset: number; exactText: string };

export type CaptionOperation =
  | { kind: "NONE" }
  | { kind: "FOCUS"; targets: CaptionSpanRef[] }
  | {
      kind: "RELATE";
      items: CaptionSpanRef[];
      relation: "cause" | "sequence" | "contrast" | "equivalence" | "hierarchy";
      reveal: "simultaneous" | "progressive";
    }
  | {
      kind: "TRANSFORM";
      from: CaptionSpanRef;
      to: CaptionSpanRef;
      mode: "replace" | "derive" | "state-change";
    };

export type DisplayPolicy = {
  treatmentId: string;
  intensity: "subtle" | "normal" | "strong";
  startMs: number;
  durationMs: number;
  holdMs: number;
  decay: "restore-caption" | "fade" | "remain";
};

export type EffectPlan = {
  operation: CaptionOperation;
  display: DisplayPolicy;
};

export type TrustedLessonSource = Extract<SourceRef, { kind: "lesson-source" }>;

export type FxExample = {
  id: string;
  title: string;
  sourceType: "adapted" | "synthetic";
  subject: string;
  rawTranscript: Transcript;
  trustedLessonContext: TrustedLessonSource[];
  groundedCaption: GroundedCaption;
  expectedGroundedCaption: string;
  explicitTeachingRelation: string;
  candidateEffectPlan: EffectPlan;
  intendedLearningFunction: string;
  studentWork: string;
  risk: string;
};
