import { getSpanTokens, spanText, transcriptText } from "./span-utils";
import type { EffectPlan, SpanRef, Transcript } from "./types";

function assertSpan(transcript: Transcript, span: SpanRef, label: string) {
  const tokens = getSpanTokens(transcript, span);
  const indexes = tokens.map((token) => transcript.tokens.findIndex(({ id }) => id === token.id));
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) {
    throw new Error(`${label} must reference contiguous transcript tokens.`);
  }
  if (spanText(transcript, span) !== span.exactText) {
    throw new Error(`${label} exactText does not match its referenced token text.`);
  }
}

export function validateEffectPlan(transcript: Transcript, plan: EffectPlan): void {
  if (!transcript.tokens.length || !transcriptText(transcript)) throw new Error(`Transcript ${transcript.id} must include tokens.`);
  const { operation, display } = plan;
  if (display.startMs < 0 || display.durationMs < 0 || display.holdMs < 0) throw new Error("Display timing values cannot be negative.");
  if (!display.treatmentId.trim()) throw new Error("Display policy needs a treatmentId.");
  if (operation.kind === "FOCUS") {
    if (!operation.targets.length) throw new Error("FOCUS needs at least one target.");
    operation.targets.forEach((span, index) => assertSpan(transcript, span, `FOCUS target ${index + 1}`));
  }
  if (operation.kind === "RELATE") {
    if (operation.items.length < 2) throw new Error("RELATE needs at least two source spans.");
    operation.items.forEach((span, index) => assertSpan(transcript, span, `RELATE item ${index + 1}`));
  }
  if (operation.kind === "TRANSFORM") {
    assertSpan(transcript, operation.from, "TRANSFORM source");
    assertSpan(transcript, operation.to, "TRANSFORM destination");
  }
}
