import { makeTranscript, spanFromRange, transcriptText } from "../grammar/span-utils";
import { validateEffectPlan } from "../grammar/validation";
import type { FxExample } from "../grammar/types";

const chemistry = makeTranscript("chemistry-cause", "As nuclear charge increases, the attraction to the outer electron becomes stronger, so atomic radius decreases.");
const maths = makeTranscript("maths-sequence", "First expand the bracket, then collect the x terms, and finally divide by three.");
const grammar = makeTranscript("grammar-contrast", "A defining relative clause gives essential information, but a non-defining relative clause adds extra information.");
const biology = makeTranscript("biology-transform", "When the stomata close, less water vapour leaves the leaf.");
const history = makeTranscript("history-focus", "The source is useful because it was written at the time of the event.");
const physics = makeTranscript("physics-focus", "The resultant force is zero, so the object continues at constant velocity.");
const literature = makeTranscript("literature-none", "Notice that the narrator describes the room before describing the people in it.");
const geography = makeTranscript("geography-none", "The river carries material downstream when it has enough energy to move it.");

export const fxExamples: FxExample[] = [
  {
    id: "literature-normal-caption", title: "Ordinary descriptive setup", sourceType: "adapted", subject: "Literature", transcript: literature, teacherLine: transcriptText(literature), explicitTeachingRelation: "No relation is being emphasised.", plainCaptionBaseline: "Render the teacher's full sentence as ordinary captions.",
    candidateEffectPlan: { operation: { kind: "NONE" }, display: { treatmentId: "plain", intensity: "subtle", startMs: 0, durationMs: 0, holdMs: 0, decay: "remain" } },
    intendedLearningFunction: "Keep routine narration readable without creating false importance.", studentWork: "Decide why the order of description may matter.", risk: "An effect could make an ordinary observation appear like a completed interpretation.",
  },
  {
    id: "geography-normal-caption", title: "Ordinary process statement", sourceType: "synthetic", subject: "Geography", transcript: geography, teacherLine: transcriptText(geography), explicitTeachingRelation: "No relation is being singled out.", plainCaptionBaseline: "Render the teacher's full sentence as ordinary captions.",
    candidateEffectPlan: { operation: { kind: "NONE" }, display: { treatmentId: "plain", intensity: "subtle", startMs: 0, durationMs: 0, holdMs: 0, decay: "remain" } },
    intendedLearningFunction: "Preserve a quiet default for explanatory speech.", studentWork: "Connect this statement to their own prior knowledge of erosion and transport.", risk: "Highlighting a generic process sentence can falsely imply a tested key point.",
  },
  {
    id: "history-source-focus", title: "Focus a source-quality phrase", sourceType: "adapted", subject: "History", transcript: history, teacherLine: transcriptText(history), explicitTeachingRelation: "The teacher explicitly gives a reason for usefulness.", plainCaptionBaseline: "Render the teacher's full sentence as ordinary captions.",
    candidateEffectPlan: { operation: { kind: "FOCUS", targets: [spanFromRange(history, 5, 11)] }, display: { treatmentId: "marker-sweep", intensity: "normal", startMs: 1200, durationMs: 900, holdMs: 1050, decay: "restore-caption" } },
    intendedLearningFunction: "Direct attention to the criterion without paraphrasing it.", studentWork: "Apply the criterion to assess the source's usefulness.", risk: "The emphasis may be mistaken for a complete source evaluation.",
  },
  {
    id: "physics-resultant-focus", title: "Focus a physical condition", sourceType: "synthetic", subject: "Physics", transcript: physics, teacherLine: transcriptText(physics), explicitTeachingRelation: "The teacher explicitly connects zero resultant force and constant velocity.", plainCaptionBaseline: "Render the teacher's full sentence as ordinary captions.",
    candidateEffectPlan: { operation: { kind: "FOCUS", targets: [spanFromRange(physics, 1, 4)] }, display: { treatmentId: "spotlight", intensity: "strong", startMs: 900, durationMs: 850, holdMs: 900, decay: "fade" } },
    intendedLearningFunction: "Make the condition easy to locate while the full sentence remains present.", studentWork: "Explain why the condition does not mean the object must be stationary.", risk: "Strong focus can hide the important qualifying phrase that follows.",
  },
  {
    id: "chemistry-causal-relation", title: "Progressive causal explanation", sourceType: "adapted", subject: "Chemistry", transcript: chemistry, teacherLine: transcriptText(chemistry), explicitTeachingRelation: "nuclear charge increases → attraction becomes stronger → atomic radius decreases", plainCaptionBaseline: "Render the teacher's full sentence as ordinary captions.",
    candidateEffectPlan: { operation: { kind: "RELATE", items: [spanFromRange(chemistry, 1, 4), spanFromRange(chemistry, 6, 12), spanFromRange(chemistry, 13, 16)], relation: "cause", reveal: "progressive" }, display: { treatmentId: "progressive-chain", intensity: "normal", startMs: 1000, durationMs: 1800, holdMs: 1200, decay: "restore-caption" } },
    intendedLearningFunction: "Reduce tracking effort across an explicitly spoken cause chain.", studentWork: "Explain the mechanism in their own words and connect it to electron shells.", risk: "A connector can overstate causality if the spoken explanation is tentative.",
  },
  {
    id: "maths-sequence-relation", title: "Progressive worked-method sequence", sourceType: "synthetic", subject: "Mathematics", transcript: maths, teacherLine: transcriptText(maths), explicitTeachingRelation: "First expand → then collect → finally divide", plainCaptionBaseline: "Render the teacher's full sentence as ordinary captions.",
    candidateEffectPlan: { operation: { kind: "RELATE", items: [spanFromRange(maths, 1, 4), spanFromRange(maths, 5, 10), spanFromRange(maths, 11, 15)], relation: "sequence", reveal: "progressive" }, display: { treatmentId: "aligned-sequence", intensity: "normal", startMs: 800, durationMs: 1600, holdMs: 1000, decay: "remain" } },
    intendedLearningFunction: "Make the stated order easier to follow without supplying the algebra.", studentWork: "Carry out each algebraic step and check the calculation.", risk: "The sequence might be read as a universal method beyond this problem.",
  },
  {
    id: "grammar-contrast-relation", title: "Simultaneous grammar contrast", sourceType: "adapted", subject: "English grammar", transcript: grammar, teacherLine: transcriptText(grammar), explicitTeachingRelation: "defining relative clause ↔ non-defining relative clause contrast", plainCaptionBaseline: "Render the teacher's full sentence as ordinary captions.",
    candidateEffectPlan: { operation: { kind: "RELATE", items: [spanFromRange(grammar, 1, 7), spanFromRange(grammar, 9, 16)], relation: "contrast", reveal: "simultaneous" }, display: { treatmentId: "split-contrast", intensity: "subtle", startMs: 900, durationMs: 1000, holdMs: 1400, decay: "restore-caption" } },
    intendedLearningFunction: "Keep both spoken clause descriptions visually comparable.", studentWork: "Identify clauses in a new sentence and decide whether commas are needed.", risk: "The layout can imply that the two definitions are exhaustive.",
  },
  {
    id: "biology-state-change", title: "State change in a plant process", sourceType: "synthetic", subject: "Biology", transcript: biology, teacherLine: transcriptText(biology), explicitTeachingRelation: "stomata close → less water vapour leaves the leaf", plainCaptionBaseline: "Render the teacher's full sentence as ordinary captions.",
    candidateEffectPlan: { operation: { kind: "TRANSFORM", from: spanFromRange(biology, 2, 4), to: spanFromRange(biology, 5, 11), mode: "state-change" }, display: { treatmentId: "shift-and-reveal", intensity: "normal", startMs: 900, durationMs: 1200, holdMs: 1200, decay: "fade" } },
    intendedLearningFunction: "Make a spoken change and its stated outcome easier to trace in the caption.", studentWork: "Explain how this change helps the plant and what trade-off it creates.", risk: "The visual hand-off may look like a complete causal explanation when it is only one link.",
  },
];

if (import.meta.env.DEV) fxExamples.forEach((example) => validateEffectPlan(example.transcript, example.candidateEffectPlan));
