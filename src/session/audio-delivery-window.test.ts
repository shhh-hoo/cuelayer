import { describe, expect, it } from "vitest";
import { AudioDeliveryMonitor } from "./audio-delivery-window";

describe("AudioAdded delivery monitor", () => {
  it("tracks gaps and duplicates with scalar counters only", () => {
    const monitor = new AudioDeliveryMonitor(4, 0);
    monitor.observe(10);
    monitor.observe(12);
    monitor.observe(12);
    monitor.observe(11);
    expect(monitor.takeWindow(1_000)).toMatchObject({
      runId: 4,
      scope: "window",
      acknowledgedChunkCount: 4,
      firstSeqNo: 10,
      lastSeqNo: 11,
      missingSequenceCount: 1,
      duplicateOrOutOfOrderCount: 2,
    });
    expect(Object.values(monitor).some((value) => Array.isArray(value) || ArrayBuffer.isView(value))).toBe(false);
  });

  it("turns a ten-minute acknowledgement stream into one summary per second", () => {
    const monitor = new AudioDeliveryMonitor(5, 0);
    const summaries = [];
    for (let second = 0; second < 600; second += 1) {
      for (let offset = 0; offset < 375; offset += 1) monitor.observe(second * 375 + offset + 1);
      summaries.push(monitor.takeWindow((second + 1) * 1_000));
    }
    expect(summaries).toHaveLength(600);
    expect(summaries.every((summary) => summary.acknowledgedChunkCount === 375)).toBe(true);
    expect(monitor.runSummary(600_000).acknowledgedChunkCount).toBe(225_000);
  });

  it("emits an empty window so a stalled provider is visible", () => {
    const monitor = new AudioDeliveryMonitor(6, 0);
    expect(monitor.takeWindow(1_000)).toMatchObject({ acknowledgedChunkCount: 0, missingSequenceCount: 0, duplicateOrOutOfOrderCount: 0 });
  });
});
