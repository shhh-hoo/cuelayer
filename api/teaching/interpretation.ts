import { interpretationDeadlines } from "../../src/lesson-stream/runtime-policy.ts";
import type { TeachingInterpretationRequest } from "../../src/lesson-stream/contracts.ts";
import { estimateTeachingCost, requestOpenAITeachingInterpretation } from "../../server/teaching/openai-interpreter.ts";

declare const process: { env: Record<string, string | undefined> };

type Request = { method?: string; body?: unknown; signal?: AbortSignal };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } };

const HARD_DEADLINE_MS = interpretationDeadlines().providerMs;

function failureReason(error: unknown, timedOut: boolean) {
  if (timedOut) return "teaching-interpretation-timeout";
  const value = error && typeof error === "object" ? error as { status?: unknown; message?: unknown; name?: unknown } : undefined;
  const stage = error && typeof error === "object" ? (error as { audit?: { failureStage?: string } }).audit?.failureStage : undefined;
  if (stage === "structured_parse_error") return "teaching-interpretation-structured-parse-failed";
  if (stage === "normalization_error") return "teaching-normalization-failed";
  if (value?.message === "interpretation-request-budget-exceeded") return value.message;
  if (typeof value?.status === "number") return `teaching-provider-http-${value.status}`;
  if (value?.name === "AbortError") return "teaching-request-aborted";
  if (value?.message === "teaching-interpretation-empty-response") return value.message;
  return "teaching-provider-unavailable";
}

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") { response.status(405).json({ error: "method-not-allowed" }); return; }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { response.status(503).json({ error: "teaching-not-configured" }); return; }
  const input = request.body as TeachingInterpretationRequest | undefined;
  if (!input?.requestId || !input.sessionId || !input.newEvidence?.length) { response.status(400).json({ error: "invalid-teaching-interpretation-input" }); return; }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(request.signal?.reason ?? "client_aborted");
  if (request.signal?.aborted) forwardAbort();
  else request.signal?.addEventListener("abort", forwardAbort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort("hard_deadline"); }, HARD_DEADLINE_MS);
  try {
    const result = await requestOpenAITeachingInterpretation(input, apiKey, process.env.OPENAI_MODEL ?? "gpt-5.6-luna", { signal: controller.signal });
    const estimatedCostUsd = estimateTeachingCost(result.usage, {
      inputPerMillion: process.env.OPENAI_INPUT_COST_PER_MILLION ? Number(process.env.OPENAI_INPUT_COST_PER_MILLION) : undefined,
      cachedInputPerMillion: process.env.OPENAI_CACHED_INPUT_COST_PER_MILLION ? Number(process.env.OPENAI_CACHED_INPUT_COST_PER_MILLION) : undefined,
      outputPerMillion: process.env.OPENAI_OUTPUT_COST_PER_MILLION ? Number(process.env.OPENAI_OUTPUT_COST_PER_MILLION) : undefined,
    });
    response.status(200).json({ ...result, ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }) });
  } catch (error) {
    const audit = error && typeof error === "object" ? (error as { audit?: unknown }).audit : undefined;
    response.status(502).json({ error: failureReason(error, timedOut), ...(audit ? { audit } : {}) });
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", forwardAbort);
  }
}
