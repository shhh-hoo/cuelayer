import { describe, expect, it } from "vitest";
import { captionSegments, captionTextForMode } from "./caption-segments";
import type { CaptionClip } from "../types";

describe("caption rendering input", () => {
  it("uses identical authored text in Plain and FX", () => {
    const clip: CaptionClip = { id: "same-text", captionText: "Nuclear charge increases.", words: [{ id: "w1", text: "Nuclear", startMs: 0, endMs: 1 }, { id: "w2", text: "charge", startMs: 1, endMs: 2 }, { id: "w3", text: "increases.", startMs: 2, endMs: 3 }], cues: [] };
    expect(captionTextForMode(clip, "plain")).toBe(captionTextForMode(clip, "fx"));
  });

  it.each([
    ["English spacing", "Nuclear charge increases.", ["Nuclear", "charge", "increases."]],
    ["punctuation attachment", "Charge increases.", ["Charge", "increases", "."]],
    ["Chinese", "核电荷增加。", ["核电荷", "增加", "。"]],
    ["mixed terminology", "核电荷 nuclear charge", ["核电荷", "nuclear", "charge"]],
  ])("preserves %s exactly", (_, captionText, texts) => {
    const clip: CaptionClip = { id: "spacing", captionText, words: texts.map((text, index) => ({ id: `w${index}`, text, startMs: index, endMs: index + 1 })), cues: [] };
    expect(captionSegments(clip).map((segment) => segment.text).join("")).toBe(captionText);
  });
});
