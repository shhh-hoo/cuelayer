import type { TeachingInterpretationProposal, TeachingInterpretationRequest } from "./contracts";

export type TeachingInterpretationResponse = {
  proposal: TeachingInterpretationProposal;
  usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number };
  estimatedCostUsd?: number;
  serviceTier?: string;
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
      const body = await response.json().catch(() => ({})) as Partial<TeachingInterpretationResponse> & { error?: string };
      if (!response.ok || !body.proposal) throw new Error(body.error ?? "Teaching interpretation is temporarily unavailable.");
      return body as TeachingInterpretationResponse;
    },
  };
}
