export type TimedWord = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type CueTarget = {
  id: string;
  wordIds: string[];
  displayText?: string;
  keepTogether?: boolean;
};

type CueTiming = {
  startMs: number;
  durationMs: number;
  holdMs: number;
  intensity: "subtle" | "normal" | "strong";
};

export type EffectCue =
  | (CueTiming & { kind: "FOCUS"; target: CueTarget; treatment: "marker" | "spotlight" | "scale" | "dim-surrounding" })
  | (CueTiming & { kind: "RELATE"; targets: CueTarget[]; relation: "cause" | "sequence" | "contrast"; treatment: "chain" | "ordered-steps" | "split-contrast" })
  | (CueTiming & { kind: "TRANSFORM"; from: CueTarget; to: CueTarget; treatment: "replace" | "derive" | "state-change" });

export type CaptionClip = {
  id: string;
  captionText: string;
  words: TimedWord[];
  cues: EffectCue[];
};
