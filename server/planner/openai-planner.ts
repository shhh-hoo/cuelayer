import OpenAI from "openai";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts.ts";
import { normalizeProviderUsage, normalizeRuntimeDecision, plannerResponseRequest, type PlannerProviderResult } from "./provider-contract.ts";

export type OpenAIPlannerRequestOptions = { signal?: AbortSignal; serviceTier?: "default" | "priority" };

export function createOpenAIPlannerRequest(input: PlannerInput, model: string, options?: OpenAIPlannerRequestOptions) {
  return plannerResponseRequest(input, model, options);
}

/** OpenAI Responses structured output transport; CueLayer semantics remain in the shared contract. */
export async function requestOpenAIPlannerResult(request: ReturnType<typeof createOpenAIPlannerRequest>, apiKey: string, options?: Pick<OpenAIPlannerRequestOptions, "signal">): Promise<PlannerProviderResult> {
  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse(request, { signal: options?.signal });
  if (!response.output_parsed) throw new Error("planner-empty-response");
  return {
    decision: normalizeRuntimeDecision(response.output_parsed),
    usage: normalizeProviderUsage(response.usage),
    ...(typeof response.service_tier === "string" ? { serviceTier: response.service_tier } : {}),
    providerResponse: {
      ...(typeof response.id === "string" ? { id: response.id } : {}),
      ...(typeof response.model === "string" ? { model: response.model } : {}),
      ...(typeof response.service_tier === "string" ? { service_tier: response.service_tier } : {}),
      output_parsed: response.output_parsed,
      ...(response.usage === undefined ? {} : { usage: response.usage }),
    },
  };
}

export async function requestOpenAIPlannerDecision(input: PlannerInput, apiKey: string, model: string, options?: OpenAIPlannerRequestOptions): Promise<RuntimeDecision> {
  return (await requestOpenAIPlannerResult(createOpenAIPlannerRequest(input, model, options), apiKey, options)).decision;
}
