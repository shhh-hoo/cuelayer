import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { requestOpenAIPlannerResult } from "./api/planner/openai-planner.ts";
import { appendTraceEvents, createTraceSession, readTraceEvents } from "./api/trace/trace-store.ts";
import { traceExternalCall, traceHeaders } from "./api/trace/api-trace.ts";
import { traceEventsToJsonl } from "./src/trace/durable-trace.ts";

async function requestBody(request: import("http").IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.SPEECHMATICS_API_KEY;
  return {
  define: { "import.meta.env.VITE_CUELAYER_BUILD_VERSION": JSON.stringify(env.VERCEL_GIT_COMMIT_SHA || env.CUELAYER_BUILD_VERSION || process.env.npm_package_version || "development") },
  plugins: [react(), {
    name: "speechmatics-token-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/trace/events", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        try {
          const body = await requestBody(request) as { sessionId?: unknown; events?: unknown };
          if (typeof body.sessionId !== "string" || !Array.isArray(body.events) || body.events.length > 500) { response.statusCode = 400; response.end(JSON.stringify({ error: "invalid-trace-batch" })); return; }
          const capability = request.headers["x-cuelayer-trace-write-capability"];
          const events = await appendTraceEvents(body.sessionId, Array.isArray(capability) ? capability[0] : capability, body.events as never[]);
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ events }));
        } catch (error) { response.statusCode = 503; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "trace-storage-unavailable" })); }
      });
      server.middlewares.use("/api/trace/session", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method === "POST") {
          try { const body = await requestBody(request) as { sessionId?: string; writeCapability?: string; readCapability?: string; appVersion?: string; buildVersion?: string; environment?: string; metadata?: unknown }; if (!body.sessionId || !body.writeCapability || !body.readCapability) { response.statusCode = 400; response.end(JSON.stringify({ error: "invalid-session-provisioning" })); return; } const provisioned = await createTraceSession(body.sessionId, { writeCapability: body.writeCapability, readCapability: body.readCapability }, body); response.setHeader("Content-Type", "application/json"); response.statusCode = provisioned.created ? 201 : 200; response.end(JSON.stringify(provisioned)); }
          catch (error) { const message = error instanceof Error ? error.message : "trace-store-unavailable"; response.statusCode = message === "trace-session-capability-conflict" ? 409 : message.startsWith("invalid-") ? 400 : 503; response.end(JSON.stringify({ error: message })); }
          return;
        }
        if (request.method !== "GET") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        try {
          const url = new URL(request.url ?? "", "http://localhost");
          const sessionId = url.searchParams.get("sessionId");
          if (!sessionId) { response.statusCode = 400; response.end(JSON.stringify({ error: "session-id-required" })); return; }
          const capability = request.headers["x-cuelayer-trace-read-capability"];
          const readCapability = Array.isArray(capability) ? capability[0] : capability;
          const query = { after: url.searchParams.get("after") ?? undefined, limit: Number(url.searchParams.get("limit") ?? 100), stage: url.searchParams.get("stage") ?? undefined, eventType: url.searchParams.get("eventType") ?? undefined };
          if (url.searchParams.get("format") === "jsonl") {
            const all = [];
            let after: string | undefined;
            do {
              const page = await readTraceEvents(sessionId, readCapability, { ...query, after, limit: 250 });
              all.push(...page.events);
              after = page.nextCursor;
            } while (after);
            response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
            response.setHeader("Content-Disposition", `attachment; filename="cuelayer-trace-${sessionId}.jsonl"`);
            response.end(traceEventsToJsonl(all)); return;
          }
          const page = await readTraceEvents(sessionId, readCapability, query);
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ sessionId, ...page }));
        } catch (error) { response.statusCode = 503; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "trace-storage-unavailable" })); }
      });
      server.middlewares.use("/api/speechmatics/token", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        if (!apiKey) { response.statusCode = 503; response.end(JSON.stringify({ error: "speech-not-configured" })); return; }
        const trace = traceHeaders({ headers: request.headers as Record<string, string | string[] | undefined> });
        if (!trace.sessionId) { response.statusCode = 400; response.end(JSON.stringify({ error: "missing-trace-session-id" })); return; }
        try {
          const token = await traceExternalCall({ sessionId: trace.sessionId, writeCapability: trace.writeCapability, apiRequestId: trace.apiRequestId, provider: "speechmatics", operation: "realtime.temporary_token", requestPayload: { type: "rt", ttlSeconds: 60 }, responsePayload: () => ({ tokenIssued: true, ttlSeconds: 60 }) }, () => createSpeechmaticsJWT({ type: "rt", apiKey, ttl: 60 }));
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ token }));
        } catch (error) {
          const reason = error instanceof Error && error.message.startsWith("trace-") ? error.message : "speech-token-unavailable";
          response.statusCode = reason.startsWith("trace-") ? 503 : 502; response.end(JSON.stringify({ error: reason }));
        }
      });
      server.middlewares.use("/api/planner/decision", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        const openAIApiKey = env.OPENAI_API_KEY;
        if (!openAIApiKey) { response.statusCode = 503; response.end(JSON.stringify({ error: "planner-not-configured" })); return; }
        const trace = traceHeaders({ headers: request.headers as Record<string, string | string[] | undefined> });
        if (!trace.sessionId) { response.statusCode = 400; response.end(JSON.stringify({ error: "missing-trace-session-id" })); return; }
        try {
          const input = await requestBody(request);
          const model = env.OPENAI_MODEL || "gpt-5.6-luna";
          const result = await traceExternalCall({ sessionId: trace.sessionId, writeCapability: trace.writeCapability, apiRequestId: trace.apiRequestId, provider: "openai", model, operation: "teaching_planner.decision", requestPayload: input, correlation: { plannerRequestId: trace.plannerRequestId }, responsePayload: (value) => value }, () => requestOpenAIPlannerResult(input as never, openAIApiKey, model));
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ decision: result.decision }));
        } catch (error) {
          const reason = error instanceof Error && error.message.startsWith("trace-") ? error.message : error instanceof SyntaxError ? "planner-invalid-structured-output" : "planner-provider-unavailable";
          response.statusCode = reason.startsWith("trace-") ? 503 : 502; response.end(JSON.stringify({ error: reason }));
        }
      });
    },
  }],
  };
});
