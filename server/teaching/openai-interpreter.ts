import OpenAI from "openai";
import type { TeachingInterpretationProposal, TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";
import type { JsonValue } from "../../src/trace/audit.ts";
import { persistedAuditDigest } from "../../src/trace/audit.ts";
import type { TeachingProviderAudit, TeachingProviderFailureAudit, TeachingProviderUsage, ProviderRequestEnvelope, ProviderResponseSnapshot } from "../../src/lesson-stream/audit-contracts.ts";
import { ACTIVE_ALPHA_SEMANTIC_PROFILE, type AlphaSemanticProfile } from "../../src/lesson-stream/semantic-profile.ts";
import { createTeachingInterpretationSchema, normalizeTeachingProposal, teachingProviderContract, teachingResponseRequest } from "./provider-contract.ts";

export type { TeachingProviderAudit, TeachingProviderFailureAudit, TeachingProviderUsage } from "../../src/lesson-stream/audit-contracts.ts";
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

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function safeResponseFact(response: { id?: string; model?: string; service_tier?: string | null; usage?: unknown; output_text?: string; status?: string; incomplete_details?: { reason?: string | null } | null }): Omit<ProviderResponseSnapshot, "providerResponseDigest"> {
  const snapshot = {
    ...(response.id ? { providerResponseId: response.id } : {}),
    ...(response.model ? { providerModel: response.model } : {}),
    ...(response.service_tier ? { serviceTier: response.service_tier } : {}),
    ...(normalizeUsage(response.usage) ? { usage: normalizeUsage(response.usage) } : {}),
    ...(response.output_text ? { outputText: response.output_text } : {}),
    ...(response.status ? { status: response.status } : {}),
    ...(response.incomplete_details?.reason ? { incompleteDetails: { reason: response.incomplete_details.reason } } : {}),
  };
  return snapshot;
}

function providerResponseSnapshot(fact: Omit<ProviderResponseSnapshot, "providerResponseDigest">): ProviderResponseSnapshot {
  return { ...fact, providerResponseDigest: persistedAuditDigest(fact) };
}

export async function requestOpenAITeachingInterpretation(
  input: TeachingInterpretationRequest,
  apiKey: string,
  model: string,
  options?: { signal?: AbortSignal; serviceTier?: "default" | "priority"; profile?: AlphaSemanticProfile },
): Promise<TeachingProviderResult> {
  const profile = options?.profile ?? ACTIVE_ALPHA_SEMANTIC_PROFILE;
  const client = new OpenAI({ apiKey });
  const request = { model, ...teachingResponseRequest(input, profile), ...(options?.serviceTier ? { service_tier: options.serviceTier } : {}) };
  const providerRequest: ProviderRequestEnvelope = {
    model: request.model,
    ...(request.service_tier ? { service_tier: request.service_tier } : {}),
    reasoning: request.reasoning,
    max_output_tokens: request.max_output_tokens,
    input: request.input.map((item) => ({ role: item.role, content: item.content })),
    text: { format: jsonValue(request.text.format) },
  };
  const contract = teachingProviderContract(profile);
  const structuredOutputSchema = providerRequest.text.format;
  const contractFact = { model, ...(options?.serviceTier ? { serviceTier: options.serviceTier } : {}), semanticProfileId: profile.id, policyVersion: profile.policyVersion, reasoning: contract.reasoning, maxOutputTokens: contract.max_output_tokens, systemPolicy: contract.systemPolicy, structuredOutputSchema };
  const providerContract = {
    requestedModel: model,
    ...(options?.serviceTier ? { serviceTier: options.serviceTier } : {}),
    reasoningEffort: contract.reasoning.effort,
    maxOutputTokens: contract.max_output_tokens,
    policyVersion: input.policyVersion,
    semanticProfileId: profile.id,
    systemPolicy: contract.systemPolicy,
    systemPolicyDigest: persistedAuditDigest(contract.systemPolicy),
    structuredOutputSchema,
    structuredOutputSchemaDigest: persistedAuditDigest(structuredOutputSchema),
    providerContractDigest: persistedAuditDigest(contractFact),
  };
  const knownAudit = { providerContract, providerRequest, providerRequestDigest: persistedAuditDigest(providerRequest), domainRequestDigest: persistedAuditDigest(input) };
  let response: Awaited<ReturnType<typeof client.responses.create>>;
  try {
    response = await client.responses.create(request, { signal: options?.signal });
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("teaching-provider-unavailable"), { audit: { ...knownAudit, failureStage: "provider_error" } satisfies TeachingProviderFailureAudit });
  }
  const responseFact = safeResponseFact(response);
  const responseAudit = providerResponseSnapshot(responseFact);
  let rawStructuredOutput: JsonValue;
  try {
    rawStructuredOutput = jsonValue(JSON.parse(response.output_text));
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error("teaching-interpretation-structured-parse-failed"), { audit: { ...knownAudit, providerResponse: responseAudit, failureStage: "structured_parse_error" } satisfies TeachingProviderFailureAudit });
  }
  const parsed = createTeachingInterpretationSchema(profile, input.newEvidence.map((item) => item.checkpointId)).safeParse(rawStructuredOutput);
  if (!parsed.success) {
    const rawStructuredOutputDigest = persistedAuditDigest(rawStructuredOutput);
    throw Object.assign(new Error("teaching-interpretation-structured-parse-failed"), { audit: { ...knownAudit, providerResponse: providerResponseSnapshot({ ...responseFact, rawStructuredOutput, rawStructuredOutputDigest }), failureStage: "structured_parse_error" } satisfies TeachingProviderFailureAudit });
  }
  let proposal: TeachingInterpretationProposal;
  try { proposal = normalizeTeachingProposal(parsed.data, input); } catch (error) {
    const responseWithRaw = { ...responseFact, rawStructuredOutput, rawStructuredOutputDigest: persistedAuditDigest(rawStructuredOutput) };
    throw Object.assign(error instanceof Error ? error : new Error("teaching-normalization-failed"), { audit: { ...knownAudit, providerResponse: providerResponseSnapshot(responseWithRaw), failureStage: "normalization_error" } satisfies TeachingProviderFailureAudit });
  }
  const rawStructuredOutputDigest = persistedAuditDigest(rawStructuredOutput);
  const responseWithRaw = { ...responseFact, rawStructuredOutput, rawStructuredOutputDigest };
  const safeProviderResponse = providerResponseSnapshot(responseWithRaw);
  const usage = safeProviderResponse.usage;
  return {
    proposal,
    usage,
    ...(typeof response.service_tier === "string" ? { serviceTier: response.service_tier } : {}),
    audit: { ...knownAudit, providerResponse: safeProviderResponse, normalizedProposalDigest: persistedAuditDigest(proposal) },
  };
}
