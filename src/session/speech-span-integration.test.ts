import { describe, expect, it } from "vitest";
import { compileCaptionEpisode } from "../planner/caption-compiler";
import type { PlannerInput, RuntimeDecision } from "../planner/contracts";
import { validateRuntimeDecision } from "../planner/validation";
import { applySpeechEvent, createInitialCanonicalSpeechState } from "./canonical-speech";

function assemble(parts: string[]): PlannerInput {
  let state = createInitialCanonicalSpeechState();
  let clock = 0;
  parts.forEach((text) => {
    const tokens = text.match(/[\p{L}\p{N}]+/gu) ?? [text];
    const words = tokens.map((token) => {
      const word = { text: token, startMs: clock, endMs: clock + 80 };
      clock += 100;
      return word;
    });
    state = applySpeechEvent(state, { kind: "committed", text, words }, clock).state;
  });
  return { recentSpeech: state.spans };
}

describe("provider segmentation invariance through compilation", () => {
  it.each([
    ["The reaction mixture remains colourless"],
    ["The reaction", "mixture remains", "colourless"],
    ["The", "reaction mixture", "remains", "colourless"],
  ])("produces equivalent planner-readable speech, grounding, and display for %j", (...parts) => {
    const input = assemble(parts);
    const decision: RuntimeDecision = { display: { kind: "FOCUS", target: { segmentId: "speech-span-0", text: "colourless" } }, learner: { kind: "NONE" } };
    const validation = validateRuntimeDecision(decision, input);
    expect(input.recentSpeech.map((span) => span.text)).toEqual(["The reaction mixture remains colourless"]);
    expect(validation).toMatchObject({ ok: true, decision: { display: { kind: "FOCUS" } } });
    expect(validation.ok && compileCaptionEpisode(input, validation.decision, "segmentation-invariant", 0)?.clip.captionText).toBe("The reaction mixture remains colourless");
  });
});
