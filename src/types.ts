export type TimedWord = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
};

type CueTiming = {
  startMs: number;
  durationMs: number;
  holdMs: number;
  intensity: "subtle" | "normal" | "strong";
};

export type EffectCue =
  | (CueTiming & { kind: "FOCUS"; targetWordIds: string[]; treatment: "marker" | "spotlight" | "scale" | "dim-surrounding" })
  | (CueTiming & { kind: "RELATE"; targetGroups: string[][]; relation: "cause" | "sequence" | "contrast"; treatment: "chain" | "ordered-steps" | "split-contrast" })
  | (CueTiming & { kind: "TRANSFORM"; fromWordIds: string[]; toWordIds: string[]; treatment: "replace" | "derive" | "state-change" });

export type CaptionClip = {
  id: string;
  captionText: string;
  words: TimedWord[];
  cues: EffectCue[];
};
