import type { InterpretationFailure } from "../lesson-stream/runtime-policy";
export type RetryTimer = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;

/** Keeps retries serialized without allowing newly committed evidence to bypass backoff. */
export class RetryBackoff {
  private timerHandle: ReturnType<typeof globalThis.setTimeout> | undefined;
  private failures = 0;
  private paused = false;

  constructor(private readonly timer: RetryTimer = globalThis) {}

  get active() {
    return this.timerHandle !== undefined || this.paused;
  }

  get consecutiveFailures() {
    return this.failures;
  }

  get isPaused() { return this.paused; }

  fail(onRetry: () => void, category: InterpretationFailure = "provider") {
    if (category === "cancelled") return;
    this.failures += 1;
    if (this.timerHandle !== undefined || this.paused) return;
    if (category === "validation" || category === "budget" || this.failures >= 3) { this.paused = true; return; }
    const delay = category === "conflict" ? 0 : Math.min(5_000, 500 * 2 ** Math.min(4, this.failures));
    this.timerHandle = this.timer.setTimeout(() => {
      // Clear the gate before pumping so the retry is the one permitted flight.
      this.timerHandle = undefined;
      onRetry();
    }, delay);
  }

  accept() {
    this.clear();
    this.paused = false;
    this.failures = 0;
  }

  clear() {
    if (this.timerHandle === undefined) return;
    this.timer.clearTimeout(this.timerHandle);
    this.timerHandle = undefined;
  }
}
