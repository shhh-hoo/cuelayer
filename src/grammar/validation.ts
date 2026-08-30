import { getSpanTokens, groundedCaptionText, transcriptText } from "./span-utils";
import type { CaptionSpanRef, EffectPlan, GroundedCaption, SourceRef, Transcript } from "./types";

function assertSpeechSource(transcript: Transcript, source: Extract<SourceRef, { kind: "speech" }>, label: string) {
  const tokens = getSpanTokens(transcript, source.tokenIds);
  const indexes = tokens.map((token) => transcript.tokens.findIndex(({ id }) => id === token.id));
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) throw new Error(`${label} must reference contiguous speech tokens.`);
}

function assertCaptionSpan(caption: GroundedCaption, span: CaptionSpanRef, label: string) {
  const fragment = caption.fragments.find(({ id }) => id === span.fragmentId);
  if (!fragment) throw new Error(`${label} references unknown caption fragment ${span.fragmentId}.`);
  if (span.startOffset < 0 || span.endOffset > fragment.text.length || span.startOffset >= span.endOffset) throw new Error(`${label} has invalid caption offsets.`);
  if (fragment.text.slice(span.startOffset, span.endOffset) !== span.exactText) throw new Error(`${label} exactText does not match the grounded caption fragment.`);
}

export function validateGroundedCaption(transcript: Transcript, caption: GroundedCaption): void {
  if (!transcript.tokens.length || !transcriptText(transcript)) throw new Error(`Transcript ${transcript.id} must include tokens.`);
  if (!caption.fragments.length || !groundedCaptionText(caption)) throw new Error("Grounded caption must contain visible fragments.");
  const seenFragments = new Set<string>();
  caption.fragments.forEach((fragment) => {
    if (seenFragments.has(fragment.id)) throw new Error(`Caption fragment ${fragment.id} is duplicated.`);
    seenFragments.add(fragment.id);
    if (!fragment.text || fragment.confidence < 0 || fragment.confidence > 1 || !fragment.provenance.length) throw new Error(`Caption fragment ${fragment.id} needs text, provenance, and confidence.`);
    fragment.provenance.forEach((source) => {
      if (source.kind === "speech") assertSpeechSource(transcript, source, `Fragment ${fragment.id}`);
      if (source.kind === "lesson-source" && !source.exactText.trim()) throw new Error(`Lesson source for ${fragment.id} needs exact text.`);
    });
    const hasSpeech = fragment.provenance.some((source) => source.kind === "speech");
    const hasLessonSource = fragment.provenance.some((source) => source.kind === "lesson-source");
    const hasNormalization = fragment.provenance.some((source) => source.kind === "normalization-rule");
    if (fragment.transformation === "verbatim" && !hasSpeech) throw new Error(`Verbatim fragment ${fragment.id} needs a speech source.`);
    if (fragment.transformation === "cleanup" && !hasNormalization) throw new Error(`Cleanup fragment ${fragment.id} needs a normalization rule.`);
    if ((fragment.transformation === "term-correction" || fragment.transformation === "referent-resolution" || fragment.transformation === "canonicalization") && !hasLessonSource) throw new Error(`Source-backed fragment ${fragment.id} needs a lesson source.`);
  });
  const suppressed = new Set<string>();
  caption.suppressed.forEach((entry) => entry.tokenIds.forEach((id) => {
    if (suppressed.has(id)) throw new Error(`Speech token ${id} is suppressed more than once.`);
    suppressed.add(id);
    getSpanTokens(transcript, [id]);
  }));
  caption.pedagogicalCues.forEach((cue, index) => cue.source.forEach((source) => {
    if (source.kind === "speech") assertSpeechSource(transcript, source, `Pedagogical cue ${index + 1}`);
  }));
}

export function validateEffectPlan(caption: GroundedCaption, plan: EffectPlan): void {
  const { operation, display } = plan;
  if (display.startMs < 0 || display.durationMs < 0 || display.holdMs < 0) throw new Error("Display timing values cannot be negative.");
  if (!display.treatmentId.trim()) throw new Error("Display policy needs a treatmentId.");
  if (operation.kind === "FOCUS") {
    if (!operation.targets.length) throw new Error("FOCUS needs at least one target.");
    operation.targets.forEach((span, index) => assertCaptionSpan(caption, span, `FOCUS target ${index + 1}`));
  }
  if (operation.kind === "RELATE") {
    if (operation.items.length < 2) throw new Error("RELATE needs at least two grounded caption spans.");
    operation.items.forEach((span, index) => assertCaptionSpan(caption, span, `RELATE item ${index + 1}`));
  }
  if (operation.kind === "TRANSFORM") {
    assertCaptionSpan(caption, operation.from, "TRANSFORM source");
    assertCaptionSpan(caption, operation.to, "TRANSFORM destination");
  }
}
