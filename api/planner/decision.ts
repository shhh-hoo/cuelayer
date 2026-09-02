import type { PlannerInput } from "../../src/planner/contracts.ts";
import { requestOpenAIPlannerDecision } from "./openai-planner.ts";

declare const process: { env: Record<string, string | undefined> };

type Request = { method?: string; body?: unknown; signal?: AbortSignal };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } };

const SERVER_PLANNER_TIMEOUT_MS = 6_000;

function plannerFailureReason(error: unknown, timedOut: boolean): string {
  if (timedOut) return "planner-server-timeout";
  const value = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; message?: unknown; name?: unknown } : undefined;
  if (typeof value?.message === "string" && value.message.includes("invalid structured output JSON")) return "planner-invalid-structured-output";
  if (value?.message === "planner-empty-response") return "planner-empty-response";
  if (typeof value?.status === "number") return `planner-provider-http-${value.status}`;
  if (typeof value?.code === "string" && /^[a-z0-9_-]{1,80}$/i.test(value.code)) return `planner-provider-${value.code}`;
  if (value?.name === "AbortError") return "planner-request-aborted";
  return "planner-provider-unavailable";
}

/** Vercel endpoint for the validated OpenAI Luna live planner. */
export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") { response.status(405).json({ error: "method-not-allowed" }); return; }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { response.status(503).json({ error: "planner-not-configured" }); return; }
  const input = request.body as PlannerInput | undefined;
  if (!input?.recentSpeech?.length) { response.status(400).json({ error: "invalid-planner-input" }); return; }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(request.signal?.reason ?? "client_aborted");
  if (request.signal?.aborted) forwardAbort();
  else request.signal?.addEventListener("abort", forwardAbort, { once: true });
  let serverTimedOut = false;
  const timeout = setTimeout(() => {
    serverTimedOut = true;
    controller.abort("server_planner_timeout");
  }, SERVER_PLANNER_TIMEOUT_MS);

  try {
    const decision = await requestOpenAIPlannerDecision(
      input,
      apiKey,
      process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      { signal: controller.signal },
    );
    response.status(200).json({ decision });
  } catch (error) {
    response.status(502).json({ error: plannerFailureReason(error, serverTimedOut) });
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", forwardAbort);
  }
}
