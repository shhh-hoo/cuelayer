export type CaptionToken = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type Transcript = {
  id: string;
  tokens: CaptionToken[];
};

export type SpanRef = {
  tokenIds: string[];
  exactText: string;
};

export type CaptionOperation =
  | { kind: "NONE" }
  | { kind: "FOCUS"; targets: SpanRef[] }
  | {
      kind: "RELATE";
      items: SpanRef[];
      relation: "cause" | "sequence" | "contrast" | "equivalence" | "hierarchy";
      reveal: "simultaneous" | "progressive";
    }
  | {
      kind: "TRANSFORM";
      from: SpanRef;
      to: SpanRef;
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

export type FxExample = {
  id: string;
  title: string;
  sourceType: "adapted" | "synthetic";
  subject: string;
  transcript: Transcript;
  teacherLine: string;
  explicitTeachingRelation: string;
  plainCaptionBaseline: string;
  candidateEffectPlan: EffectPlan;
  intendedLearningFunction: string;
  studentWork: string;
  risk: string;
};
