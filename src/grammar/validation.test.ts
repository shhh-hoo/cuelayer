import { describe, expect, it } from "vitest";
import { makeTranscript, spanFromRange } from "./span-utils";
import { validateEffectPlan } from "./validation";

describe("source-grounded span validation", () => {
  it("accepts an exact text match for referenced tokens", () => {
    const transcript = makeTranscript("valid", "The teacher said this exactly.");
    expect(() => validateEffectPlan(transcript, { operation: { kind: "FOCUS", targets: [spanFromRange(transcript, 1, 3)] }, display: { treatmentId: "marker-sweep", intensity: "normal", startMs: 0, durationMs: 200, holdMs: 0, decay: "restore-caption" } })).not.toThrow();
  });

  it("fails loudly when exact text is not grounded in the token references", () => {
    const transcript = makeTranscript("invalid", "The teacher said this exactly.");
    expect(() => validateEffectPlan(transcript, { operation: { kind: "FOCUS", targets: [{ ...spanFromRange(transcript, 1, 3), exactText: "a rewritten summary" }] }, display: { treatmentId: "marker-sweep", intensity: "normal", startMs: 0, durationMs: 200, holdMs: 0, decay: "restore-caption" } })).toThrow("exactText does not match");
  });
});
