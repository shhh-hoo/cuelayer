export type RetryTimer = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;

/** Keeps retries serialized without allowing newly committed evidence to bypass backoff. */
export class RetryBackoff {
  private timerHandle: ReturnType<typeof globalThis.setTimeout> | undefined;
  private failures = 0;

  constructor(private readonly timer: RetryTimer = globalThis) {}

  get active() {
    return this.timerHandle !== undefined;
  }

  get consecutiveFailures() {
    return this.failures;
  }

  fail(onRetry: () => void) {
    this.failures += 1;
    if (this.timerHandle !== undefined) return;
    const delay = Math.min(5_000, 500 * 2 ** Math.min(4, this.failures));
    this.timerHandle = this.timer.setTimeout(() => {
      // Clear the gate before pumping so the retry is the one permitted flight.
      this.timerHandle = undefined;
      onRetry();
    }, delay);
  }

  accept() {
    this.failures = 0;
  }

  clear() {
    if (this.timerHandle === undefined) return;
    this.timer.clearTimeout(this.timerHandle);
    this.timerHandle = undefined;
  }
}
