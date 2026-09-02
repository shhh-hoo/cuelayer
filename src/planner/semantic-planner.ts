import type { PlannerInput } from "./contracts";
import type { DurableTraceEventDraft } from "../trace/durable-trace";

export type SemanticPlanner = {
  decide(input: PlannerInput, options?: { signal?: AbortSignal; traceSessionId?: string; apiRequestId?: string; plannerRequestId?: number; onTraceEvents?(events: DurableTraceEventDraft[]): Promise<unknown> | unknown }): Promise<unknown>;
};

type PlannerResponse = { decision?: unknown; error?: string; traceEvents?: DurableTraceEventDraft[] };

/** Browser code knows the product input/output boundary, never provider response objects. */
export function createHttpSemanticPlanner(endpoint = "/api/planner/decision"): SemanticPlanner {
  return {
    async decide(input, options) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(options?.traceSessionId ? { "X-CueLayer-Session-Id": options.traceSessionId } : {}),
          ...(options?.apiRequestId ? { "X-CueLayer-Api-Request-Id": options.apiRequestId } : {}),
          ...(options?.plannerRequestId === undefined ? {} : { "X-CueLayer-Planner-Request-Id": String(options.plannerRequestId) }),
        },
        body: JSON.stringify(input),
        signal: options?.signal,
      });
      const body = await response.json().catch(() => ({})) as PlannerResponse;
      if (body.traceEvents?.length) await options?.onTraceEvents?.(body.traceEvents);
      if (!response.ok || !body.decision) throw new Error(body.error ?? "Planner is temporarily unavailable.");
      return body.decision;
    },
  };
}
