import type { PlannerInput } from "../../src/planner/contracts.ts";
import { deepSeekPlannerFailureReason, requestDeepSeekPlannerDecision } from "./deepseek-planner.ts";
import { requestOpenAIPlannerDecision } from "./openai-planner.ts";

declare const process: { env: Record<string, string | undefined> };

type Request = { method?: string; body?: unknown; signal?: AbortSignal };
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
  try {
    const decision = deepSeekApiKey
      ? await requestDeepSeekPlannerDecision(input, deepSeekApiKey, process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash", { signal: request.signal })
      : await requestOpenAIPlannerDecision(input, openAIApiKey!, process.env.OPENAI_MODEL ?? "gpt-5.6-luna", { signal: request.signal });
    response.status(200).json({ decision });
  } catch (error) {
    response.status(502).json({ error: deepSeekPlannerFailureReason(error) });
  }
}
