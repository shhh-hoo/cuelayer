import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createSpeechmaticsJWT } from "@speechmatics/auth";

export default defineConfig(({ mode }) => {
  const apiKey = loadEnv(mode, process.cwd(), "").SPEECHMATICS_API_KEY;
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
    },
  }],
  };
});
