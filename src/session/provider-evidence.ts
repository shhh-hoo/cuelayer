export type EmptyTranscriptSummary = {
  runId: number;
  windowStartedAtMs: number;
  windowEndedAtMs: number;
  partialCount: number;
  finalCount: number;
  rawWhitespaceSamples: string[];
};

/** Bounded raw evidence for empty provider windows; lexical handling never sees these messages. */
export class EmptyTranscriptAccumulator {
  private startedAtMs?: number;
  private partialCount = 0;
  private finalCount = 0;
  private samples: string[] = [];

  constructor(readonly runId: number, private readonly windowMs = 1_000) {}

  observe(message: "AddPartialTranscript" | "AddTranscript", rawText: string, atMs: number) {
    this.startedAtMs ??= atMs;
    if (message === "AddPartialTranscript") this.partialCount += 1;
    else this.finalCount += 1;
    if (this.samples.length < 3 && !this.samples.includes(rawText)) this.samples.push(rawText);
  }

  takeDue(atMs: number): EmptyTranscriptSummary | undefined {
    if (this.startedAtMs === undefined || atMs - this.startedAtMs < this.windowMs) return undefined;
    return this.take(atMs);
  }

  finish(atMs: number): EmptyTranscriptSummary | undefined {
    return this.startedAtMs === undefined ? undefined : this.take(atMs);
  }

  private take(atMs: number): EmptyTranscriptSummary {
    const summary = {
      runId: this.runId,
      windowStartedAtMs: this.startedAtMs!,
      windowEndedAtMs: atMs,
      partialCount: this.partialCount,
      finalCount: this.finalCount,
      rawWhitespaceSamples: this.samples,
    };
    this.startedAtMs = undefined;
    this.partialCount = 0;
    this.finalCount = 0;
    this.samples = [];
    return summary;
  }
}
