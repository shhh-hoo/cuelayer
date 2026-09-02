import OpenAI from "openai";
import type { TeachingInterpretationProposal, TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";
import { normalizeTeachingProposal, teachingResponseRequest } from "./provider-contract.ts";

export type TeachingProviderUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TeachingProviderResult = { proposal: TeachingInterpretationProposal; usage?: TeachingProviderUsage; serviceTier?: string };

export function estimateTeachingCost(usage: TeachingProviderUsage | undefined, rates: { inputPerMillion?: number; cachedInputPerMillion?: number; outputPerMillion?: number }) {
  if (!usage || rates.inputPerMillion === undefined || rates.cachedInputPerMillion === undefined || rates.outputPerMillion === undefined) return undefined;
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (uncachedInput * rates.inputPerMillion + usage.cachedInputTokens * rates.cachedInputPerMillion + usage.outputTokens * rates.outputPerMillion) / 1_000_000;
}

function normalizeUsage(usage: unknown): TeachingProviderUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = usage as { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } };
  if (typeof value.input_tokens !== "number" || typeof value.output_tokens !== "number") return undefined;
  return {
    inputTokens: value.input_tokens,
    cachedInputTokens: typeof value.input_tokens_details?.cached_tokens === "number" ? value.input_tokens_details.cached_tokens : 0,
    outputTokens: value.output_tokens,
    totalTokens: typeof value.total_tokens === "number" ? value.total_tokens : value.input_tokens + value.output_tokens,
  };
}

export async function requestOpenAITeachingInterpretation(
  input: TeachingInterpretationRequest,
  apiKey: string,
  model: string,
  options?: { signal?: AbortSignal; serviceTier?: "default" | "priority" },
): Promise<TeachingProviderResult> {
  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({ model, ...teachingResponseRequest(input), ...(options?.serviceTier ? { service_tier: options.serviceTier } : {}) }, { signal: options?.signal });
  if (!response.output_parsed) throw new Error("teaching-interpretation-empty-response");
  return {
    proposal: normalizeTeachingProposal(response.output_parsed),
    usage: normalizeUsage(response.usage),
    ...(typeof response.service_tier === "string" ? { serviceTier: response.service_tier } : {}),
  };
}
