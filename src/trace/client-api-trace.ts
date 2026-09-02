import type { DurableTraceEventDraft } from "./durable-trace";

export function deliverTraceWithoutBlocking(callback: ((events: DurableTraceEventDraft[]) => Promise<unknown> | unknown) | undefined, events: DurableTraceEventDraft[]) {
  if (!callback || !events.length) return;
  try { void Promise.resolve(callback(events)).catch(() => undefined); } catch { /* Observability cannot fail the product path. */ }
}

export function clientApiTraceEvent(options: {
  pageInstanceId: string;
  apiRequestId: string;
  plannerRequestId?: string;
  outcome: "started" | "aborted" | "timed_out" | "failed";
  reason?: string;
}): DurableTraceEventDraft {
  const { pageInstanceId, apiRequestId, plannerRequestId, outcome, reason } = options;
  return {
    id: `${apiRequestId}:browser-${outcome}`,
    occurredAt: new Date().toISOString(),
    stage: "api",
    type: outcome === "started" ? "api_call.client_started" : `api_call.${outcome}`,
    correlation: { apiRequestId, plannerRequestId },
    payload: { status: outcome, reason, delivery: "browser_local_fact" },
    source: "browser",
    sourceInstanceId: pageInstanceId,
  };
}
