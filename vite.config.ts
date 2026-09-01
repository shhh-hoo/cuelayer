import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { deepSeekPlannerFailureReason, requestDeepSeekPlannerDecision } from "./api/planner/deepseek-planner.ts";
import { requestOpenAIPlannerDecision } from "./api/planner/openai-planner.ts";

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
      server.middlewares.use("/api/planner/decision", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.statusCode = 405; response.end(JSON.stringify({ error: "method-not-allowed" })); return; }
        const deepSeekApiKey = env.DEEPSEEK_API_KEY;
        const openAIApiKey = env.OPENAI_API_KEY;
        if (!deepSeekApiKey && !openAIApiKey) { response.statusCode = 503; response.end(JSON.stringify({ error: "planner-not-configured" })); return; }
        try {
          const input = await requestBody(request);
          const decision = deepSeekApiKey
            ? await requestDeepSeekPlannerDecision(input as never, deepSeekApiKey, env.DEEPSEEK_MODEL || "deepseek-v4-flash")
            : await requestOpenAIPlannerDecision(input as never, openAIApiKey!, env.OPENAI_MODEL || "gpt-5.6-luna");
          response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ decision }));
        } catch (error) { response.statusCode = 502; response.end(JSON.stringify({ error: deepSeekPlannerFailureReason(error) })); }
      });
    },
  }],
  };
});
