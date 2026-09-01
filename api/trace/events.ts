import { appendTraceEvents } from "./trace-store.ts";
import type { DurableTraceEventDraft } from "../../src/trace/durable-trace.ts";

type Request = { method?: string; body?: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } };

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") { response.status(405).json({ error: "method-not-allowed" }); return; }
  const body = request.body as { sessionId?: unknown; events?: unknown } | undefined;
  if (typeof body?.sessionId !== "string" || !Array.isArray(body.events) || body.events.length > 500) {
    response.status(400).json({ error: "invalid-trace-batch" }); return;
  }
  try {
    const events = await appendTraceEvents(body.sessionId, body.events as DurableTraceEventDraft[]);
    response.status(200).json({ events });
  } catch (error) {
    response.status(error instanceof Error && error.message.startsWith("invalid-") ? 400 : 503).json({ error: error instanceof Error ? error.message : "trace-storage-unavailable" });
  }
}
