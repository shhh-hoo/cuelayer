import OpenAI from "openai";
import type { CoreInterpretationBinding } from "../../../src/lesson-stream/core/interpretation-context.ts";
import { providerCoreProposalSchema } from "../../../src/lesson-stream/core/interpretation-proposal.ts";
import { coreProviderRequest, coreProviderIdentity, CORE_PROVIDER_BUDGET } from "./provider-contract.ts";

export type CoreProviderTransport = (request: ReturnType<typeof coreProviderRequest> & { model: string }, signal?: AbortSignal) => Promise<{ output_text: string; status?: string; model?: string; id?: string; requestId?: string | null; usage?: unknown; output?: unknown }>;
export type CoreCallDiagnostic = {
  requestedModel: string; startedAt: string; elapsedMs: number;
  response?: Awaited<ReturnType<CoreProviderTransport>>; transportError?: string;
};
/** Explicit injection supports offline validation and controlled Core live hosts. */
export async function interpretCore(binding: Pick<CoreInterpretationBinding, "context">, model: string, transport: CoreProviderTransport, signal?: AbortSignal, record?: (diagnostic: CoreCallDiagnostic) => void) {
  const observe = (diagnostic: CoreCallDiagnostic) => { try { record?.(diagnostic); } catch { /* Diagnostics never alter the provider result. */ } };
  const request = { ...coreProviderRequest(binding), model };
  if (!model.trim() || Math.ceil(JSON.stringify(request).length / 4) + request.max_output_tokens > CORE_PROVIDER_BUDGET.maxEstimatedTokens) throw new Error("core-provider-envelope-budget-exceeded");
  signal?.throwIfAborted();
  const startedAt = new Date().toISOString(), started = performance.now();
  let response: Awaited<ReturnType<CoreProviderTransport>>;
  try { response = await transport(request, signal); }
  catch (error) {
    observe({ requestedModel: model, startedAt, elapsedMs: performance.now() - started, transportError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  // Capture the exact response before incomplete status, JSON/schema, or semantic rejection.
  observe({ requestedModel: model, startedAt, elapsedMs: performance.now() - started, response });
  signal?.throwIfAborted();
  if (response.status && response.status !== "completed") throw new Error("core-provider-incomplete");
  if (response.output_text.length > 131_072) throw new Error("core-provider-output-budget-exceeded");
  const proposal = providerCoreProposalSchema.parse(JSON.parse(response.output_text));
  return { proposal, identity: coreProviderIdentity, requestedModel: model, actualModel: response.model };
}
/** Server-only transport; credentials never enter the browser bundle. */
export function openAICoreTransport(apiKey: string): CoreProviderTransport {
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  return async (request, signal) => {
    const response = await client.responses.create(request, { signal });
    return { output_text: response.output_text, status: response.status, model: response.model, id: response.id, requestId: response._request_id, usage: response.usage, output: response.output };
  };
}
