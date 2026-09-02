import type { PlannerInput } from "../../src/planner/contracts.ts";
import { requestOpenAIPlannerResult } from "../../server/planner/openai-planner.ts";
import { TracedExternalCallError, traceExternalCall, traceHeaders } from "../../server/trace/api-trace.ts";

declare const process: { env: Record<string, string | undefined> };

type Request = { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } };

/** Vercel endpoint for the OpenAI-only live teaching planner. */
export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") { response.status(405).json({ error: "method-not-allowed" }); return; }
  const openAIApiKey = process.env.OPENAI_API_KEY;
  if (!openAIApiKey) { response.status(503).json({ error: "planner-not-configured" }); return; }
  const input = request.body as PlannerInput | undefined;
  if (!input?.recentSpeech?.length) { response.status(400).json({ error: "invalid-planner-input" }); return; }
  const trace = traceHeaders(request);
  if (!trace.sessionId) { response.status(400).json({ error: "missing-trace-session-id" }); return; }
  try {
    const model = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
    const traced = await traceExternalCall({ sessionId: trace.sessionId, writeCapability: trace.writeCapability, apiRequestId: trace.apiRequestId, provider: "openai", model, operation: "teaching_planner.decision", requestPayload: input, signal: request.signal, correlation: { plannerRequestId: trace.plannerRequestId }, responsePayload: (value) => value }, () => requestOpenAIPlannerResult(input, openAIApiKey, model, { signal: request.signal }));
    response.status(200).json({ decision: traced.result.decision, traceDelivery: traced.traceDelivery });
  } catch (error) {
    const providerError = error instanceof TracedExternalCallError ? error.providerError : error;
    const reason = providerError instanceof SyntaxError ? "planner-invalid-structured-output" : "planner-provider-unavailable";
    response.status(502).json({ error: reason, ...(error instanceof TracedExternalCallError ? { traceDelivery: error.traceDelivery } : {}) });
  }
}
