import type { GroundedSpeechTurn } from "./contracts";

export type PlannerCheckpoint = { spanId: string; spanRevision: number; closed?: boolean };
export type PlannerWork = PlannerCheckpoint & { requestId: number; runId: number; segmentIds: string[]; startedAtMs: number };

/** A bounded context may look backward from this work, but never forward into still-pending speech. */
export function plannerWindowThroughWork(spans: GroundedSpeechTurn[], work: PlannerWork, maxSpans = 6) {
  const endIndex = spans.findIndex((turn) => turn.id === work.spanId);
  return endIndex < 0 ? [] : spans.slice(Math.max(0, endIndex - maxSpans + 1), endIndex + 1);
}

/** One request at a time; pending revisions for one span collapse to the newest revision. */
export class SingleFlightPlanner {
  private pending: PlannerCheckpoint[] = [];
  private inFlight?: PlannerWork;
  private requestId = 0;

  reset() { this.pending = []; this.inFlight = undefined; }
  enqueue(checkpoints: PlannerCheckpoint[]) {
    checkpoints.forEach((checkpoint) => {
      if (this.inFlight?.spanId === checkpoint.spanId && this.inFlight.spanRevision >= checkpoint.spanRevision) return;
      const pendingIndex = this.pending.findIndex((item) => item.spanId === checkpoint.spanId);
      if (pendingIndex < 0) this.pending.push(checkpoint);
      else if (this.pending[pendingIndex]!.spanRevision < checkpoint.spanRevision) this.pending[pendingIndex] = checkpoint;
    });
  }
  coalescePending(checkpoints: PlannerCheckpoint[]) {
    checkpoints.forEach((checkpoint) => {
      const pendingIndex = this.pending.findIndex((item) => item.spanId === checkpoint.spanId);
      if (pendingIndex >= 0 && this.pending[pendingIndex]!.spanRevision < checkpoint.spanRevision) this.pending[pendingIndex] = checkpoint;
    });
  }
  next(runId: number, startedAtMs = Date.now()): PlannerWork | undefined {
    if (this.inFlight || !this.pending.length) return undefined;
    const closedIndex = this.pending.findIndex((item) => item.closed);
    const checkpoint = this.pending.splice(closedIndex < 0 ? 0 : closedIndex, 1)[0]!;
    this.inFlight = { ...checkpoint, requestId: ++this.requestId, runId, segmentIds: [checkpoint.spanId], startedAtMs };
    return this.inFlight;
  }
  complete(requestId: number, runId: number) {
    if (this.inFlight?.requestId === requestId && this.inFlight.runId === runId) this.inFlight = undefined;
  }
  cancel(requestId: number, runId: number) {
    if (this.inFlight?.requestId !== requestId || this.inFlight.runId !== runId) return undefined;
    const cancelled = this.inFlight;
    this.inFlight = undefined;
    return cancelled;
  }
  get currentWork() { return this.inFlight; }
  get isIdle() { return !this.inFlight; }
  get pendingCount() { return this.pending.length; }
}
