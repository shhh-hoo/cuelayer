import { describe, expect, it } from "vitest";
import { EmptyTranscriptAccumulator } from "./provider-evidence";

describe("empty provider transcript evidence", () => {
  it("retains a bounded exact-whitespace sample only in a raw evidence summary", () => {
    const evidence = new EmptyTranscriptAccumulator(2, 1_000);
    evidence.observe("AddPartialTranscript", "   ", 0);
    evidence.observe("AddTranscript", "\t", 10);
    expect(evidence.finish(1_000)).toEqual({ runId: 2, windowStartedAtMs: 0, windowEndedAtMs: 1_000, partialCount: 1, finalCount: 1, rawWhitespaceSamples: ["   ", "\t"] });
  });
});
