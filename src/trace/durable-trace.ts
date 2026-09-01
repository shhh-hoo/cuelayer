export const TRACE_SCHEMA_VERSION = 1;

export type DurableTraceStage =
  | "session"
  | "presentation"
  | "speechmatics"
  | "commit"
  | "canonical"
  | "planner_gate"
  | "api"
  | "planner"
  | "validation"
  | "compiler"
  | "renderer";

export type TraceCorrelation = {
  speechEventId?: string;
  segmentId?: string;
  commitId?: string;
  finalId?: string;
  spanId?: string;
  spanRevision?: number;
  plannerRequestId?: string;
  apiRequestId?: string;
  cueId?: string;
};

export type DurableTraceEvent = {
  id: string;
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  sessionId: string;
  timestamp: string;
  stage: DurableTraceStage;
  type: string;
  correlation?: TraceCorrelation;
  payload: unknown;
  source: "browser" | "server" | "synthetic";
};

export type DurableTraceEventDraft = Omit<DurableTraceEvent, "schemaVersion" | "sessionId">;

const SECRET_KEY = /^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|jwt|cookie|credentials?|password|secret)$/i;
const AUDIO_KEY = /^(?:audio(?:data|frames?|blob|buffer)?|pcm(?:data|frames?|buffer)?|microphone(?:data|frames?)?|recording|waveform|binary|blob|buffer)$/i;
const SECRET_TEXT = /(?:bearer\s+[a-z0-9._~+/=-]+|sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/gi;

function isBinary(value: unknown): boolean {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) || (typeof Blob !== "undefined" && value instanceof Blob);
}

export function sanitizeTracePayload(value: unknown, key = "payload", seen = new WeakSet<object>()): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED_SECRET]";
  if (AUDIO_KEY.test(key)) return "[OMITTED_NON_TEXT_MEDIA]";
  if (typeof value === "string") return value.replace(SECRET_TEXT, "[REDACTED_SECRET]");
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol" || isBinary(value)) return "[OMITTED_NON_TEXT_MEDIA]";
  if (Array.isArray(value)) return value.map((item) => sanitizeTracePayload(item, key, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[OMITTED_CIRCULAR_REFERENCE]";
  seen.add(value);
  const sanitized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const result = sanitizeTracePayload(childValue, childKey, seen);
    if (result !== undefined) sanitized[childKey] = result;
  }
  seen.delete(value);
  return sanitized;
}

export function prepareDurableTraceEvent(sessionId: string, draft: DurableTraceEventDraft): DurableTraceEvent {
  return {
    ...draft,
    schemaVersion: TRACE_SCHEMA_VERSION,
    sessionId,
    timestamp: new Date(draft.timestamp).toISOString(),
    payload: sanitizeTracePayload(draft.payload),
  };
}

export function compareTraceEvents(left: DurableTraceEvent, right: DurableTraceEvent): number {
  return left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id);
}

export function traceEventsToJsonl(events: DurableTraceEvent[]): string {
  return [...events].sort(compareTraceEvents).map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : "");
}
