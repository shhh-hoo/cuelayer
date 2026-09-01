import { randomUUID } from "node:crypto";
import { appendTraceEvents } from "./trace-store.ts";
import type { TraceCorrelation } from "../../src/trace/durable-trace.ts";

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

export async function traceExternalCall<Result>(options: ExternalCallOptions<Result>, call: () => Promise<Result>): Promise<Result> {
  const apiRequestId = options.apiRequestId || randomUUID();
  const correlation = { ...options.correlation, apiRequestId };
  const startedAt = Date.now();
  await appendTraceEvents(options.sessionId, [{
    id: eventId(apiRequestId, "started"),
    timestamp: new Date(startedAt).toISOString(),
    stage: "api",
    type: "api_call.started",
    correlation,
    payload: { provider: options.provider, model: options.model, operation: options.operation, request: options.requestPayload, retries: options.retries ?? 0 },
    source: "server",
  }]);
  try {
    const result = await call();
    const finishedAt = Date.now();
    await appendTraceEvents(options.sessionId, [{
      id: eventId(apiRequestId, "completed"),
      timestamp: new Date(finishedAt).toISOString(),
      stage: "api",
      type: "api_call.completed",
      correlation,
      payload: { provider: options.provider, model: options.model, operation: options.operation, status: "completed", latencyMs: finishedAt - startedAt, retries: options.retries ?? 0, response: options.responsePayload(result) },
      source: "server",
    }]);
    return result;
  } catch (error) {
    const finishedAt = Date.now();
    const aborted = options.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    const abortReason = aborted ? String(options.signal?.reason ?? "aborted") : undefined;
    const timedOut = aborted && /timeout/i.test(abortReason ?? "");
    const outcome = timedOut ? "timed_out" : aborted ? "aborted" : "failed";
    await appendTraceEvents(options.sessionId, [{
      id: eventId(apiRequestId, outcome),
      timestamp: new Date(finishedAt).toISOString(),
      stage: "api",
      type: `api_call.${outcome}`,
      correlation,
      payload: { provider: options.provider, model: options.model, operation: options.operation, status: outcome, latencyMs: finishedAt - startedAt, retries: options.retries ?? 0, error: safeError(error), abortReason },
      source: "server",
    }]);
    throw error;
  }
}
