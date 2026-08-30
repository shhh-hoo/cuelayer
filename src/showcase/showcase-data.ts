import type { CaptionClip, CueTarget, EffectCue, TimedWord } from "../types";

export type ShowcaseMoment = { startMs: number; durationMs: number; clip: CaptionClip };

function clip(id: string, captionText: string, cue?: EffectCue): CaptionClip {
  const words: TimedWord[] = (captionText.match(/\S+/g) ?? []).map((text, index) => ({ id: `${id}-${index}`, text, startMs: index * 240, endMs: (index + 1) * 240 }));
  return { id, captionText, words, cues: cue ? [cue] : [] };
}

const cueWords = (id: string, captionText: string, start: number, end: number) => {
  const words = (captionText.match(/\S+/g) ?? []).map((text, index) => ({ id: `${id}-${index}`, text }));
  return words.slice(start, end).map(({ id: wordId }) => wordId);
};
const target = (id: string, captionText: string, start: number, end: number, keepTogether = true): CueTarget => ({ id, wordIds: cueWords(id, captionText, start, end), keepTogether });

const markerText = "The temperature gives particles more kinetic energy.";
const causeText = "More kinetic energy means more successful collisions, so the reaction rate increases.";
const contrastText = "A catalyst changes the pathway, but it does not change the overall energy change.";
const sequenceText = "First expand the brackets, then collect the x terms, and finally divide by three.";
const transformText = "The reactants become products as old bonds break and new bonds form.";
const spotlightText = "The activation energy is the minimum energy needed for a successful collision.";

export const showcaseMoments: ShowcaseMoment[] = [
  { startMs: 0, durationMs: 4000, clip: clip("showcase-0", "In this reaction, particles must collide before anything can change.") },
  { startMs: 4000, durationMs: 4000, clip: clip("showcase-focus-marker", markerText, { kind: "FOCUS", target: target("temperature", markerText, 1, 2), treatment: "marker", intensity: "normal", startMs: 1400, durationMs: 750, holdMs: 950 }) },
  { startMs: 8000, durationMs: 4000, clip: clip("showcase-2", "At the same time, the particles are still moving in many different directions.") },
  { startMs: 12000, durationMs: 4000, clip: clip("showcase-relate-cause", causeText, { kind: "RELATE", targets: [target("kinetic-energy", causeText, 0, 3), target("collisions", causeText, 4, 7), target("reaction-rate", causeText, 9, 12)], relation: "cause", treatment: "chain", intensity: "normal", startMs: 900, durationMs: 1700, holdMs: 900 }) },
  { startMs: 16000, durationMs: 4000, clip: clip("showcase-4", "That is why heating a reaction mixture often makes the reaction happen faster.") },
  { startMs: 20000, durationMs: 4000, clip: clip("showcase-5", contrastText) },
  { startMs: 24000, durationMs: 4000, clip: clip("showcase-sequence", sequenceText, { kind: "RELATE", targets: [target("expand", sequenceText, 1, 4), target("collect", sequenceText, 5, 9), target("divide", sequenceText, 11, 14)], relation: "sequence", treatment: "ordered-steps", intensity: "normal", startMs: 700, durationMs: 1800, holdMs: 900 }) },
  { startMs: 28000, durationMs: 4000, clip: clip("showcase-transform", transformText, { kind: "TRANSFORM", from: target("reactants", transformText, 1, 2), to: target("products", transformText, 3, 4), treatment: "derive", intensity: "normal", startMs: 1000, durationMs: 1100, holdMs: 900 }) },
  { startMs: 32000, durationMs: 4000, clip: clip("showcase-8", "The total energy is conserved even though the arrangement of atoms changes.") },
  { startMs: 36000, durationMs: 4000, clip: clip("showcase-focus-spotlight", spotlightText, { kind: "FOCUS", target: target("minimum-energy", spotlightText, 3, 5), treatment: "spotlight", intensity: "normal", startMs: 1100, durationMs: 800, holdMs: 900 }) },
];

export const showcaseDurationMs = 40000;
