import type { CompactEvidenceCheckpoint } from "../contracts.ts";
import { LosslessInterpretationScheduler } from "../pending-evidence.ts";
import type { CoreLessonStreamRuntime } from "./runtime.ts";
import type { SessionTask } from "./session-processing.ts";

export const SESSION_LIVE_POLICY = Object.freeze({ coalescingMs: 250, maxWaitMs: 750, maxCheckpoints: 8 });
export type SessionLivePolicy = { coalescingMs: number; maxWaitMs: number; maxCheckpoints: number };
export type DispatchReason = "boundary" | "batch_limit" | "coalesced" | "max_wait" | "flush";
/** One session-owned operational projection around the existing lossless scheduler.
 * No provider, semantic reducer or persistence writer lives here. */
export class SessionCoordinator extends LosslessInterpretationScheduler {
  readonly policy: SessionLivePolicy;
  private arrivals = new Map<string, number>();
  private boundaries = new Set<string>();
  private lastArrival = Number.NEGATIVE_INFINITY;
  private flushRequested = false;
  task?: SessionTask;
  constructor(readonly runtime: CoreLessonStreamRuntime, policy: Partial<SessionLivePolicy> = {}) {
    const configured = { ...SESSION_LIVE_POLICY, ...policy };
    if (!Number.isFinite(configured.coalescingMs) || configured.coalescingMs < 0 || !Number.isFinite(configured.maxWaitMs)
      || configured.maxWaitMs < configured.coalescingMs || !Number.isInteger(configured.maxCheckpoints)
      || configured.maxCheckpoints < 1 || configured.maxCheckpoints > 16) throw new Error("session-live-policy-invalid");
    super(configured.maxCheckpoints); this.policy = configured;
    this.restore(runtime.pending);
  }
  override restore(checkpoints: readonly CompactEvidenceCheckpoint[]) {
    this.arrivals.clear(); this.boundaries.clear(); this.lastArrival = Number.NEGATIVE_INFINITY;
    super.restore(checkpoints);
  }
  override enqueue(checkpoints: readonly CompactEvidenceCheckpoint[]) {
    const now = performance.now();
    for (const checkpoint of checkpoints) if (!this.arrivals.has(checkpoint.checkpointId)) {
      // Wall-clock recovery age is diagnostic/eligibility only; subsequent waits use monotonic time.
      const committed = this.runtime.indexes.commits.get(checkpoint.checkpointId);
      const age = committed ? Math.max(0, Date.now() - Date.parse(committed.timestamp)) : 0;
      this.arrivals.set(checkpoint.checkpointId, now - age); this.lastArrival = Math.max(this.lastArrival, now - age);
    }
    super.enqueue(checkpoints);
  }
  markBoundary(checkpointId: string) { this.boundaries.add(checkpointId); }
  flush(enabled = true) { this.flushRequested = enabled; }
  eligibility(now = performance.now()): { waitMs: number; reason: DispatchReason } | undefined {
    const pending = this.pendingHead(this.policy.maxCheckpoints);
    if (!pending.length) return undefined;
    if (this.flushRequested) return { waitMs: 0, reason: "flush" };
    // Only a boundary in the selectable prefix can release this batch early.
    if (pending.slice(0, this.policy.maxCheckpoints).some(c => this.boundaries.has(c.checkpointId))) return { waitMs: 0, reason: "boundary" };
    if (pending.length >= this.policy.maxCheckpoints) return { waitMs: 0, reason: "batch_limit" };
    const maxAt = this.arrivals.get(pending[0]!.checkpointId)! + this.policy.maxWaitMs;
    const quietAt = this.lastArrival + this.policy.coalescingMs;
    return { waitMs: Math.max(0, Math.min(maxAt, quietAt) - now), reason: maxAt <= quietAt ? "max_wait" : "coalesced" };
  }
  override settleAccepted(requestId: string, ids: readonly string[]) {
    const settled = super.settleAccepted(requestId, ids);
    if (settled) for (const id of ids) { this.arrivals.delete(id); this.boundaries.delete(id); }
    return settled;
  }
  get oldestPendingAgeMs() {
    const oldest = this.oldestPendingCheckpoint;
    return oldest ? Math.max(0, performance.now() - (this.arrivals.get(oldest.checkpointId) ?? performance.now())) : 0;
  }
  get window() { return this.snapshot(); }
  snapshot(limit = Number.POSITIVE_INFINITY) {
    const replay = this.runtime.replay;
    const take = <T>(values: Iterable<T>) => { const result: T[] = []; for (const value of values) { if (result.length >= limit) break; result.push(value); } return result; };
    return {
      committedThroughSequence: replay.checkpoints.length,
      liveThroughSequence: replay.state.processedThroughSequence,
      accepted: { currentCoreId: replay.state.knowledge.currentCoreId, cueId: replay.state.cue.active?.id,
        knowledgeRevision: replay.state.knowledge.revision, cueRevision: replay.state.cue.revision },
      pendingCheckpointIds: this.pendingHead(limit).map(c => c.checkpointId),
      pendingRange: this.pendingRange, pendingCheckpointCount: this.pendingCount,
      unresolvedCount: replay.unresolved.size, stageReviewCount: replay.reviews.size,
      oldestPendingAgeMs: this.oldestPendingAgeMs,
      unresolved: take(replay.unresolved.values()), stageReviews: take(replay.reviews.values()),
      task: this.task, sealed: replay.ended,
    };
  }
}
