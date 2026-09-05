import { MAX_REQUEST_CHECKPOINTS } from "./runtime-policy";
import type { CompactEvidenceCheckpoint } from "./contracts";
import type { SpeechRunId } from "../session/speech-types";

export type InterpretationWork = {
  requestId: string;
  speechRunId: SpeechRunId;
  checkpointIds: string[];
  startedAtMs: number;
};

const tokensFor = (checkpoint: CompactEvidenceCheckpoint) => Math.ceil(checkpoint.text.length / 4) + 16;

export class LosslessInterpretationScheduler {
  private pending: CompactEvidenceCheckpoint[] = [];
  private inFlight?: InterpretationWork;
  private requestSequence = 0;
  private retryPrefix?: string[];
  private budgetBlocked = false;

  reset() {
    this.pending = [];
    this.inFlight = undefined;
    this.retryPrefix = undefined;
    this.budgetBlocked = false;
  }

  restore(checkpoints: readonly CompactEvidenceCheckpoint[]) {
    this.reset();
    this.enqueue(checkpoints);
  }

  enqueue(checkpoints: readonly CompactEvidenceCheckpoint[]) {
    const known = new Set([...this.pending.map((item) => item.checkpointId), ...(this.inFlight?.checkpointIds ?? [])]);
    for (const checkpoint of checkpoints) {
      if (!known.has(checkpoint.checkpointId)) {
        this.pending.push(checkpoint);
        known.add(checkpoint.checkpointId);
      }
    }
    this.pending.sort((left, right) => left.lessonSequence - right.lessonSequence);
  }

  next(speechRunId: SpeechRunId, tokenCap = 3_500, startedAtMs = Date.now(), fitsRequest: (batch: CompactEvidenceCheckpoint[]) => boolean = () => true) {
    if (this.inFlight || !this.pending.length) return undefined;
    this.budgetBlocked = false;
    const batch: CompactEvidenceCheckpoint[] = [];
    let tokens = 0;
    for (const checkpoint of this.pending) {
      if (batch.length >= MAX_REQUEST_CHECKPOINTS || (this.retryPrefix && !this.retryPrefix.includes(checkpoint.checkpointId))) break;
      if (!fitsRequest([...batch, checkpoint])) { this.budgetBlocked = !batch.length; break; }
      const nextTokens = tokensFor(checkpoint);
      if (batch.length && tokens + nextTokens > tokenCap) break;
      batch.push(checkpoint);
      tokens += nextTokens;
    }
    if (!batch.length) return undefined;
    this.inFlight = {
      requestId: `interpretation-${speechRunId}-${++this.requestSequence}`,
      speechRunId,
      checkpointIds: batch.map((item) => item.checkpointId),
      startedAtMs,
    };
    return { work: this.inFlight, checkpoints: batch, estimatedTokens: tokens };
  }

  settleAccepted(requestId: string, consumedCheckpointIds: readonly string[]) {
    if (this.inFlight?.requestId !== requestId) return false;
    const consumed = new Set(consumedCheckpointIds);
    this.pending = this.pending.filter((checkpoint) => !consumed.has(checkpoint.checkpointId));
    this.inFlight = undefined;
    this.retryPrefix = undefined;
    return true;
  }

  settleFailed(requestId: string) {
    if (this.inFlight?.requestId !== requestId) return false;
    this.retryPrefix = [...this.inFlight.checkpointIds];
    this.inFlight = undefined;
    return true;
  }

  get isBudgetBlocked() { return this.budgetBlocked; }
  get currentWork() { return this.inFlight; }
  get pendingCheckpoints() { return [...this.pending]; }
  get pendingCount() { return this.pending.length; }
}
