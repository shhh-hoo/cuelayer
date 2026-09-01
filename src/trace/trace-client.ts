import type { DurableTraceEvent, DurableTraceEventDraft } from "./durable-trace";

export type TraceTransport = {
  append(sessionId: string, events: DurableTraceEventDraft[]): Promise<DurableTraceEvent[]>;
  load(sessionId: string): Promise<DurableTraceEvent[]>;
  recent(): Promise<string[]>;
};

export function createHttpTraceTransport(endpoint = "/api/trace"): TraceTransport {
  return {
    async append(sessionId, events) {
      if (!events.length) return [];
      const response = await fetch(`${endpoint}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sessionId, events }),
        keepalive: true,
      });
      const body = await response.json().catch(() => ({})) as { events?: DurableTraceEvent[]; error?: string };
      if (!response.ok || !body.events) throw new Error(body.error ?? "trace-append-failed");
      return body.events;
    },
    async load(sessionId) {
      const response = await fetch(`${endpoint}/session?sessionId=${encodeURIComponent(sessionId)}`, { headers: { Accept: "application/json" } });
      const body = await response.json().catch(() => ({})) as { events?: DurableTraceEvent[]; error?: string };
      if (!response.ok || !body.events) throw new Error(body.error ?? "trace-load-failed");
      return body.events;
    },
    async recent() {
      const response = await fetch(`${endpoint}/session`, { headers: { Accept: "application/json" } });
      const body = await response.json().catch(() => ({})) as { recentSessionIds?: string[]; error?: string };
      if (!response.ok || !body.recentSessionIds) throw new Error(body.error ?? "trace-recent-failed");
      return body.recentSessionIds;
    },
  };
}
