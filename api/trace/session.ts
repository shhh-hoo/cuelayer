import { createTraceSession, readTraceEvents, type TraceQuery } from "./trace-store.ts";
import { traceEventsToJsonl } from "../../src/trace/durable-trace.ts";

type Request = { method?: string; body?: unknown; query?: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void; send?(body: string): void } };

export default async function handler(request: Request, response: Response): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "POST") {
    const body = request.body as { sessionId?: unknown; appVersion?: string; buildVersion?: string; environment?: string; metadata?: unknown } | undefined;
    if (typeof body?.sessionId !== "string") { response.status(400).json({ error: "invalid-session-id" }); return; }
    try { response.status(201).json(await createTraceSession(body.sessionId, body)); }
    catch (error) { const message = error instanceof Error ? error.message : "trace-store-unavailable"; response.status(message === "trace-session-exists" ? 409 : 503).json({ error: message }); }
    return;
  }
  if (request.method !== "GET") { response.status(405).json({ error: "method-not-allowed" }); return; }
  const sessionId = typeof request.query?.sessionId === "string" ? request.query.sessionId : undefined;
  try {
    if (!sessionId) { response.status(400).json({ error: "session-id-required" }); return; }
    const token = request.headers?.["x-cuelayer-trace-read-capability"] ?? request.headers?.["X-CueLayer-Trace-Read-Capability"];
    const capability = Array.isArray(token) ? token[0] : token;
    const query: TraceQuery = { after: typeof request.query?.after === "string" ? request.query.after : undefined, limit: typeof request.query?.limit === "string" ? Number(request.query.limit) : undefined, stage: typeof request.query?.stage === "string" ? request.query.stage : undefined, eventType: typeof request.query?.eventType === "string" ? request.query.eventType : undefined, apiRequestId: typeof request.query?.apiRequestId === "string" ? request.query.apiRequestId : undefined, plannerRequestId: typeof request.query?.plannerRequestId === "string" ? request.query.plannerRequestId : undefined, commitId: typeof request.query?.commitId === "string" ? request.query.commitId : undefined, cueId: typeof request.query?.cueId === "string" ? request.query.cueId : undefined, errorsOnly: request.query?.errorsOnly === "true" };
    if (request.query?.format === "jsonl") {
      const all = [];
      let after: string | undefined;
      do {
        const page = await readTraceEvents(sessionId, capability, { ...query, after, limit: 250 });
        all.push(...page.events);
        after = page.nextCursor;
      } while (after);
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="cuelayer-trace-${sessionId}.jsonl"`);
      const result = response.status(200);
      if (result.send) result.send(traceEventsToJsonl(all));
      else result.json(traceEventsToJsonl(all));
      return;
    }
    const page = await readTraceEvents(sessionId, capability, query);
    response.status(200).json({ sessionId, ...page });
  } catch (error) {
    const message = error instanceof Error ? error.message : "trace-storage-unavailable";
    response.status(message.startsWith("invalid-") ? 400 : message.startsWith("trace-capability") ? 403 : 503).json({ error: message });
  }
}
