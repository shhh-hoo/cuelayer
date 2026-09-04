import type { TeachingInterpretationProposal, TeachingInterpretationRequest } from "./contracts";

export type TeachingInterpretationAudit = {
  providerContract: { requestedModel: string; serviceTier?: string; temperature: number; reasoningEffort: string; maxOutputTokens: number; policyVersion: string; systemPolicy: string; systemPolicyDigest: string; structuredOutputSchema: unknown; structuredOutputSchemaDigest: string; providerContractDigest: string };
  providerRequest: unknown;
  domainRequestDigest: string;
  providerResponse: { providerResponseId?: string; providerModel?: string; serviceTier?: string; usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number }; rawStructuredOutput: unknown; rawStructuredOutputDigest: string; outputText?: string; status?: string; incompleteDetails?: unknown };
  normalizedProposalDigest: string;
};

export type TeachingInterpretationResponse = {
  proposal: TeachingInterpretationProposal;
  usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCostUsd?: number;
  serviceTier?: string;
  audit?: TeachingInterpretationAudit;
};

export type TeachingInterpreter = {
  interpret(request: TeachingInterpretationRequest, options?: { signal?: AbortSignal }): Promise<TeachingInterpretationResponse>;
};

export function createHttpTeachingInterpreter(endpoint = "/api/teaching/interpretation"): TeachingInterpreter {
  return {
    async interpret(request, options) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
        signal: options?.signal,
      });
      const body = await response.json().catch(() => ({})) as Partial<TeachingInterpretationResponse> & { error?: string; audit?: unknown };
      if (!response.ok || !body.proposal) {
        const error = Object.assign(new Error(body.error ?? "Teaching interpretation is temporarily unavailable."), { audit: body.audit });
        throw error;
      }
      return body as TeachingInterpretationResponse;
    },
  };
}
