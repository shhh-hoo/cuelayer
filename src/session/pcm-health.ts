export type PcmHealthClassification = "healthy_signal" | "near_silence" | "all_zero" | "clipped" | "non_finite" | "timing_mismatch" | "no_samples";

export type PcmHealthWindow = {
  runId: number;
  windowStartedAtMs: number;
  windowEndedAtMs: number;
  chunkCount: number;
  sampleCount: number;
  min: number;
  max: number;
  peakAbsolute: number;
  rms: number;
  rmsDbfs: number;
  mean: number;
  dcOffset: number;
  allZeroSampleCount: number;
  allZeroRatio: number;
  nearZeroSampleCount: number;
  nearZeroRatio: number;
  nonFiniteSampleCount: number;
  clippingSampleCount: number;
  minChunkLength: number;
  maxChunkLength: number;
  typicalChunkLength: number;
  expectedDurationMs: number;
  wallClockDurationMs: number;
  durationDriftMs: number;
  durationDriftRatio: number;
  configuredSampleRate: number;
  audioContextSampleRate: number;
  sendAudioThrew: boolean;
  sendAudioThrowCount: number;
  socketOpen: boolean;
  classification: PcmHealthClassification;
};

export type PcmHealthRunSummary = {
  runId: number;
  runStartedAtMs: number;
  runEndedAtMs: number;
  windowCount: number;
  chunkCount: number;
  sampleCount: number;
  expectedDurationMs: number;
  wallClockDurationMs: number;
  configuredSampleRate: number;
  audioContextSampleRate: number;
  sendAudioThrowCount: number;
  socketWasOpen: boolean;
};

type AccumulatedWindow = {
  startedAtMs: number;
  endedAtMs: number;
  chunkCount: number;
  sampleCount: number;
  finiteSampleCount: number;
  sum: number;
  sumSquares: number;
  min: number;
  max: number;
  peakAbsolute: number;
  allZeroSampleCount: number;
  nearZeroSampleCount: number;
  nonFiniteSampleCount: number;
  clippingSampleCount: number;
  minChunkLength: number;
  maxChunkLength: number;
  sendAudioThrowCount: number;
  socketOpen: boolean;
};

const NEAR_ZERO_AMPLITUDE = 0.0001;
const CLIPPING_AMPLITUDE = 0.999;
const SILENCE_DBFS = -55;
const RMS_DBFS_FLOOR = -160;

function newWindow(atMs: number): AccumulatedWindow {
  return {
    startedAtMs: atMs,
    endedAtMs: atMs,
    chunkCount: 0,
    sampleCount: 0,
    finiteSampleCount: 0,
    sum: 0,
    sumSquares: 0,
    min: Infinity,
    max: -Infinity,
    peakAbsolute: 0,
    allZeroSampleCount: 0,
    nearZeroSampleCount: 0,
    nonFiniteSampleCount: 0,
    clippingSampleCount: 0,
    minChunkLength: Infinity,
    maxChunkLength: 0,
    sendAudioThrowCount: 0,
    socketOpen: false,
  };
}

/**
 * Incremental health measurements for the exact Float32Array handed to
 * Speechmatics. It intentionally retains only scalar counters, never PCM.
 */
export class PcmHealthAccumulator {
  private current?: AccumulatedWindow;
  private _totalSampleCount = 0;
  private runStartedAtMs?: number;
  private runChunkCount = 0;
  private emittedWindowCount = 0;
  private runSendAudioThrowCount = 0;
  private socketWasOpen = false;

  constructor(
    readonly runId: number,
    readonly configuredSampleRate: number,
    readonly audioContextSampleRate: number,
    private readonly windowMs = 1_000,
  ) {}

  get totalSampleCount() { return this._totalSampleCount; }

  observe(audio: Float32Array, atMs: number, socketOpen: boolean): void {
    const window = this.current ??= newWindow(atMs);
    this.runStartedAtMs ??= atMs;
    this.runChunkCount += 1;
    this.socketWasOpen ||= socketOpen;
    window.endedAtMs = atMs;
    window.socketOpen ||= socketOpen;
    window.chunkCount += 1;
    window.sampleCount += audio.length;
    window.minChunkLength = Math.min(window.minChunkLength, audio.length);
    window.maxChunkLength = Math.max(window.maxChunkLength, audio.length);
    this._totalSampleCount += audio.length;

    for (let index = 0; index < audio.length; index += 1) {
      const sample = audio[index]!;
      if (!Number.isFinite(sample)) {
        window.nonFiniteSampleCount += 1;
        continue;
      }
      const absolute = Math.abs(sample);
      window.finiteSampleCount += 1;
      window.sum += sample;
      window.sumSquares += sample * sample;
      window.min = Math.min(window.min, sample);
      window.max = Math.max(window.max, sample);
      window.peakAbsolute = Math.max(window.peakAbsolute, absolute);
      if (sample === 0) window.allZeroSampleCount += 1;
      if (absolute <= NEAR_ZERO_AMPLITUDE) window.nearZeroSampleCount += 1;
      if (absolute >= CLIPPING_AMPLITUDE) window.clippingSampleCount += 1;
    }
  }

  recordSendResult(threw: boolean, socketOpen: boolean): void {
    const window = this.current;
    if (!window) return;
    window.socketOpen ||= socketOpen;
    if (threw) {
      window.sendAudioThrowCount += 1;
      this.runSendAudioThrowCount += 1;
    }
  }

  takeDue(atMs: number): PcmHealthWindow | undefined {
    if (!this.current || atMs - this.current.startedAtMs < this.windowMs) return undefined;
    return this.take(atMs);
  }

  finish(atMs: number): PcmHealthWindow | undefined {
    return this.current ? this.take(atMs) : undefined;
  }

  runSummary(atMs: number): PcmHealthRunSummary | undefined {
    if (this.runStartedAtMs === undefined) return undefined;
    return {
      runId: this.runId,
      runStartedAtMs: this.runStartedAtMs,
      runEndedAtMs: atMs,
      windowCount: this.emittedWindowCount,
      chunkCount: this.runChunkCount,
      sampleCount: this._totalSampleCount,
      expectedDurationMs: this.audioContextSampleRate > 0 ? this._totalSampleCount / this.audioContextSampleRate * 1_000 : 0,
      wallClockDurationMs: Math.max(0, atMs - this.runStartedAtMs),
      configuredSampleRate: this.configuredSampleRate,
      audioContextSampleRate: this.audioContextSampleRate,
      sendAudioThrowCount: this.runSendAudioThrowCount,
      socketWasOpen: this.socketWasOpen,
    };
  }

  private take(atMs: number): PcmHealthWindow {
    const window = this.current!;
    window.endedAtMs = Math.max(window.endedAtMs, atMs);
    this.current = undefined;
    this.emittedWindowCount += 1;
    const sampleCount = window.sampleCount;
    const finiteCount = window.finiteSampleCount;
    const rms = finiteCount ? Math.sqrt(window.sumSquares / finiteCount) : 0;
    const rmsDbfs = rms > 0 ? 20 * Math.log10(rms) : RMS_DBFS_FLOOR;
    const expectedDurationMs = this.audioContextSampleRate > 0 ? sampleCount / this.audioContextSampleRate * 1_000 : 0;
    const wallClockDurationMs = Math.max(0, window.endedAtMs - window.startedAtMs);
    const durationDriftMs = wallClockDurationMs - expectedDurationMs;
    const durationDriftRatio = expectedDurationMs > 0 ? durationDriftMs / expectedDurationMs : 0;
    const allZeroRatio = sampleCount ? window.allZeroSampleCount / sampleCount : 0;
    const nearZeroRatio = sampleCount ? window.nearZeroSampleCount / sampleCount : 0;
    const clippingRatio = sampleCount ? window.clippingSampleCount / sampleCount : 0;
    const timingMismatch = expectedDurationMs >= 250 && Math.abs(durationDriftRatio) > 0.25;
    const classification: PcmHealthClassification = sampleCount === 0
      ? "no_samples"
      : window.nonFiniteSampleCount > 0
        ? "non_finite"
        : allZeroRatio === 1
          ? "all_zero"
          : clippingRatio >= 0.01 || (window.peakAbsolute >= CLIPPING_AMPLITUDE && clippingRatio >= 0.001)
            ? "clipped"
            : timingMismatch
              ? "timing_mismatch"
              : nearZeroRatio >= 0.995 && rmsDbfs <= SILENCE_DBFS && window.peakAbsolute <= 0.02
                ? "near_silence"
                : "healthy_signal";
    return {
      runId: this.runId,
      windowStartedAtMs: window.startedAtMs,
      windowEndedAtMs: window.endedAtMs,
      chunkCount: window.chunkCount,
      sampleCount,
      min: finiteCount ? window.min : 0,
      max: finiteCount ? window.max : 0,
      peakAbsolute: window.peakAbsolute,
      rms,
      rmsDbfs,
      mean: finiteCount ? window.sum / finiteCount : 0,
      dcOffset: finiteCount ? window.sum / finiteCount : 0,
      allZeroSampleCount: window.allZeroSampleCount,
      allZeroRatio,
      nearZeroSampleCount: window.nearZeroSampleCount,
      nearZeroRatio,
      nonFiniteSampleCount: window.nonFiniteSampleCount,
      clippingSampleCount: window.clippingSampleCount,
      minChunkLength: Number.isFinite(window.minChunkLength) ? window.minChunkLength : 0,
      maxChunkLength: window.maxChunkLength,
      typicalChunkLength: window.chunkCount ? Math.round(sampleCount / window.chunkCount) : 0,
      expectedDurationMs,
      wallClockDurationMs,
      durationDriftMs,
      durationDriftRatio,
      configuredSampleRate: this.configuredSampleRate,
      audioContextSampleRate: this.audioContextSampleRate,
      sendAudioThrew: window.sendAudioThrowCount > 0,
      sendAudioThrowCount: window.sendAudioThrowCount,
      socketOpen: window.socketOpen,
      classification,
    };
  }
}

/** A measurement fault must never take the live audio handoff down with it. */
export function forwardPcmWithObservation(audio: Float32Array, observe: () => void, sendAudio: (audio: Float32Array) => void): { measurementFailed: boolean; sendAudioThrew: boolean } {
  let measurementFailed = false;
  try { observe(); } catch { measurementFailed = true; }
  let sendAudioThrew = false;
  try { sendAudio(audio); } catch { sendAudioThrew = true; }
  return { measurementFailed, sendAudioThrew };
}
