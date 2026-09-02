import { describe, expect, it, vi } from "vitest";
import { forwardPcmWithObservation, PcmHealthAccumulator } from "./pcm-health";

function windowFor(samples: Float32Array) {
  const health = new PcmHealthAccumulator(7, 48_000, 48_000, 1_000);
  health.observe(samples, 0, true);
  return health.finish(1_000)!;
}

describe("PCM health accumulator", () => {
  it("identifies all-zero PCM without retaining PCM chunks", () => {
    const health = new PcmHealthAccumulator(1, 48_000, 48_000, 1_000);
    for (let index = 0; index < 375; index += 1) health.observe(new Float32Array(128), index * 3, true);
    const result = health.finish(1_000)!;
    expect(result).toMatchObject({ classification: "all_zero", sampleCount: 48_000, allZeroRatio: 1, minChunkLength: 128, maxChunkLength: 128 });
    expect(Object.values(health)).not.toContainEqual(expect.any(Float32Array));
  });

  it("identifies non-finite PCM", () => {
    const pcm = new Float32Array([0.2, Number.NaN, Number.POSITIVE_INFINITY, -0.4]);
    const result = windowFor(pcm);
    expect(result).toMatchObject({ classification: "non_finite", nonFiniteSampleCount: 2 });
    expect(result.min).toBeCloseTo(-0.4);
    expect(result.max).toBeCloseTo(0.2);
  });

  it("records healthy non-zero Float32 PCM facts", () => {
    const pcm = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(index / 12) * 0.2);
    const result = windowFor(pcm);
    expect(result.classification).toBe("healthy_signal");
    expect(result.peakAbsolute).toBeGreaterThan(0.19);
    expect(result.rmsDbfs).toBeGreaterThan(-20);
    expect(result.expectedDurationMs).toBe(1_000);
  });

  it("emits a scalar final run summary after bounded windows have been drained", () => {
    const health = new PcmHealthAccumulator(3, 48_000, 48_000, 1_000);
    health.observe(new Float32Array(48_000).fill(0.1), 0, true);
    health.takeDue(1_000);
    expect(health.runSummary(1_000)).toMatchObject({ runId: 3, windowCount: 1, chunkCount: 1, sampleCount: 48_000, expectedDurationMs: 1_000, socketWasOpen: true });
  });

  it("remains bounded for a long synthetic run", () => {
    const health = new PcmHealthAccumulator(1, 48_000, 48_000, 1_000);
    let windows = 0;
    for (let index = 0; index < 225_000; index += 1) {
      health.observe(new Float32Array(128).fill(0.1), index * 2.67, true);
      if (health.takeDue(index * 2.67)) windows += 1;
    }
    expect(windows).toBeGreaterThan(500);
    expect(health.totalSampleCount).toBe(28_800_000);
    expect(Object.values(health).some((value) => Array.isArray(value))).toBe(false);
  });

  it("cannot let measurement failure prevent sending the exact Float32Array", () => {
    const audio = new Float32Array([0.1, -0.1]);
    const sendAudio = vi.fn();
    const outcome = forwardPcmWithObservation(audio, () => { throw new Error("measurement failure"); }, sendAudio);
    expect(outcome).toEqual({ measurementFailed: true, sendAudioThrew: false });
    expect(sendAudio).toHaveBeenCalledWith(audio);
  });
});
