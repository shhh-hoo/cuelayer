import type { Plugin } from "vite";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { pipeline } from "node:stream/promises";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { modelProfile } from "./live";
import type { ProviderRequest } from "./live";
import { createProviderDeadline, providerResponse } from "./provider-execution";

/** Local experiment endpoints. No production route or credential-bearing client. */
export function realServices(): Plugin {
  return {
    name: "cuelayer-v2-services",
    configureServer(server) {
      server.middlewares.use("/api/v2", async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) {
          res.writeHead(403).end();
          return;
        }
        const observation = Number(process.env.CUELAYER_V2_OBSERVATION_MS);
        const providerTimeoutMs =
          observation >= 6000 && observation <= 60000
            ? observation
            : modelProfile.providerTimeoutMs;
        const deadline = createProviderDeadline(
          new AbortController().signal,
          providerTimeoutMs,
        );
        const { controller } = deadline;
        res.on("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const json = (status: number, value: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(value));
        };
        try {
          if (req.url === "/config" && req.method === "GET") {
            json(200, {
              ...modelProfile,
              providerTimeoutMs,
              clientTimeoutMs: providerTimeoutMs + 2000,
              observationOnly: providerTimeoutMs !== 6000,
              model: process.env.OPENAI_MODEL || modelProfile.model,
              speechConfigured: Boolean(process.env.SPEECHMATICS_API_KEY),
              modelConfigured: Boolean(process.env.OPENAI_API_KEY),
            });
          } else if (req.method !== "POST")
            json(405, { error: "method-not-allowed" });
          else if (req.url === "/speech-token") {
            if (!process.env.SPEECHMATICS_API_KEY) {
              json(503, { error: "speech-not-configured" });
              return;
            }
            const token = await createSpeechmaticsJWT({
              type: "rt",
              apiKey: process.env.SPEECHMATICS_API_KEY,
              ttl: 60,
            });
            json(200, { token });
          } else if (req.url === "/live") {
            let body = "";
            const decoder = new StringDecoder("utf8");
            for await (const part of req) {
              body += decoder.write(part);
              if (body.length > 32000) {
                json(413, { error: "context-budget" });
                return;
              }
            }
            body += decoder.end();
            const task = JSON.parse(body) as ProviderRequest;
            if (!process.env.OPENAI_API_KEY) {
              json(503, { error: "model-not-configured" });
              return;
            }
            const response = await providerResponse(task, {
              apiKey: process.env.OPENAI_API_KEY,
              model: process.env.OPENAI_MODEL || modelProfile.model,
              signal: controller.signal,
              deadline,
            });
            res.writeHead(
              response.status,
              Object.fromEntries(response.headers),
            );
            res.flushHeaders();
            await pipeline(
              Readable.fromWeb(
                response.body as import("node:stream/web").ReadableStream<Uint8Array>,
              ),
              res,
            );
          } else json(404, { error: "not-found" });
        } catch (error) {
          // Only categories cross the boundary: upstream errors can contain private headers/URLs.
          const status =
            typeof error === "object" && error && "status" in error
              ? Number(error.status)
              : 0;
          const reason = controller.signal.aborted
            ? "model-timeout"
            : status === 429 || status >= 500
              ? "model-transient"
              : status === 401
                ? "model-auth"
                : "model-request-failed";
          if (!res.headersSent)
            json(reason === "model-transient" ? 503 : 502, {
              error: reason,
              errorType: error instanceof Error ? error.name : "unknown",
              providerStatus: status,
            });
          else res.destroy();
        } finally {
          deadline.close();
        }
      });
    },
  };
}
