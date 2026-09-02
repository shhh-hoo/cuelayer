import {
  prepareTraceEvent,
  traceDraft,
  type SessionTraceDraft,
  type SessionTraceEvent,
  type TracePriority,
} from "./contracts";

export type TraceWriterStatus = "healthy" | "recovering" | "degraded" | "closed";

export type TraceWriterSnapshot = {
  status: TraceWriterStatus;
  pendingCount: number;
  droppedCount: number;
  consecutiveFailures: number;
  error?: string;
};

export type TraceWriterOptions = {
  flushIntervalMs?: number;
  batchSize?: number;
  maxPending?: number;
  retryBaseMs?: number;
};

type PendingPartial = { event: SessionTraceEvent<"speech.partial">; observedRevisions: number };

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : "trace-write-failed";

export class TraceWriter {
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxPending: number;
  private readonly retryBaseMs: number;
  private queue: SessionTraceEvent[] = [];
  private pendingPartials = new Map<string, PendingPartial>();
  private pendingGap = new Map<string, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private backgroundWrite?: Promise<void>;
  private sourceSeq = 0;
  private droppedCount = 0;
  private consecutiveFailures = 0;
  private lastError?: string;
  private closed = false;

  constructor(
    private readonly sessionId: string,
    private readonly sourceInstanceId: string,
    private readonly writeBatch: (events: readonly SessionTraceEvent[]) => Promise<void>,
    options: TraceWriterOptions = {},
  ) {
    this.flushIntervalMs = Math.max(1, options.flushIntervalMs ?? 250);
    this.batchSize = Math.max(1, options.batchSize ?? 64);
    this.maxPending = Math.max(this.batchSize, options.maxPending ?? 1_024);
    this.retryBaseMs = Math.max(10, options.retryBaseMs ?? 500);
  }

  get snapshot(): TraceWriterSnapshot {
    const pendingCount = this.pendingCount;
    const status: TraceWriterStatus = this.closed
      ? "closed"
      : this.lastError
        ? "degraded"
        : pendingCount || this.backgroundWrite
          ? "recovering"
          : "healthy";
    return {
      status,
      pendingCount,
      droppedCount: this.droppedCount,
      consecutiveFailures: this.consecutiveFailures,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  get pendingCount() {
    return this.queue.length + this.pendingPartials.size;
  }

  emit(draft: SessionTraceDraft) {
    if (this.closed) return;
    const event = prepareTraceEvent(this.sessionId, this.sourceInstanceId, ++this.sourceSeq, draft);
    if (event.type === "speech.partial") {
      const runId = (event.payload as { runId: number }).runId;
      const key = `speech.partial:${runId}`;
      const previous = this.pendingPartials.get(key);
      this.pendingPartials.set(key, {
        event: event as SessionTraceEvent<"speech.partial">,
        observedRevisions: (previous?.observedRevisions ?? 0) + 1,
      });
    } else {
      this.queue.push(event);
    }
    this.enforceBound();
    this.schedule(this.pendingCount >= this.batchSize ? 0 : this.flushIntervalMs);
  }

  async flush() {
    if (this.closed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.backgroundWrite) await this.backgroundWrite;
    while (this.pendingCount || this.pendingGap.size) {
      const succeeded = await this.writeNextBatch();
      if (!succeeded) throw new Error(this.lastError ?? "trace-write-failed");
    }
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delayMs: number) {
    if (this.closed || this.timer || this.backgroundWrite) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.closed || this.backgroundWrite) return;
      this.backgroundWrite = this.drainInBackground().finally(() => {
        this.backgroundWrite = undefined;
        if (!this.closed && (this.pendingCount || this.pendingGap.size)) {
          const retryDelay = this.lastError
            ? Math.min(5_000, this.retryBaseMs * 2 ** Math.min(4, Math.max(0, this.consecutiveFailures - 1)))
            : this.flushIntervalMs;
          this.schedule(retryDelay);
        }
      });
    }, delayMs);
  }

  private async drainInBackground() {
    while (!this.closed && (this.pendingCount || this.pendingGap.size)) {
      const succeeded = await this.writeNextBatch();
      if (!succeeded) return;
    }
  }

  private materializePartials() {
    if (!this.pendingPartials.size) return;
    const partials = [...this.pendingPartials.values()]
      .map(({ event, observedRevisions }) => observedRevisions <= 1 ? event : ({
        ...event,
        payload: { ...event.payload, coalescedRevisions: observedRevisions - 1 },
      } satisfies SessionTraceEvent<"speech.partial">))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    this.pendingPartials.clear();
    this.queue.push(...partials);
  }

  private gapEvent() {
    if (!this.pendingGap.size) return undefined;
    return prepareTraceEvent(
      this.sessionId,
      this.sourceInstanceId,
      ++this.sourceSeq,
      traceDraft("trace.gap", { reason: "queue_pressure", dropped: Object.fromEntries(this.pendingGap) }, { priority: "critical" }),
    );
  }

  private async writeNextBatch() {
    this.materializePartials();
    const gap = this.gapEvent();
    const queueRoom = Math.max(0, this.batchSize - (gap ? 1 : 0));
    const queued = this.queue.slice(0, queueRoom);
    const batch = gap ? [gap, ...queued] : queued;
    if (!batch.length) return true;
    try {
      await this.writeBatch(batch);
      this.queue.splice(0, queued.length);
      if (gap) this.pendingGap.clear();
      this.lastError = undefined;
      this.consecutiveFailures = 0;
      return true;
    } catch (reason) {
      this.consecutiveFailures += 1;
      this.lastError = errorMessage(reason);
      return false;
    }
  }

  private enforceBound() {
    while (this.pendingCount > this.maxPending) {
      const pendingPartial = this.pendingPartials.entries().next().value as [string, PendingPartial] | undefined;
      if (pendingPartial) {
        this.pendingPartials.delete(pendingPartial[0]);
        this.recordDrop(pendingPartial[1].event.type, pendingPartial[1].observedRevisions);
        continue;
      }
      const rawIndex = this.queue.findIndex((event) => event.priority === "raw");
      const aggregateIndex = this.queue.findIndex((event) => event.priority === "aggregate");
      const removableIndex = rawIndex >= 0 ? rawIndex : aggregateIndex >= 0 ? aggregateIndex : 0;
      const [removed] = this.queue.splice(removableIndex, 1);
      if (!removed) break;
      this.recordDrop(removed.type, 1);
    }
  }

  private recordDrop(type: string, count: number) {
    this.droppedCount += count;
    this.pendingGap.set(type, (this.pendingGap.get(type) ?? 0) + count);
  }
}

export function lowerPriorityThan(left: TracePriority, right: TracePriority) {
  const rank: Record<TracePriority, number> = { raw: 0, aggregate: 1, critical: 2 };
  return rank[left] < rank[right];
}
