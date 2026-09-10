import { abortable } from "../abortable.ts";
import type { CoreVerificationJob } from "../../trace/core-contracts.ts";
import { CoreTrace } from "./trace.ts";

export type VerificationSink = (job: Readonly<CoreVerificationJob>, signal: AbortSignal) => Promise<void>;
export const VERIFICATION_QUEUE_LIMITS = Object.freeze({ pending: 32, timeoutMs: 6_000 });

/** Best-effort diagnostics only. No reducer, event store or semantic scheduler access. */
export class VerificationDispatcher {
  private queue: CoreVerificationJob[] = [];
  private active?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(private sink?: VerificationSink, private trace = new CoreTrace(), private timeoutMs: number = VERIFICATION_QUEUE_LIMITS.timeoutMs) {}
  get pendingCount() { return this.queue.length + (this.active ? 1 : 0); }
  private status(job: CoreVerificationJob, status: "enqueued" | "started" | "completed" | "failed" | "timeout" | "cancelled" | "dropped", reason?: string) {
    this.trace.record("core.verification", () => ({ ...job, status, ...(reason ? { reason } : {}) }),
      { coreRequestId: job.coreRequestId, verificationRequestIndex: job.verificationRequestIndex });
  }
  enqueue(jobs: readonly CoreVerificationJob[]) {
    for (const job of jobs) {
      if (this.closed || !this.sink || this.pendingCount >= VERIFICATION_QUEUE_LIMITS.pending) {
        this.status(job, "dropped", this.closed ? "dispatcher_closed" : !this.sink ? "verifier_unconfigured" : "queue_pressure");
      } else {
        this.queue.push(structuredClone(job));
        this.status(job, "enqueued");
      }
    }
    this.schedule();
  }
  private schedule() {
    if (this.closed || this.active || this.timer || !this.queue.length) return;
    // A later task turn; the next semantic request is allowed to start first.
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, 0);
  }
  private async run() {
    const job = this.queue.shift();
    if (!job || this.closed) return;
    const controller = new AbortController();
    this.active = controller;
    const timeout = setTimeout(() => controller.abort("verification_timeout"), this.timeoutMs);
    this.status(job, "started");
    try {
      await abortable(() => this.sink!(structuredClone(job), controller.signal), controller.signal);
      this.status(job, "completed");
    } catch (error) {
      const status = controller.signal.reason === "verification_timeout" ? "timeout" : controller.signal.aborted ? "cancelled" : "failed";
      this.status(job, status, error instanceof Error ? error.message.slice(0, 2_048) : "verification_failed");
    } finally { clearTimeout(timeout); this.active = undefined; this.schedule(); }
  }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.active?.abort("verification_cancelled");
    for (const job of this.queue.splice(0)) this.status(job, "cancelled", "dispatcher_closed");
  }
}
