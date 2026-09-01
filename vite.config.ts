import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { deepSeekPlannerFailureReason, requestDeepSeekPlannerResult } from "./api/planner/deepseek-planner.ts";
import { requestOpenAIPlannerResult } from "./api/planner/openai-planner.ts";
import { appendTraceEvents, listRecentTraceSessions, readTraceEvents } from "./api/trace/trace-store.ts";
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
          const events = await appendTraceEvents(body.sessionId, body.events as never[]);
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ events }));
        } catch (error) { response.statusCode = 503; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "trace-storage-unavailable" })); }
      });
      server.middlewares.use("/api/trace/session", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "GET") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        try {
          const url = new URL(request.url ?? "", "http://localhost");
          const sessionId = url.searchParams.get("sessionId");
          if (!sessionId) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ recentSessionIds: await listRecentTraceSessions() })); return; }
          const events = await readTraceEvents(sessionId);
          if (url.searchParams.get("format") === "jsonl") {
            response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
            response.setHeader("Content-Disposition", `attachment; filename="cuelayer-trace-${sessionId}.jsonl"`);
            response.end(traceEventsToJsonl(events)); return;
          }
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ sessionId, events }));
        } catch (error) { response.statusCode = 503; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "trace-storage-unavailable" })); }
      });
      server.middlewares.use("/api/speechmatics/token", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        if (!apiKey) { response.statusCode = 503; response.end(JSON.stringify({ error: "speech-not-configured" })); return; }
        const trace = traceHeaders({ headers: request.headers as Record<string, string | string[] | undefined> });
        if (!trace.sessionId) { response.statusCode = 400; response.end(JSON.stringify({ error: "missing-trace-session-id" })); return; }
        try {
          const token = await traceExternalCall({ sessionId: trace.sessionId, apiRequestId: trace.apiRequestId, provider: "speechmatics", operation: "realtime.temporary_token", requestPayload: { type: "rt", ttlSeconds: 60 }, responsePayload: () => ({ tokenIssued: true, ttlSeconds: 60 }) }, () => createSpeechmaticsJWT({ type: "rt", apiKey, ttl: 60 }));
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ token }));
        } catch (error) {
          const reason = error instanceof Error && error.message.startsWith("trace-") ? error.message : "speech-token-unavailable";
          response.statusCode = reason.startsWith("trace-") ? 503 : 502; response.end(JSON.stringify({ error: reason }));
        }
      });
      server.middlewares.use("/api/planner/decision", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        const deepSeekApiKey = env.DEEPSEEK_API_KEY;
        const openAIApiKey = env.OPENAI_API_KEY;
        if (!deepSeekApiKey && !openAIApiKey) { response.statusCode = 503; response.end(JSON.stringify({ error: "planner-not-configured" })); return; }
        const trace = traceHeaders({ headers: request.headers as Record<string, string | string[] | undefined> });
        if (!trace.sessionId) { response.statusCode = 400; response.end(JSON.stringify({ error: "missing-trace-session-id" })); return; }
        try {
          const input = await requestBody(request);
          const provider = deepSeekApiKey ? "deepseek" : "openai";
          const model = deepSeekApiKey ? env.DEEPSEEK_MODEL || "deepseek-v4-flash" : env.OPENAI_MODEL || "gpt-5.6-luna";
          const result = await traceExternalCall({ sessionId: trace.sessionId, apiRequestId: trace.apiRequestId, provider, model, operation: "teaching_planner.decision", requestPayload: input, correlation: { plannerRequestId: trace.plannerRequestId }, responsePayload: (value) => value }, () => deepSeekApiKey
            ? requestDeepSeekPlannerResult(input as never, deepSeekApiKey, model)
            : requestOpenAIPlannerResult(input as never, openAIApiKey!, model));
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ decision: result.decision }));
        } catch (error) {
          const reason = error instanceof Error && error.message.startsWith("trace-") ? error.message : deepSeekPlannerFailureReason(error);
          response.statusCode = reason.startsWith("trace-") ? 503 : 502; response.end(JSON.stringify({ error: reason }));
        }
      });
    },
  }],
  };
});
