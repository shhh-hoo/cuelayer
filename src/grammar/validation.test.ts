import { describe, expect, it } from "vitest";
import { captionSpan, makeTranscript, speechTokenIds } from "./span-utils";
import { validateEffectPlan, validateGroundedCaption } from "./validation";

describe("source-traceable caption validation", () => {
  const transcript = makeTranscript("valid", "Um, nuclear charge increases.");
  const caption = { fragments: [{ id: "subject", text: "Nuclear charge", provenance: [{ kind: "speech" as const, tokenIds: speechTokenIds(transcript, 1, 3) }, { kind: "normalization-rule" as const, ruleId: "filler-removal" as const }], transformation: "cleanup" as const, confidence: 0.99 }, { id: "predicate", text: " increases.", provenance: [{ kind: "speech" as const, tokenIds: speechTokenIds(transcript, 3, 4) }], transformation: "verbatim" as const, confidence: 1 }], suppressed: [{ tokenIds: speechTokenIds(transcript, 0, 1), reason: "filler" as const, preserveAsPedagogicalCue: true }], pedagogicalCues: [] };

  it("accepts source-attributed visible fragments and suppression", () => {
    expect(() => validateGroundedCaption(transcript, caption)).not.toThrow();
    expect(() => validateEffectPlan(caption, { operation: { kind: "FOCUS", targets: [captionSpan("subject", "Nuclear charge")] }, display: { treatmentId: "marker-sweep", intensity: "normal", startMs: 0, durationMs: 200, holdMs: 0, decay: "restore-caption" } })).not.toThrow();
  });

  it("fails loudly for an unsupported caption span", () => {
    expect(() => validateEffectPlan(caption, { operation: { kind: "FOCUS", targets: [{ fragmentId: "subject", startOffset: 0, endOffset: 7, exactText: "summary" }] }, display: { treatmentId: "marker-sweep", intensity: "normal", startMs: 0, durationMs: 200, holdMs: 0, decay: "restore-caption" } })).toThrow("exactText does not match");
  });
});
