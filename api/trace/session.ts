import { listRecentTraceSessions, readTraceEvents } from "./trace-store.ts";
import { traceEventsToJsonl } from "../../src/trace/durable-trace.ts";

type Request = { method?: string; query?: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void; send?(body: string): void } };

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") { response.status(405).json({ error: "method-not-allowed" }); return; }
  const sessionId = typeof request.query?.sessionId === "string" ? request.query.sessionId : undefined;
  try {
    if (!sessionId) { response.status(200).json({ recentSessionIds: await listRecentTraceSessions() }); return; }
    const events = await readTraceEvents(sessionId);
    if (request.query?.format === "jsonl") {
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="cuelayer-trace-${sessionId}.jsonl"`);
      const result = response.status(200);
      if (result.send) result.send(traceEventsToJsonl(events));
      else result.json(traceEventsToJsonl(events));
      return;
    }
    response.status(200).json({ sessionId, events });
  } catch (error) {
    response.status(error instanceof Error && error.message.startsWith("invalid-") ? 400 : 503).json({ error: error instanceof Error ? error.message : "trace-storage-unavailable" });
  }
}
