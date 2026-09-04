import { describe, expect, it } from "vitest";
import { applySpeechEvent, closeCanonicalSpeechSpan, createInitialCanonicalSpeechState, joinTranscript, SPEECH_SPAN_ASSEMBLY } from "./canonical-speech";
import type { CanonicalSpeechState, SpeechWord } from "./speech-types";

function words(text: string, startMs: number, endMs: number): SpeechWord[] {
  return [{ text, startMs, endMs, confidence: 0.98 }];
}

function commit(state: CanonicalSpeechState, text: string, startMs: number, endMs: number) {
  return applySpeechEvent(state, { kind: "committed", text, words: words(text, startMs, endMs) }, endMs).state;
}

function assemble(parts: string[]) {
  return parts.reduce((state, text, index) => commit(state, text, index * 300, index * 300 + 250), createInitialCanonicalSpeechState());
}

describe("CueLayer canonical speech assembly", () => {
  it("replaces provisional hypotheses without creating provenance or spans", () => {
    const first = applySpeechEvent(createInitialCanonicalSpeechState(), { kind: "provisional", text: "temperature in", words: words("temperature", 120, 510) }).state;
    const second = applySpeechEvent(first, { kind: "provisional", text: "temperature increases", words: words("temperature", 120, 510) }).state;
    expect(second.finals).toEqual([]);
    expect(second.spans).toEqual([]);
    expect(second.provisional?.text).toBe("temperature increases");
  });

  it("preserves fragmented Chinese finals as provenance while assembling one readable span", () => {
    const state = assemble(["你", "要", "出门啦"]);
    expect(state.finals.map((item) => item.text)).toEqual(["你", "要", "出门啦"]);
    expect(state.spans).toHaveLength(1);
    expect(state.spans[0]).toMatchObject({ revision: 3, sourceFinalIds: ["provider-final-0", "provider-final-1", "provider-final-2"], text: "你要出门啦", status: "open" });
  });

  it("assembles fragmented English finals with readable spacing", () => {
    const state = assemble(["The reaction", "mixture remains", "colourless"]);
    expect(state.finals).toHaveLength(3);
    expect(state.spans.map((span) => span.text)).toEqual(["The reaction mixture remains colourless"]);
  });

  it("is invariant to equivalent provider-final segmentation", () => {
    const variants = [
      ["The reaction mixture remains colourless"],
      ["The reaction", "mixture remains", "colourless"],
      ["The", "reaction mixture", "remains", "colourless"],
    ].map((parts) => assemble(parts).spans[0]!.text);
    expect(new Set(variants)).toEqual(new Set(["The reaction mixture remains colourless"]));
  });

  it("does not insert spaces before punctuation", () => {
    expect(joinTranscript("The reaction", ", which is fast")).toBe("The reaction, which is fast");
    expect(joinTranscript("反应", "。然后继续")).toBe("反应。然后继续");
  });

  it("closes on a meaningful pause after continuous speech", () => {
    const initial = commit(createInitialCanonicalSpeechState(), "continuous explanation", 0, 2_520);
    const closed = closeCanonicalSpeechSpan(initial, "speech-span-0", 1, "meaningful_pause", 4_000);
    expect(closed.state.spans[0]).toMatchObject({ status: "closed", revision: 2, closeReason: "meaningful_pause" });
  });

  it("closes and starts a new span when a hard word limit would be exceeded", () => {
    const long = Array.from({ length: SPEECH_SPAN_ASSEMBLY.maxWords }, (_, index) => `word${index}`).join(" ");
    const first = commit(createInitialCanonicalSpeechState(), long, 0, 2_000);
    const second = commit(first, "next", 2_050, 2_250);
    expect(second.spans).toHaveLength(2);
    expect(second.spans[0]).toMatchObject({ status: "closed", closeReason: "max_words" });
    expect(second.spans[1]).toMatchObject({ text: "next", status: "open" });
  });

  it.each([
    { reason: "timing_gap", firstText: "earlier", firstEnd: 200, nextStart: 1_200 },
    { reason: "max_duration", firstText: "earlier", firstEnd: 6_000, nextStart: 6_400 },
    { reason: "max_words", firstText: Array.from({ length: SPEECH_SPAN_ASSEMBLY.maxWords }, (_, index) => `word${index}`).join(" "), firstEnd: 2_000, nextStart: 2_050 },
  ] as const)("does not attribute the trigger final to a span closed by $reason", ({ reason, firstText, firstEnd, nextStart }) => {
    const first = commit(createInitialCanonicalSpeechState(), firstText, 0, firstEnd);
    const update = applySpeechEvent(first, { kind: "committed", text: "trigger", words: words("trigger", nextStart, nextStart + 150) }, nextStart + 150);
    const closure = update.changes[0]!;
    expect(closure).toMatchObject({ decision: "closed", closeReason: reason, spanId: "speech-span-0" });
    expect("finalId" in closure).toBe(false);
    expect(update.state.spans[0]!.sourceFinalIds).toEqual(["provider-final-0"]);
    expect(update.state.spans[1]!.sourceFinalIds).toEqual(["provider-final-1"]);
  });
});
