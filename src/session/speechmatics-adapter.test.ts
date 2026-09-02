import { describe, expect, it } from "vitest";
import { speechEventFromSpeechmatics } from "./speechmatics-adapter";

describe("Speechmatics adapter", () => {
  it("translates a final result and normalizes word times from seconds to milliseconds", () => {
    const event = speechEventFromSpeechmatics({
      message: "AddTranscript",
      metadata: { transcript: "activation energy", start_time: 0.12, end_time: 1.4 },
      results: [
        { type: "word", start_time: 0.12, end_time: 0.66, alternatives: [{ content: "activation", confidence: 0.98 }] },
        { type: "word", start_time: 0.7, end_time: 1.4, alternatives: [{ content: "energy", confidence: 0.97 }] },
      ],
    } as never);
    expect(event).toEqual({
      kind: "committed",
      text: "activation energy",
      provider: { message: "AddTranscript", format: undefined, channel: undefined, resultCount: 2, startMs: 120, endMs: 1400 },
      words: [
        { text: "activation", startMs: 120, endMs: 660, confidence: 0.98 },
        { text: "energy", startMs: 700, endMs: 1400, confidence: 0.97 },
      ],
    });
  });

  it("keeps Speechmatics partials provider-shaped until the product boundary", () => {
    const event = speechEventFromSpeechmatics({ message: "AddPartialTranscript", metadata: { transcript: "所以这里是 rate determining", start_time: 0, end_time: 1 }, results: [] } as never);
    expect(event).toMatchObject({ kind: "provisional", text: "所以这里是 rate determining" });
  });

  it("keeps lexical text product-safe while whitespace-only evidence has no product event", () => {
    const event = speechEventFromSpeechmatics({ message: "AddPartialTranscript", metadata: { transcript: "  noise fragment  " }, results: [] } as never);
    expect(event).toMatchObject({ kind: "provisional", text: "noise fragment", provider: { message: "AddPartialTranscript", resultCount: 0 } });
    expect(speechEventFromSpeechmatics({ message: "AddTranscript", metadata: { transcript: "   " }, results: [] } as never)).toBeUndefined();
  });

  it("types punctuation-only results separately from lexical finals", () => {
    const event = speechEventFromSpeechmatics({ message: "AddTranscript", metadata: { transcript: "." }, results: [{ type: "punctuation", start_time: 1, end_time: 1, alternatives: [{ content: ".", confidence: 0.99 }] }] } as never);
    expect(event).toMatchObject({ kind: "punctuation", text: ".", attachesTo: "previous", isEos: true });
    expect(speechEventFromSpeechmatics({ message: "AddTranscript", metadata: { transcript: "." }, results: [] } as never)).toMatchObject({ kind: "punctuation" });
  });
});
