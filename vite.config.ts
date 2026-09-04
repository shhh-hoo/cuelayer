import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { estimateTeachingCost, requestOpenAITeachingInterpretation } from "./server/teaching/openai-interpreter.ts";

async function requestBody(request: import("http").IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

function teachingFailureReason(error: unknown) {
  const value = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; message?: unknown } : undefined;
  if (typeof value?.message === "string" && value.message.includes("invalid structured output JSON")) return "teaching-invalid-structured-output";
  if (value?.message === "teaching-empty-response") return "teaching-empty-response";
  if (typeof value?.status === "number") return `teaching-provider-http-${value.status}`;
  if (typeof value?.code === "string" && /^[a-z0-9_-]{1,80}$/i.test(value.code)) return `teaching-provider-${value.code}`;
  return "teaching-provider-unavailable";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.SPEECHMATICS_API_KEY;
  return {
  plugins: [react(), {
    name: "speechmatics-token-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/speechmatics/token", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        if (!apiKey) { response.statusCode = 503; response.end(JSON.stringify({ error: "speech-not-configured" })); return; }
        try { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ token: await createSpeechmaticsJWT({ type: "rt", apiKey, ttl: 60 }) })); }
        catch { response.statusCode = 502; response.end(JSON.stringify({ error: "speech-token-unavailable" })); }
      });
      server.middlewares.use("/api/teaching/interpretation", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        const openAIApiKey = env.OPENAI_API_KEY;
        if (!openAIApiKey) { response.statusCode = 503; response.end(JSON.stringify({ error: "teaching-not-configured" })); return; }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort("hard_deadline"), 6_000);
        try {
          const input = await requestBody(request);
          const result = await requestOpenAITeachingInterpretation(input as never, openAIApiKey, env.OPENAI_MODEL || "gpt-5.6-luna", { signal: controller.signal });
          const estimatedCostUsd = estimateTeachingCost(result.usage, {
            inputPerMillion: env.OPENAI_INPUT_COST_PER_MILLION ? Number(env.OPENAI_INPUT_COST_PER_MILLION) : undefined,
            cachedInputPerMillion: env.OPENAI_CACHED_INPUT_COST_PER_MILLION ? Number(env.OPENAI_CACHED_INPUT_COST_PER_MILLION) : undefined,
            outputPerMillion: env.OPENAI_OUTPUT_COST_PER_MILLION ? Number(env.OPENAI_OUTPUT_COST_PER_MILLION) : undefined,
          });
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ ...result, ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }) }));
        } catch (error) {
          response.statusCode = 502;
          response.end(JSON.stringify({ error: controller.signal.aborted ? "teaching-interpretation-timeout" : teachingFailureReason(error) }));
        } finally {
          clearTimeout(timeout);
        }
      });
    },
  }],
  };
});
