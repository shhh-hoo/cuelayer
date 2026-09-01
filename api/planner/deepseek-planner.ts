import OpenAI from "openai";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts.ts";
import { normalizeProviderUsage, normalizeRuntimeDecision, plannerResponseRequest, type PlannerProviderResult } from "./provider-contract.ts";

/** DeepSeek's OpenAI-compatible Responses API keeps transport and structured parsing in one call. */
export async function requestDeepSeekPlannerResult(input: PlannerInput, apiKey: string, model: string, options?: { signal?: AbortSignal }): Promise<PlannerProviderResult> {
  const client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
  const response = await client.responses.parse({
    model,
    ...plannerResponseRequest(input),
  }, { signal: options?.signal });
  if (!response.output_parsed) throw new Error("planner-empty-response");
  return { decision: normalizeRuntimeDecision(response.output_parsed), usage: normalizeProviderUsage(response.usage) };
}

export async function requestDeepSeekPlannerDecision(input: PlannerInput, apiKey: string, model: string, options?: { signal?: AbortSignal }): Promise<RuntimeDecision> {
  return (await requestDeepSeekPlannerResult(input, apiKey, model, options)).decision;
}

/** Development-safe classification: never echo provider messages, headers, or credential fragments. */
export function deepSeekPlannerFailureReason(error: unknown): string {
  const value = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; message?: unknown } : undefined;
  if (typeof value?.message === "string" && value.message.includes("invalid structured output JSON")) return "planner-invalid-structured-output";
  if (value?.message === "planner-empty-response") return "planner-empty-response";
  if (typeof value?.status === "number") return `planner-provider-http-${value.status}`;
  if (typeof value?.code === "string" && /^[a-z0-9_-]{1,80}$/i.test(value.code)) return `planner-provider-${value.code}`;
  return "planner-provider-unavailable";
}
