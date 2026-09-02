import type { DurableTraceEvent, DurableTraceEventDraft } from "./durable-trace";

export type TraceCapabilities = { writeCapability: string; readCapability: string };
export type TraceProvisioning = { created: boolean };
export type TracePage = { events: DurableTraceEvent[]; nextCursor?: string };
export type TraceFailureKind = "transient" | "authorization" | "conflict" | "invalid_request";

/** A transport failure whose recovery policy is safe to decide in the browser. */
export class TraceTransportError extends Error {
  constructor(message: string, readonly kind: TraceFailureKind, readonly status?: number) { super(message); this.name = "TraceTransportError"; }
}

export function traceFailureKind(error: unknown): TraceFailureKind {
  if (error instanceof TraceTransportError) return error.kind;
  if (error instanceof Error && error.message === "trace-session-capability-conflict") return "conflict";
  return "transient";
}

function failure(response: Response, error: string | undefined, fallback: string) {
  const message = error ?? fallback;
  const kind: TraceFailureKind = message === "trace-session-capability-conflict" || response.status === 409
    ? "conflict"
    : response.status === 403
      ? "authorization"
      : response.status >= 400 && response.status < 500
        ? "invalid_request"
        : "transient";
  return new TraceTransportError(message, kind, response.status);
}
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
      if (!response.ok || typeof body.created !== "boolean") throw failure(response, body.error, "trace-session-create-failed");
      return { created: body.created };
    },
    async append(sessionId, writeCapability, events) {
      if (!events.length) return [];
      const response = await fetch(`${endpoint}/events`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-CueLayer-Trace-Write-Capability": writeCapability }, body: JSON.stringify({ sessionId, events }), keepalive: true });
      const body = await response.json().catch(() => ({})) as { events?: DurableTraceEvent[]; error?: string };
      if (!response.ok || !body.events) throw failure(response, body.error, "trace-append-failed");
      return body.events;
    },
    async load(sessionId, readCapability, after) {
      const query = new URLSearchParams({ sessionId, limit: "250", ...(after ? { after } : {}) });
      const response = await fetch(`${endpoint}/session?${query}`, { headers: { Accept: "application/json", "X-CueLayer-Trace-Read-Capability": readCapability } });
      const body = await response.json().catch(() => ({})) as TracePage & { error?: string };
      if (!response.ok || !body.events) throw failure(response, body.error, "trace-load-failed");
      return { events: body.events, nextCursor: body.nextCursor };
    },
  };
}
