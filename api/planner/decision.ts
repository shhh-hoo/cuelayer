import type { PlannerInput } from "../../src/planner/contracts.ts";
import { deepSeekPlannerFailureReason, requestDeepSeekPlannerResult } from "./deepseek-planner.ts";
import { requestOpenAIPlannerResult } from "./openai-planner.ts";
import { traceExternalCall, traceHeaders } from "../trace/api-trace.ts";

declare const process: { env: Record<string, string | undefined> };

type Request = { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } };

/** Vercel endpoint: prefer the configured native provider; both transports share one compact contract. */
export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") { response.status(405).json({ error: "method-not-allowed" }); return; }
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
  const openAIApiKey = process.env.OPENAI_API_KEY;
  if (!deepSeekApiKey && !openAIApiKey) { response.status(503).json({ error: "planner-not-configured" }); return; }
  const input = request.body as PlannerInput | undefined;
  if (!input?.recentSpeech?.length) { response.status(400).json({ error: "invalid-planner-input" }); return; }
  const trace = traceHeaders(request);
  if (!trace.sessionId) { response.status(400).json({ error: "missing-trace-session-id" }); return; }
  try {
    const provider = deepSeekApiKey ? "deepseek" : "openai";
    const model = deepSeekApiKey ? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash" : process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
    const result = await traceExternalCall({ sessionId: trace.sessionId, apiRequestId: trace.apiRequestId, provider, model, operation: "teaching_planner.decision", requestPayload: input, signal: request.signal, correlation: { plannerRequestId: trace.plannerRequestId }, responsePayload: (value) => value }, () => deepSeekApiKey
      ? requestDeepSeekPlannerResult(input, deepSeekApiKey, model, { signal: request.signal })
      : requestOpenAIPlannerResult(input, openAIApiKey!, model, { signal: request.signal }));
    response.status(200).json({ decision: result.decision });
  } catch (error) {
    const reason = error instanceof Error && error.message.startsWith("trace-") ? error.message : deepSeekPlannerFailureReason(error);
    response.status(reason.startsWith("trace-") ? 503 : 502).json({ error: reason });
  }
}
