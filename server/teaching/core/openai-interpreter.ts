import OpenAI from "openai";
import type { CoreInterpretationBinding } from "../../../src/lesson-stream/core/interpretation-context.ts";
import { coreProposalSchema } from "../../../src/lesson-stream/core/interpretation-proposal.ts";
import { coreProviderRequest, coreProviderIdentity, CORE_PROVIDER_BUDGET } from "./provider-contract.ts";

export type CoreProviderTransport = (request: ReturnType<typeof coreProviderRequest> & { model: string }, signal?: AbortSignal) => Promise<{ output_text: string; status?: string; model?: string }>;
/** Evaluation-only adapter. Explicit injection makes deterministic tests incapable of accidental calls. */
export async function interpretCore(binding: CoreInterpretationBinding, model: string, transport: CoreProviderTransport, signal?: AbortSignal) {
  const request = { ...coreProviderRequest(binding), model };
  if (!model.trim() || Math.ceil(JSON.stringify(request).length / 4) + request.max_output_tokens > CORE_PROVIDER_BUDGET.maxEstimatedTokens) throw new Error("core-provider-envelope-budget-exceeded");
  signal?.throwIfAborted();
  const response = await transport(request, signal);
  signal?.throwIfAborted();
  if (response.status && response.status !== "completed") throw new Error("core-provider-incomplete");
  const proposal = coreProposalSchema.parse(JSON.parse(response.output_text));
  return { proposal, identity: coreProviderIdentity, requestedModel: model, actualModel: response.model };
}
/** Called only by separately authorized offline evaluation; never imported by production routes. */
export function openAICoreTransport(apiKey: string): CoreProviderTransport {
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  return async (request, signal) => {
    const response = await client.responses.create(request, { signal });
    return { output_text: response.output_text, status: response.status, model: response.model };
  };
}
