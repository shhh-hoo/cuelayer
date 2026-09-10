import type { CanonicalSpeechSpan, SpeechRunId } from "./speech-types";

/** Canonical assembly appends spans and only revises the open tail. Closed prefixes
 * are immutable. Reset/replaced input falls back to idempotent evidence admission. */
export class ClosedSpeechCursor {
  private index = 0;
  private last?: CanonicalSpeechSpan;
  private run?: SpeechRunId;
  inspected = 0;
  next(spans: readonly CanonicalSpeechSpan[], run: SpeechRunId) {
    if (this.run !== run || (this.index > 0 && spans[this.index - 1] !== this.last)) {
      this.run = run; this.index = 0; this.last = undefined;
    }
    const span = spans[this.index];
    if (span) this.inspected++;
    return span?.status === "closed" ? span : undefined;
  }
  committed(span: CanonicalSpeechSpan) { this.index++; this.last = span; }
}
