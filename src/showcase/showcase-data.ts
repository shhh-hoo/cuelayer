import type { CaptionClip, EffectCue, TimedWord } from "../types";

export type ShowcaseMoment = { startMs: number; durationMs: number; clip: CaptionClip };

function clip(id: string, captionText: string, cue?: EffectCue): CaptionClip {
  const words: TimedWord[] = (captionText.match(/\S+/g) ?? []).map((text, index) => ({ id: `${id}-${index}`, text, startMs: index * 240, endMs: (index + 1) * 240 }));
  return { id, captionText, words, cues: cue ? [cue] : [] };
}

const cueWords = (id: string, captionText: string, start: number, end: number) => {
  const words = (captionText.match(/\S+/g) ?? []).map((text, index) => ({ id: `${id}-${index}`, text }));
  return words.slice(start, end).map(({ id: wordId }) => wordId);
};

const markerText = "The temperature gives particles more kinetic energy.";
const causeText = "More kinetic energy means more successful collisions, so the reaction rate increases.";
const contrastText = "A catalyst changes the pathway, but it does not change the overall energy change.";
const transformText = "The reactants become products as old bonds break and new bonds form.";
const spotlightText = "The activation energy is the minimum energy needed for a successful collision.";

export const showcaseMoments: ShowcaseMoment[] = [
  { startMs: 0, durationMs: 4000, clip: clip("showcase-0", "In this reaction, particles must collide before anything can change.") },
  { startMs: 4000, durationMs: 4000, clip: clip("showcase-focus-marker", markerText, { kind: "FOCUS", targetWordIds: cueWords("showcase-focus-marker", markerText, 1, 2), treatment: "marker", intensity: "normal", startMs: 1400, durationMs: 750, holdMs: 950 }) },
  { startMs: 8000, durationMs: 4000, clip: clip("showcase-2", "At the same time, the particles are still moving in many different directions.") },
  { startMs: 12000, durationMs: 4000, clip: clip("showcase-relate-cause", causeText, { kind: "RELATE", targetGroups: [cueWords("showcase-relate-cause", causeText, 1, 4), cueWords("showcase-relate-cause", causeText, 4, 7), cueWords("showcase-relate-cause", causeText, 8, 12)], relation: "cause", treatment: "chain", intensity: "normal", startMs: 900, durationMs: 1700, holdMs: 900 }) },
  { startMs: 16000, durationMs: 4000, clip: clip("showcase-4", "That is why heating a reaction mixture often makes the reaction happen faster.") },
  { startMs: 20000, durationMs: 4000, clip: clip("showcase-relate-contrast", contrastText, { kind: "RELATE", targetGroups: [cueWords("showcase-relate-contrast", contrastText, 1, 4), cueWords("showcase-relate-contrast", contrastText, 6, 12)], relation: "contrast", treatment: "split-contrast", intensity: "subtle", startMs: 1100, durationMs: 900, holdMs: 900 }) },
  { startMs: 24000, durationMs: 4000, clip: clip("showcase-6", "It simply gives the reacting particles another route through the same reaction.") },
  { startMs: 28000, durationMs: 4000, clip: clip("showcase-transform", transformText, { kind: "TRANSFORM", fromWordIds: cueWords("showcase-transform", transformText, 1, 2), toWordIds: cueWords("showcase-transform", transformText, 4, 11), treatment: "derive", intensity: "normal", startMs: 1000, durationMs: 1100, holdMs: 900 }) },
  { startMs: 32000, durationMs: 4000, clip: clip("showcase-8", "The total energy is conserved even though the arrangement of atoms changes.") },
  { startMs: 36000, durationMs: 4000, clip: clip("showcase-focus-spotlight", spotlightText, { kind: "FOCUS", targetWordIds: cueWords("showcase-focus-spotlight", spotlightText, 3, 6), treatment: "spotlight", intensity: "normal", startMs: 1100, durationMs: 800, holdMs: 900 }) },
];

export const showcaseDurationMs = 40000;
