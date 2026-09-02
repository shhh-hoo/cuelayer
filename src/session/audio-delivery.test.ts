import { describe, expect, it } from "vitest";
import { AudioDeliveryAccumulator } from "./audio-delivery";

describe("AudioAdded delivery aggregation", () => {
  it("reports gaps and duplicates without retaining individual acknowledgements", () => {
    const delivery = new AudioDeliveryAccumulator(4, 1_000);
    delivery.observe(10, 0, 0);
    delivery.observe(12, 10, 128);
    delivery.observe(12, 20, 256);
    delivery.observe(11, 30, 384);
    expect(delivery.finish(1_000, 512)).toMatchObject({ acknowledgedChunkCount: 4, firstSeqNo: 10, lastSeqNo: 11, missingSequenceCount: 1, duplicateOrOutOfOrderCount: 2, pcmSampleCount: 512 });
  });

  it("makes a ten-minute acknowledgement stream a bounded set of summaries", () => {
    const delivery = new AudioDeliveryAccumulator(5, 1_000);
    const summaries = [];
    for (let index = 0; index < 225_000; index += 1) {
      const atMs = index * (1_000 / 375);
      delivery.observe(index + 1, atMs, index * 128);
      const summary = delivery.takeDue(atMs, (index + 1) * 128);
      if (summary) summaries.push(summary);
    }
    const final = delivery.finish(600_000, 28_800_000);
    if (final) summaries.push(final);
    expect(summaries.length).toBeGreaterThanOrEqual(599);
    expect(summaries.length).toBeLessThanOrEqual(600);
    expect(summaries.every((summary) => summary.acknowledgedChunkCount <= 377)).toBe(true);
    expect(Object.values(delivery).some((value) => Array.isArray(value))).toBe(false);
  });

  it("keeps one scalar run total for the stop summary", () => {
    const delivery = new AudioDeliveryAccumulator(6, 1_000);
    delivery.observe(1, 0, 0);
    delivery.observe(3, 10, 128);
    expect(delivery.runSummary(20, 256)).toMatchObject({ runId: 6, acknowledgedChunkCount: 2, firstSeqNo: 1, lastSeqNo: 3, missingSequenceCount: 1, pcmSampleCount: 256 });
  });
});
