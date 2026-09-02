import OpenAI from "openai";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts.ts";
import { normalizeProviderUsage, normalizeRuntimeDecision, plannerResponseRequest, type PlannerProviderResult } from "./provider-contract.ts";

export type OpenAIPlannerRequestOptions = { signal?: AbortSignal; serviceTier?: "default" | "priority" };

/** OpenAI Responses structured output transport; CueLayer semantics remain in the shared contract. */
export async function requestOpenAIPlannerResult(input: PlannerInput, apiKey: string, model: string, options?: OpenAIPlannerRequestOptions): Promise<PlannerProviderResult> {
  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({ model, ...plannerResponseRequest(input), ...(options?.serviceTier ? { service_tier: options.serviceTier } : {}) }, { signal: options?.signal });
  if (!response.output_parsed) throw new Error("planner-empty-response");
  return { decision: normalizeRuntimeDecision(response.output_parsed), usage: normalizeProviderUsage(response.usage), ...(typeof response.service_tier === "string" ? { serviceTier: response.service_tier } : {}) };
}

export async function requestOpenAIPlannerDecision(input: PlannerInput, apiKey: string, model: string, options?: OpenAIPlannerRequestOptions): Promise<RuntimeDecision> {
  return (await requestOpenAIPlannerResult(input, apiKey, model, options)).decision;
}
