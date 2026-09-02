import type { DurableTraceEvent, DurableTraceEventDraft } from "./durable-trace";

export type TraceWriterStatus = "healthy" | "recovering" | "degraded";
export type TraceWriterSnapshot = { status: TraceWriterStatus; pendingCount: number; droppedCount: number; error?: string };

type TraceWriterOptions = {
  maxPending?: number;
  batchSize?: number;
  retryDelayMs?: number;
  maxFailures?: number;
  onAccepted?(events: DurableTraceEvent[]): void;
  onState?(snapshot: TraceWriterSnapshot): void;
};

const messageFor = (reason: unknown) => reason instanceof Error ? reason.message : "trace-local-store-unavailable";

/** A bounded, single-writer queue. Enqueue never waits for IndexedDB. */
export class TraceWriter {
  private readonly maxPending: number;
  private readonly batchSize: number;
  private readonly retryDelayMs: number;
  private readonly maxFailures: number;
  private queue: DurableTraceEventDraft[] = [];
  private running?: Promise<void>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private droppedCount = 0;
  private lastError?: string;
  private consecutiveFailures = 0;
  private disabled = false;
  private closed = false;

  constructor(private readonly write: (drafts: DurableTraceEventDraft[]) => Promise<DurableTraceEvent[]>, private readonly options: TraceWriterOptions = {}) {
    this.maxPending = Math.max(1, options.maxPending ?? 1_000);
    this.batchSize = Math.max(1, options.batchSize ?? 100);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 1_000);
    this.maxFailures = Math.max(1, options.maxFailures ?? 5);
    this.emit();
  }

  get snapshot(): TraceWriterSnapshot {
    const error = this.disabled
      ? `${this.lastError}; ${this.droppedCount} trace events dropped`
      : this.lastError ?? (this.droppedCount ? `${this.droppedCount} trace events dropped after the local queue filled` : undefined);
    return { status: this.queue.length ? (this.lastError ? "degraded" : "recovering") : (this.droppedCount ? "degraded" : "healthy"), pendingCount: this.queue.length, droppedCount: this.droppedCount, error };
  }

  enqueue(drafts: DurableTraceEventDraft[]) {
    if (this.closed || !drafts.length) return;
    if (this.disabled) { this.droppedCount += drafts.length; this.emit(); return; }
    const enqueuedAt = new Date().toISOString();
    drafts = drafts.map((draft) => draft.occurredAt || draft.timestamp ? draft : { ...draft, occurredAt: enqueuedAt });
    const overflow = Math.max(0, this.queue.length + drafts.length - this.maxPending);
    if (overflow) {
      const droppedFromQueue = Math.min(overflow, this.queue.length);
      this.queue.splice(0, droppedFromQueue);
      const dropFromIncoming = overflow - droppedFromQueue;
      drafts = drafts.slice(dropFromIncoming);
      this.droppedCount += overflow;
    }
    this.queue.push(...drafts);
    this.emit();
    this.retryNow();
  }

  retryNow() {
    if (this.closed || this.running || !this.queue.length) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    this.running = this.drain().finally(() => { this.running = undefined; });
  }

  async flush() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    if (!this.running && this.queue.length) this.running = this.drain().finally(() => { this.running = undefined; });
    await this.running;
    if (this.disabled) throw new Error(this.lastError ?? "trace-disabled");
    if (this.queue.length) throw new Error(this.lastError ?? "trace-write-pending");
  }

  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private async drain() {
    while (!this.closed && this.queue.length) {
      const batch = this.queue.slice(0, this.batchSize);
      try {
        const accepted = await this.write(batch);
        this.queue.splice(0, batch.length);
        this.lastError = undefined;
        this.consecutiveFailures = 0;
        try { this.options.onAccepted?.(accepted); } catch { /* UI callbacks cannot change durable writer state. */ }
        this.emit();
      } catch (reason) {
        this.consecutiveFailures += 1;
        this.lastError = messageFor(reason);
        if (this.consecutiveFailures >= this.maxFailures) {
          this.disabled = true;
          this.droppedCount += this.queue.length;
          this.queue = [];
          this.lastError = `trace disabled after ${this.consecutiveFailures} write failures: ${this.lastError}`;
          this.emit();
          return;
        }
        this.emit();
        if (!this.closed) this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.retryNow(); }, this.retryDelayMs);
        return;
      }
    }
  }

  private emit() { try { this.options.onState?.(this.snapshot); } catch { /* UI callbacks cannot change durable writer state. */ } }
}
