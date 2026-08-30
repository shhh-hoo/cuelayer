import type { CaptionClip, EffectCue, TimedWord } from "../types";

export type FxFixture = { id: string; title: string; subject: string; clip: CaptionClip; learningFunction: string; risk: string };

function timedWords(captionText: string): TimedWord[] {
  return (captionText.match(/\S+/g) ?? []).map((text, index) => ({ id: `w${index + 1}`, text, startMs: index * 260, endMs: (index + 1) * 260 }));
}

function wordIds(words: TimedWord[], start: number, end: number) { return words.slice(start, end).map(({ id }) => id); }

function fixture(id: string, title: string, subject: string, captionText: string, makeCues: (words: TimedWord[]) => EffectCue[], learningFunction: string, risk: string): FxFixture {
  const words = timedWords(captionText);
  return { id, title, subject, clip: { id, captionText, words, cues: makeCues(words) }, learningFunction, risk };
}

export const fxExamples: FxFixture[] = [
  fixture("literature-normal", "Ordinary descriptive setup", "Literature", "Notice that the narrator describes the room before describing the people in it.", () => [], "Keep routine narration visually quiet.", "An effect could make an ordinary observation look conclusive."),
  fixture("geography-normal", "Ordinary process statement", "Geography", "The river carries material downstream when it has enough energy to move it.", () => [], "Preserve normal caption reading for explanatory speech.", "A generic sentence can be made to look more important than it is."),
  fixture("history-focus", "Focus a source-quality phrase", "History", "The source is useful because it was written at the time of the event.", (words) => [{ kind: "FOCUS", targetWordIds: wordIds(words, 5, 11), treatment: "marker", intensity: "normal", startMs: 900, durationMs: 900, holdMs: 900 }], "Direct attention to an explicitly spoken criterion.", "Focus must not become a complete source evaluation."),
  fixture("physics-focus", "Focus a physical condition", "Physics", "The resultant force is zero, so the object continues at constant velocity.", (words) => [{ kind: "FOCUS", targetWordIds: wordIds(words, 1, 4), treatment: "spotlight", intensity: "strong", startMs: 900, durationMs: 850, holdMs: 900 }], "Make the condition easy to locate within the full sentence.", "Strong focus can hide the qualifying statement."),
  fixture("chemistry-cause", "Progressive causal explanation", "Chemistry", "As nuclear charge increases, the attraction to the outer electron becomes stronger, so atomic radius decreases.", (words) => [{ kind: "RELATE", targetGroups: [wordIds(words, 1, 4), wordIds(words, 5, 12), wordIds(words, 12, 16)], relation: "cause", treatment: "chain", intensity: "normal", startMs: 1000, durationMs: 1800, holdMs: 1200 }], "Reduce tracking effort across a stated cause chain.", "The treatment must not exaggerate uncertain causality."),
  fixture("maths-sequence", "Progressive worked-method sequence", "Mathematics", "First expand the bracket, then collect the x terms, and finally divide by three.", (words) => [{ kind: "RELATE", targetGroups: [wordIds(words, 0, 4), wordIds(words, 4, 9), wordIds(words, 9, 13)], relation: "sequence", treatment: "ordered-steps", intensity: "normal", startMs: 800, durationMs: 1600, holdMs: 1000 }], "Make the teacher's stated order easier to follow.", "The order could be mistaken for a universal method."),
  fixture("grammar-contrast", "Simultaneous grammar contrast", "English grammar", "A defining relative clause gives essential information, but a non-defining relative clause adds extra information.", (words) => [{ kind: "RELATE", targetGroups: [wordIds(words, 1, 7), wordIds(words, 8, 15)], relation: "contrast", treatment: "split-contrast", intensity: "subtle", startMs: 900, durationMs: 1000, holdMs: 1400 }], "Keep two stated descriptions visually comparable.", "The layout must not imply the definitions are exhaustive."),
  fixture("biology-cause", "Stomata closure causes less water loss", "Biology", "When the stomata close, less water vapour leaves the leaf.", (words) => [{ kind: "RELATE", targetGroups: [wordIds(words, 1, 4), wordIds(words, 4, 10)], relation: "cause", treatment: "chain", intensity: "normal", startMs: 900, durationMs: 1200, holdMs: 1200 }], "Make the stated cause and outcome easier to track.", "The treatment must not imply a cause beyond the spoken relationship."),
  fixture("chemistry-transform", "Same-object state transformation", "Chemistry", "During melting, solid iodine becomes liquid iodine.", (words) => [{ kind: "TRANSFORM", fromWordIds: wordIds(words, 2, 4), toWordIds: wordIds(words, 5, 7), treatment: "state-change", intensity: "normal", startMs: 900, durationMs: 1200, holdMs: 1200 }], "Show the same material changing state within the caption.", "The effect must preserve the surrounding caption context."),
];
