import type { JsonValue } from "../trace/audit";

export type TeachingProviderUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number };

export type ProviderContractSnapshot = {
  requestedModel: string;
  serviceTier?: string;
  temperature?: number;
  reasoningEffort: string;
  maxOutputTokens: number;
  policyVersion: string;
  semanticProfileId: string;
  systemPolicy: string;
  systemPolicyDigest: string;
  structuredOutputSchema: JsonValue;
  structuredOutputSchemaDigest: string;
  providerContractDigest: string;
};

export type ProviderRequestEnvelope = {
  model: string;
  service_tier?: string;
  reasoning: { effort: string };
  temperature?: number;
  max_output_tokens: number;
  input: Array<{ role: "system" | "user"; content: string }>;
  text: { format: JsonValue };
};

export type ProviderResponseSnapshot = {
  providerResponseId?: string;
  providerModel?: string;
  serviceTier?: string;
  usage?: TeachingProviderUsage;
  outputText?: string;
  rawStructuredOutput?: JsonValue;
  rawStructuredOutputDigest?: string;
  status?: string;
  incompleteDetails?: { reason?: string };
  providerResponseDigest: string;
};

export type TeachingProviderAudit = {
  providerContract: ProviderContractSnapshot;
  providerRequest: ProviderRequestEnvelope;
  providerRequestDigest: string;
  domainRequestDigest: string;
  providerResponse: ProviderResponseSnapshot;
  normalizedProposalDigest: string;
};

export type TeachingProviderFailureAudit = {
  providerContract: ProviderContractSnapshot;
  providerRequest: ProviderRequestEnvelope;
  providerRequestDigest: string;
  domainRequestDigest: string;
  providerResponse?: ProviderResponseSnapshot;
  failureStage: "provider_error" | "structured_parse_error" | "normalization_error";
};
