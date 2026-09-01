import type { PlannerInput } from "./contracts";

export type SemanticPlanner = {
  decide(input: PlannerInput, options?: { signal?: AbortSignal }): Promise<unknown>;
};

type PlannerResponse = { decision?: unknown; error?: string };

/** Browser code knows the product input/output boundary, never provider response objects. */
export function createHttpSemanticPlanner(endpoint = "/api/planner/decision"): SemanticPlanner {
  return {
    async decide(input, options) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(input),
        signal: options?.signal,
      });
      const body = await response.json().catch(() => ({})) as PlannerResponse;
      if (!response.ok || !body.decision) throw new Error(body.error ?? "Planner is temporarily unavailable.");
      return body.decision;
    },
  };
}
