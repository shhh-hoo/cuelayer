import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { TracedExternalCallError, traceExternalCall, traceHeaders } from "../../server/trace/api-trace.ts";

type Response = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void };
};

/** Vercel-compatible server endpoint. The permanent API key never enters the browser bundle. */
export default async function handler(request: { method?: string; headers?: Record<string, string | string[] | undefined> }, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.status(405).json({ error: "method-not-allowed" });
    return;
  }
  const apiKey = process.env.SPEECHMATICS_API_KEY;
  if (!apiKey) {
    response.status(503).json({ error: "speech-not-configured" });
    return;
  }
  const trace = traceHeaders(request);
  if (!trace.sessionId) { response.status(400).json({ error: "missing-trace-session-id" }); return; }
  try {
    const traced = await traceExternalCall({ sessionId: trace.sessionId, writeCapability: trace.writeCapability, apiRequestId: trace.apiRequestId, provider: "speechmatics", operation: "realtime.temporary_token", requestPayload: { type: "rt", ttlSeconds: 60 }, responsePayload: () => ({ tokenIssued: true, ttlSeconds: 60 }) }, () => createSpeechmaticsJWT({ type: "rt", apiKey, ttl: 60 }));
    response.status(200).json({ token: traced.result, traceDelivery: traced.traceDelivery });
  } catch (error) {
    response.status(502).json({ error: "speech-token-unavailable", ...(error instanceof TracedExternalCallError ? { traceDelivery: error.traceDelivery } : {}) });
  }
}
