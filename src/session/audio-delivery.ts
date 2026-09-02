export type AudioDeliverySummary = {
  runId: number;
  windowStartedAtMs: number;
  windowEndedAtMs: number;
  acknowledgedChunkCount: number;
  firstSeqNo?: number;
  lastSeqNo?: number;
  missingSequenceCount: number;
  duplicateOrOutOfOrderCount: number;
  windowDurationMs: number;
  pcmSampleCount?: number;
};

export type AudioDeliveryRunSummary = {
  runId: number;
  runStartedAtMs: number;
  runEndedAtMs: number;
  acknowledgedChunkCount: number;
  firstSeqNo?: number;
  lastSeqNo?: number;
  missingSequenceCount: number;
  duplicateOrOutOfOrderCount: number;
  pcmSampleCount?: number;
};

type Window = Omit<AudioDeliverySummary, "runId" | "windowDurationMs">;

/** Bounded acknowledgement evidence; individual AudioAdded messages never escape this accumulator. */
export class AudioDeliveryAccumulator {
  private current?: Window;
  private previousSeqNo?: number;
  private runStartedAtMs?: number;
  private acknowledgedChunkCount = 0;
  private firstSeqNo?: number;
  private lastSeqNo?: number;
  private missingSequenceCount = 0;
  private duplicateOrOutOfOrderCount = 0;
  private initialPcmSampleCount?: number;

  constructor(readonly runId: number, private readonly windowMs = 1_000) {}

  observe(seqNo: number, atMs: number, pcmSampleCount?: number) {
    this.runStartedAtMs ??= atMs;
    this.initialPcmSampleCount ??= pcmSampleCount;
    this.acknowledgedChunkCount += 1;
    this.firstSeqNo ??= seqNo;
    this.lastSeqNo = seqNo;
    const window = this.current ??= {
      windowStartedAtMs: atMs,
      windowEndedAtMs: atMs,
      acknowledgedChunkCount: 0,
      missingSequenceCount: 0,
      duplicateOrOutOfOrderCount: 0,
      pcmSampleCount,
    };
    window.windowEndedAtMs = atMs;
    window.acknowledgedChunkCount += 1;
    window.firstSeqNo ??= seqNo;
    window.lastSeqNo = seqNo;
    if (this.previousSeqNo !== undefined) {
      if (seqNo > this.previousSeqNo + 1) {
        const missing = seqNo - this.previousSeqNo - 1;
        window.missingSequenceCount += missing;
        this.missingSequenceCount += missing;
      } else if (seqNo <= this.previousSeqNo) {
        window.duplicateOrOutOfOrderCount += 1;
        this.duplicateOrOutOfOrderCount += 1;
      }
    }
    this.previousSeqNo = Math.max(this.previousSeqNo ?? seqNo, seqNo);
  }

  takeDue(atMs: number, pcmSampleCount?: number): AudioDeliverySummary | undefined {
    if (!this.current || atMs - this.current.windowStartedAtMs < this.windowMs) return undefined;
    return this.take(atMs, pcmSampleCount);
  }

  finish(atMs: number, pcmSampleCount?: number): AudioDeliverySummary | undefined {
    return this.current ? this.take(atMs, pcmSampleCount) : undefined;
  }

  runSummary(atMs: number, pcmSampleCount?: number): AudioDeliveryRunSummary | undefined {
    if (this.runStartedAtMs === undefined) return undefined;
    return {
      runId: this.runId,
      runStartedAtMs: this.runStartedAtMs,
      runEndedAtMs: atMs,
      acknowledgedChunkCount: this.acknowledgedChunkCount,
      firstSeqNo: this.firstSeqNo,
      lastSeqNo: this.lastSeqNo,
      missingSequenceCount: this.missingSequenceCount,
      duplicateOrOutOfOrderCount: this.duplicateOrOutOfOrderCount,
      ...(pcmSampleCount === undefined || this.initialPcmSampleCount === undefined ? {} : { pcmSampleCount: Math.max(0, pcmSampleCount - this.initialPcmSampleCount) }),
    };
  }

  private take(atMs: number, pcmSampleCount?: number): AudioDeliverySummary {
    const window = this.current!;
    this.current = undefined;
    const endingSamples = pcmSampleCount;
    const startingSamples = window.pcmSampleCount;
    return {
      runId: this.runId,
      windowStartedAtMs: window.windowStartedAtMs,
      windowEndedAtMs: Math.max(window.windowEndedAtMs, atMs),
      acknowledgedChunkCount: window.acknowledgedChunkCount,
      firstSeqNo: window.firstSeqNo,
      lastSeqNo: window.lastSeqNo,
      missingSequenceCount: window.missingSequenceCount,
      duplicateOrOutOfOrderCount: window.duplicateOrOutOfOrderCount,
      windowDurationMs: Math.max(window.windowEndedAtMs, atMs) - window.windowStartedAtMs,
      ...(endingSamples === undefined || startingSamples === undefined ? {} : { pcmSampleCount: Math.max(0, endingSamples - startingSamples) }),
    };
  }
}
