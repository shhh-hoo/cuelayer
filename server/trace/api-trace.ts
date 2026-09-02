import { randomUUID } from "node:crypto";
import { prepareDurableTraceEvent, type DurableTraceEventDraft, type TraceCorrelation } from "../../src/trace/durable-trace.ts";

type ExternalCallOptions<Result> = {
  sessionId: string;
  apiRequestId?: string;
  provider: string;
  model?: string;
  operation: string;
  requestPayload: unknown;
  correlation?: TraceCorrelation;
  signal?: AbortSignal;
  retries?: number;
  responsePayload(result: Result): unknown;
};

export type TraceDelivery = { events: DurableTraceEventDraft[] };

export type TracedExternalCallResult<Result> = { result: Result; traceDelivery: TraceDelivery };

export class TracedExternalCallError extends Error {
  readonly providerError: unknown;
  readonly traceDelivery: TraceDelivery;

  constructor(providerError: unknown, traceDelivery: TraceDelivery) {
    super(providerError instanceof Error ? providerError.message : "external-api-call-failed");
    this.name = "TracedExternalCallError";
    this.providerError = providerError;
    this.traceDelivery = traceDelivery;
  }
}

function eventId(apiRequestId: string, phase: string) {
  return `server:${apiRequestId}:${phase}`;
}

function safeError(error: unknown) {
  const value = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; status?: unknown; message?: unknown } : undefined;
  return {
    name: typeof value?.name === "string" ? value.name : "Error",
    code: typeof value?.code === "string" && /^[a-z0-9_-]{1,80}$/i.test(value.code) ? value.code : undefined,
    status: typeof value?.status === "number" ? value.status : undefined,
    message: typeof value?.message === "string" ? value.message : "external-api-call-failed",
  };
}

function sanitizedDraft(sessionId: string, draft: DurableTraceEventDraft): DurableTraceEventDraft {
  const event = prepareDurableTraceEvent(sessionId, draft);
  const { sessionId: _sessionId, schemaVersion: _schemaVersion, ingestedAt: _ingestedAt, ...sanitized } = event;
  return sanitized;
}

export function traceHeaders(request: { headers?: Record<string, string | string[] | undefined> }) {
  const header = (name: string) => {
    const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    sessionId: header("x-cuelayer-session-id"),
    apiRequestId: header("x-cuelayer-api-request-id"),
    plannerRequestId: header("x-cuelayer-planner-request-id"),
  };
}

/**
 * Records factual provider boundaries for the browser's local durable trace.
 */
export async function traceExternalCall<Result>(options: ExternalCallOptions<Result>, call: () => Promise<Result>): Promise<TracedExternalCallResult<Result>> {
  const apiRequestId = options.apiRequestId || randomUUID();
  const correlation = { ...options.correlation, apiRequestId };
  const startedAt = Date.now();
  const sourceInstanceId = `server:${apiRequestId}`;
  const facts: DurableTraceEventDraft[] = [];
  const deliver = (draft: DurableTraceEventDraft) => { facts.push(sanitizedDraft(options.sessionId, draft)); };
  const delivery = (): TraceDelivery => ({ events: facts });

  deliver({
    id: eventId(apiRequestId, "started"),
    occurredAt: new Date(startedAt).toISOString(),
    stage: "api",
    type: "api_call.started",
    correlation,
    payload: { provider: options.provider, model: options.model, operation: options.operation, request: options.requestPayload, retries: options.retries ?? 0 },
    source: "server",
    sourceInstanceId,
    sourceSeq: 1,
  });

  try {
    const result = await call();
    const finishedAt = Date.now();
    deliver({
      id: eventId(apiRequestId, "completed"),
      occurredAt: new Date(finishedAt).toISOString(),
      stage: "api",
      type: "api_call.completed",
      correlation,
      payload: { provider: options.provider, model: options.model, operation: options.operation, status: "completed", latencyMs: finishedAt - startedAt, retries: options.retries ?? 0, response: options.responsePayload(result) },
      source: "server",
      sourceInstanceId,
      sourceSeq: 2,
    });
    return { result, traceDelivery: delivery() };
  } catch (error) {
    const finishedAt = Date.now();
    const aborted = options.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    const abortReason = aborted ? String(options.signal?.reason ?? "aborted") : undefined;
    const outcome = aborted && /timeout/i.test(abortReason ?? "") ? "timed_out" : aborted ? "aborted" : "failed";
    deliver({
      id: eventId(apiRequestId, outcome),
      occurredAt: new Date(finishedAt).toISOString(),
      stage: "api",
      type: `api_call.${outcome}`,
      correlation,
      payload: { provider: options.provider, model: options.model, operation: options.operation, status: outcome, latencyMs: finishedAt - startedAt, retries: options.retries ?? 0, error: safeError(error), abortReason },
      source: "server",
      sourceInstanceId,
      sourceSeq: 2,
    });
    throw new TracedExternalCallError(error, delivery());
  }
}
