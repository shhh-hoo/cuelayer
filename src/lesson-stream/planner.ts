import type { TeachingInterpretationProposal, TeachingInterpretationRequest } from "./contracts";
import type { TeachingProviderAudit, TeachingProviderFailureAudit } from "./audit-contracts";
export type { TeachingProviderAudit as TeachingInterpretationAudit } from "./audit-contracts";

export type TeachingInterpretationResponse = {
  proposal: TeachingInterpretationProposal;
  usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCostUsd?: number;
  serviceTier?: string;
  audit?: TeachingProviderAudit;
};

export type TeachingInterpreter = {
  interpret(request: TeachingInterpretationRequest, options?: { signal?: AbortSignal }): Promise<TeachingInterpretationResponse>;
};

export class TeachingInterpreterError extends Error {
  constructor(message: string, readonly audit?: TeachingProviderFailureAudit) { super(message); }
}

export function createHttpTeachingInterpreter(endpoint = "/api/teaching/interpretation"): TeachingInterpreter {
  return {
    async interpret(request, options) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(request),
        signal: options?.signal,
      });
      const body = await response.json().catch(() => ({})) as Partial<TeachingInterpretationResponse> & { error?: string; audit?: TeachingProviderFailureAudit };
      if (!response.ok || !body.proposal) {
        throw new TeachingInterpreterError(body.error ?? "Teaching interpretation is temporarily unavailable.", body.audit);
      }
      return body as TeachingInterpretationResponse;
    },
  };
}
