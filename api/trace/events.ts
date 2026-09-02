import { appendTraceEvents } from "../../server/trace/trace-store.ts";
import type { DurableTraceEventDraft } from "../../src/trace/durable-trace.ts";

type Request = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } };

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") { response.status(405).json({ error: "method-not-allowed" }); return; }
  const body = request.body as { sessionId?: unknown; events?: unknown } | undefined;
  if (typeof body?.sessionId !== "string" || !Array.isArray(body.events) || body.events.length > 500) {
    response.status(400).json({ error: "invalid-trace-batch" }); return;
  }
  try {
    const token = request.headers?.["x-cuelayer-trace-write-capability"] ?? request.headers?.["X-CueLayer-Trace-Write-Capability"];
    const events = await appendTraceEvents(body.sessionId, Array.isArray(token) ? token[0] : token, body.events as DurableTraceEventDraft[]);
    response.status(200).json({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "trace-storage-unavailable";
    response.status(message.startsWith("invalid-") ? 400 : message.startsWith("trace-capability") ? 403 : 503).json({ error: message });
  }
}
