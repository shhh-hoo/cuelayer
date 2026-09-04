import type { SessionTracePayloads } from "../trace/contracts";

export type AudioDeliverySummary = SessionTracePayloads["speech.transport_window"];

export class AudioDeliveryMonitor {
  private windowStartedAtMs: number;
  private acknowledgedChunkCount = 0;
  private firstSeqNo?: number;
  private lastSeqNo?: number;
  private previousSeqNo?: number;
  private missingSequenceCount = 0;
  private duplicateOrOutOfOrderCount = 0;
  private runAcknowledgedChunkCount = 0;
  private runFirstSeqNo?: number;
  private runLastSeqNo?: number;
  private runMissingSequenceCount = 0;
  private runDuplicateOrOutOfOrderCount = 0;

  constructor(readonly runId: SpeechRunId, readonly runStartedAtMs = Date.now()) {
    this.windowStartedAtMs = runStartedAtMs;
  }

  observe(seqNo: number) {
    this.acknowledgedChunkCount += 1;
    this.runAcknowledgedChunkCount += 1;
    this.firstSeqNo ??= seqNo;
    this.runFirstSeqNo ??= seqNo;
    this.lastSeqNo = seqNo;
    this.runLastSeqNo = seqNo;
    if (this.previousSeqNo !== undefined) {
      if (seqNo > this.previousSeqNo + 1) {
        const missing = seqNo - this.previousSeqNo - 1;
        this.missingSequenceCount += missing;
        this.runMissingSequenceCount += missing;
      } else if (seqNo <= this.previousSeqNo) {
        this.duplicateOrOutOfOrderCount += 1;
        this.runDuplicateOrOutOfOrderCount += 1;
      }
    }
    this.previousSeqNo = Math.max(this.previousSeqNo ?? seqNo, seqNo);
  }

  takeWindow(atMs = Date.now(), final = false): AudioDeliverySummary {
    const summary: AudioDeliverySummary = {
      runId: this.runId,
      scope: "window",
      windowStartedAt: new Date(this.windowStartedAtMs).toISOString(),
      windowEndedAt: new Date(atMs).toISOString(),
      acknowledgedChunkCount: this.acknowledgedChunkCount,
      ...(this.firstSeqNo === undefined ? {} : { firstSeqNo: this.firstSeqNo }),
      ...(this.lastSeqNo === undefined ? {} : { lastSeqNo: this.lastSeqNo }),
      missingSequenceCount: this.missingSequenceCount,
      duplicateOrOutOfOrderCount: this.duplicateOrOutOfOrderCount,
      final,
    };
    this.windowStartedAtMs = atMs;
    this.acknowledgedChunkCount = 0;
    this.firstSeqNo = undefined;
    this.lastSeqNo = undefined;
    this.missingSequenceCount = 0;
    this.duplicateOrOutOfOrderCount = 0;
    return summary;
  }

  runSummary(atMs = Date.now()): AudioDeliverySummary {
    return {
      runId: this.runId,
      scope: "run",
      windowStartedAt: new Date(this.runStartedAtMs).toISOString(),
      windowEndedAt: new Date(atMs).toISOString(),
      acknowledgedChunkCount: this.runAcknowledgedChunkCount,
      ...(this.runFirstSeqNo === undefined ? {} : { firstSeqNo: this.runFirstSeqNo }),
      ...(this.runLastSeqNo === undefined ? {} : { lastSeqNo: this.runLastSeqNo }),
      missingSequenceCount: this.runMissingSequenceCount,
      duplicateOrOutOfOrderCount: this.runDuplicateOrOutOfOrderCount,
      final: true,
    };
  }
}
import type { SpeechRunId } from "./speech-types";
