import { zodTextFormat } from "openai/helpers/zod";
import type { CoreInterpretationBinding } from "../../../src/lesson-stream/core/interpretation-context.ts";
import { CORE_PROPOSAL_VERSION, providerCoreProposalSchema } from "../../../src/lesson-stream/core/interpretation-proposal.ts";
import { CORE_INTERPRETATION_POLICY, CORE_POLICY_VERSION } from "./semantic-policy.ts";

export const CORE_PROVIDER_BUDGET = Object.freeze({ maxEstimatedTokens: 24_000, outputTokens: 8_192, estimate: "ceil-json-characters-divided-by-four" });
export function coreProviderRequest(binding: CoreInterpretationBinding) {
  const request = {
    reasoning: { effort: "low" as const }, max_output_tokens: CORE_PROVIDER_BUDGET.outputTokens,
    input: [{ role: "system" as const, content: CORE_INTERPRETATION_POLICY }, { role: "user" as const, content: JSON.stringify(binding.context) }],
    text: { format: zodTextFormat(providerCoreProposalSchema, "core_interpretation_v3") },
  };
  if (Math.ceil(JSON.stringify(request).length / 4) + request.max_output_tokens > CORE_PROVIDER_BUDGET.maxEstimatedTokens) throw new Error("core-provider-envelope-budget-exceeded");
  return request;
}
export const coreProviderIdentity = { contract: CORE_PROPOSAL_VERSION, policy: CORE_POLICY_VERSION } as const;
