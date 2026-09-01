import { describe, expect, it } from "vitest";
import { applySpeechEvent, createInitialCanonicalSpeechState } from "./canonical-speech";

const words = [{ text: "temperature", startMs: 120, endMs: 510, confidence: 0.98 }];

describe("CueLayer canonical speech policy", () => {
  it("replaces provisional Speechmatics hypotheses instead of appending them", () => {
    const first = applySpeechEvent(createInitialCanonicalSpeechState(), { kind: "provisional", text: "temperature in", words });
    const second = applySpeechEvent(first, { kind: "provisional", text: "temperature increases", words });
    expect(second.committed).toEqual([]);
    expect(second.provisional?.text).toBe("temperature increases");
  });

  it("commits Speechmatics finals exactly once and clears the corresponding provisional surface", () => {
    const partial = applySpeechEvent(createInitialCanonicalSpeechState(), { kind: "provisional", text: "temperature increases", words });
    const final = applySpeechEvent(partial, { kind: "committed", text: "temperature increases", words });
    expect(final).toEqual({ committed: [{ id: "committed-0", text: "temperature increases", words }] });
  });

  it("preserves final order and does not translate code-switched speech", () => {
    const first = applySpeechEvent(createInitialCanonicalSpeechState(), { kind: "committed", text: "Increasing temperature gives particles more kinetic energy.", words });
    const result = applySpeechEvent(first, { kind: "committed", text: "所以这里我们其实是在看 successful collision 的数量。", words });
    expect(result.committed.map((segment) => segment.text)).toEqual([
      "Increasing temperature gives particles more kinetic energy.",
      "所以这里我们其实是在看 successful collision 的数量。",
    ]);
  });
});
