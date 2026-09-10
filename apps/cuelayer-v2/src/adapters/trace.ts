import type { EventStore } from "./storage";
export type Span = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  start: number;
  end: number;
  attributes: Record<string, unknown>;
};
export class Trace {
  readonly sourceId = crypto.randomUUID();
  spans: Span[] = [];
  dropped = 0;
  now = () => performance.now();
  mark(
    name: string,
    attributes: Record<string, unknown> = {},
    start = this.now(),
    parentSpanId?: string,
    end = this.now(),
  ) {
    try {
      if (this.spans.length >= 4096) {
        this.spans.shift();
        this.dropped++;
      }
      const span = {
        spanId: crypto.randomUUID(),
        parentSpanId,
        name,
        start,
        end,
        attributes: { ...attributes, traceSourceId: this.sourceId },
      };
      this.spans.push(span);
      return span.spanId;
    } catch {
      return undefined;
    }
  }
  async flush(store: EventStore, sessionId: string) {
    try {
      await store.traces.put({
        id: `${sessionId}:${this.sourceId}`,
        sessionId,
        spans: structuredClone(this.spans),
        dropped: this.dropped,
      });
    } catch {
      /* Diagnostics never govern acceptance. */
    }
  }
}
