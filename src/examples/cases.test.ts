import { describe, expect, it } from "vitest";
import { groundedCaptionText } from "../grammar/span-utils";
import { validateEffectPlan, validateGroundedCaption } from "../grammar/validation";
import { fxExamples } from "./cases";

describe("grounded caption fixtures", () => {
  it("keeps every visible fixture caption source-traceable and plan-valid", () => {
    fxExamples.forEach((example) => {
      expect(groundedCaptionText(example.groundedCaption)).toBe(example.expectedGroundedCaption);
      expect(() => validateGroundedCaption(example.rawTranscript, example.groundedCaption)).not.toThrow();
      expect(() => validateEffectPlan(example.groundedCaption, example.candidateEffectPlan)).not.toThrow();
    });
  });
});
