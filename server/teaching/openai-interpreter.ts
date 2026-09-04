import OpenAI from "openai";
import type { TeachingInterpretationProposal, TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";
import { auditDigest } from "../../src/trace/audit.ts";
import { normalizeTeachingProposal, teachingProviderContract, teachingResponseRequest } from "./provider-contract.ts";

export type TeachingProviderUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TeachingProviderAudit = {
  providerContract: {
    requestedModel: string;
    serviceTier?: string;
    temperature: number;
    reasoningEffort: string;
    maxOutputTokens: number;
    policyVersion: string;
    systemPolicy: string;
    systemPolicyDigest: string;
    structuredOutputSchema: unknown;
    structuredOutputSchemaDigest: string;
    providerContractDigest: string;
  };
  providerRequest: unknown;
  domainRequestDigest: string;
  providerResponse: { providerResponseId?: string; providerModel?: string; serviceTier?: string; usage?: TeachingProviderUsage; rawStructuredOutput: unknown; rawStructuredOutputDigest: string; outputText?: string; status?: string; incompleteDetails?: unknown };
  normalizedProposalDigest: string;
};
export type TeachingProviderFailureAudit = Pick<TeachingProviderAudit, "providerContract" | "providerRequest" | "domainRequestDigest"> & { failureStage: "provider_error" | "structured_parse_error" | "normalization_error" };
export type TeachingProviderResult = { proposal: TeachingInterpretationProposal; usage?: TeachingProviderUsage; serviceTier?: string; audit: TeachingProviderAudit };

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
  const request = { model, ...teachingResponseRequest(input), ...(options?.serviceTier ? { service_tier: options.serviceTier } : {}) };
  const contract = teachingProviderContract();
  const structuredOutputSchema = contract.text.format;
  const contractFact = { model, ...(options?.serviceTier ? { serviceTier: options.serviceTier } : {}), reasoning: contract.reasoning, temperature: contract.temperature, maxOutputTokens: contract.max_output_tokens, systemPolicy: contract.systemPolicy, structuredOutputSchema };
  const providerContract = {
    requestedModel: model,
    ...(options?.serviceTier ? { serviceTier: options.serviceTier } : {}),
    temperature: contract.temperature,
    reasoningEffort: contract.reasoning.effort,
    maxOutputTokens: contract.max_output_tokens,
    policyVersion: input.policyVersion,
    systemPolicy: contract.systemPolicy,
    systemPolicyDigest: auditDigest(contract.systemPolicy),
    structuredOutputSchema,
    structuredOutputSchemaDigest: auditDigest(structuredOutputSchema),
    providerContractDigest: auditDigest(contractFact),
  };
  const knownAudit = { providerContract, providerRequest: request, domainRequestDigest: auditDigest(input) };
  let response: Awaited<ReturnType<typeof client.responses.parse>>;
  try {
    response = await client.responses.parse(request, { signal: options?.signal });
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("teaching-provider-unavailable"), { audit: { ...knownAudit, failureStage: "provider_error" } satisfies TeachingProviderFailureAudit });
  }
  if (!response.output_parsed) throw Object.assign(new Error("teaching-interpretation-empty-response"), { audit: { ...knownAudit, failureStage: "structured_parse_error" } satisfies TeachingProviderFailureAudit });
  const rawStructuredOutput = response.output_parsed;
  let proposal: TeachingInterpretationProposal;
  try { proposal = normalizeTeachingProposal(rawStructuredOutput); } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("teaching-normalization-failed"), { audit: { ...knownAudit, failureStage: "normalization_error" } satisfies TeachingProviderFailureAudit });
  }
  const responseValue = response as unknown as { id?: unknown; model?: unknown; service_tier?: unknown; output_text?: unknown; status?: unknown; incomplete_details?: unknown };
  const usage = normalizeUsage(response.usage);
  const responseAudit = {
    ...(typeof responseValue.id === "string" ? { providerResponseId: responseValue.id } : {}),
    ...(typeof responseValue.model === "string" ? { providerModel: responseValue.model } : {}),
    ...(typeof responseValue.service_tier === "string" ? { serviceTier: responseValue.service_tier } : {}),
    ...(usage ? { usage } : {}),
    rawStructuredOutput,
    rawStructuredOutputDigest: auditDigest(rawStructuredOutput),
    ...(typeof responseValue.output_text === "string" ? { outputText: responseValue.output_text } : {}),
    ...(typeof responseValue.status === "string" ? { status: responseValue.status } : {}),
    ...(responseValue.incomplete_details !== undefined ? { incompleteDetails: responseValue.incomplete_details } : {}),
  };
  return {
    proposal,
    usage,
    ...(typeof response.service_tier === "string" ? { serviceTier: response.service_tier } : {}),
    audit: { ...knownAudit, providerResponse: responseAudit, normalizedProposalDigest: auditDigest(proposal) },
  };
}
