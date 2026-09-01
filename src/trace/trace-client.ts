import type { DurableTraceEvent, DurableTraceEventDraft } from "./durable-trace";

export type TraceCapabilities = { writeCapability: string; readCapability: string };
export type TraceProvisioning = { created: boolean };
export type TracePage = { events: DurableTraceEvent[]; nextCursor?: string };
export type TraceTransport = {
  createSession(sessionId: string, capabilities: TraceCapabilities, metadata: unknown): Promise<TraceProvisioning>;
  append(sessionId: string, writeCapability: string, events: DurableTraceEventDraft[]): Promise<DurableTraceEvent[]>;
  load(sessionId: string, readCapability: string, after?: string): Promise<TracePage>;
};

export function createHttpTraceTransport(endpoint = "/api/trace"): TraceTransport {
  return {
    async createSession(sessionId, capabilities, metadata) {
      const response = await fetch(`${endpoint}/session`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sessionId, ...capabilities, ...(metadata as object) }) });
      const body = await response.json().catch(() => ({})) as Partial<TraceProvisioning> & { error?: string };
      if (!response.ok || typeof body.created !== "boolean") throw new Error(body.error ?? "trace-session-create-failed");
      return { created: body.created };
    },
    async append(sessionId, writeCapability, events) {
      if (!events.length) return [];
      const response = await fetch(`${endpoint}/events`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-CueLayer-Trace-Write-Capability": writeCapability }, body: JSON.stringify({ sessionId, events }), keepalive: true });
      const body = await response.json().catch(() => ({})) as { events?: DurableTraceEvent[]; error?: string };
      if (!response.ok || !body.events) throw new Error(body.error ?? "trace-append-failed");
      return body.events;
    },
    async load(sessionId, readCapability, after) {
      const query = new URLSearchParams({ sessionId, limit: "250", ...(after ? { after } : {}) });
      const response = await fetch(`${endpoint}/session?${query}`, { headers: { Accept: "application/json", "X-CueLayer-Trace-Read-Capability": readCapability } });
      const body = await response.json().catch(() => ({})) as TracePage & { error?: string };
      if (!response.ok || !body.events) throw new Error(body.error ?? "trace-load-failed");
      return { events: body.events, nextCursor: body.nextCursor };
    },
  };
}
