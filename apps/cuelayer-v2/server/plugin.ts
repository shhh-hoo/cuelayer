import type { Plugin } from "vite";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { pipeline } from "node:stream/promises";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import { modelProfile } from "./live";
import type { ProviderRequest } from "./live";
import { createProviderDeadline, providerResponse } from "./provider-execution";
import {
  latencyPolicy,
  type RuntimeLatencyPolicy,
} from "../src/latency-policy";

/** Body admission shares the provider deadline, including a stalled upload. */
function readBody(req: IncomingMessage, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    const decoder = new StringDecoder("utf8");
    const cleanup = () => {
      req.removeListener("data", data);
      req.removeListener("end", end);
      req.removeListener("error", fail);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new Error("model-timeout"));
    const data = (part: Buffer) => {
      body += decoder.write(part);
      if (body.length > 32000) fail(new Error("context-budget"));
    };
    const end = () => {
      body += decoder.end();
      cleanup();
      resolve(body);
    };
    req.on("data", data).on("end", end).on("error", fail);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

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
        const observationOnly = observation >= 6000 && observation <= 60000;
        const providerTimeoutMs = observationOnly
          ? observation
          : latencyPolicy.lanes.Live.providerHardMs;
        const effectiveLatencyPolicy: RuntimeLatencyPolicy = observationOnly
          ? {
              ...latencyPolicy,
              version: "v2-latency-observation-1",
              observationOnly: true,
              lanes: {
                Live: {
                  ...latencyPolicy.lanes.Live,
                  providerHardMs: providerTimeoutMs,
                  hostTotalMs: providerTimeoutMs + 2000,
                },
                Stage: {
                  ...latencyPolicy.lanes.Stage,
                  providerHardMs: providerTimeoutMs,
                  hostTotalMs: providerTimeoutMs + 2000,
                },
              },
            }
          : latencyPolicy;
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
              latencyPolicy,
              latencyPolicyVersion: latencyPolicy.version,
              effectiveLatencyPolicy,
              providerTimeoutMs,
              clientTimeoutMs: effectiveLatencyPolicy.lanes.Live.hostTotalMs,
              observationOnly,
              model: process.env.OPENAI_MODEL || modelProfile.model,
              modelOverrideUnqualified: Boolean(
                process.env.OPENAI_MODEL &&
                process.env.OPENAI_MODEL !== modelProfile.model,
              ),
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
            const body = await readBody(req, controller.signal);
            controller.signal.throwIfAborted();
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
          if (error instanceof Error && error.message === "context-budget") {
            res.shouldKeepAlive = false;
            json(413, { error: "context-budget" });
            return;
          }
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
          if (controller.signal.aborted) res.shouldKeepAlive = false;
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
