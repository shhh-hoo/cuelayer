import {
  createServer,
  request,
  type RequestListener,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { afterEach, expect, it, vi } from "vitest";
import { realServices } from "../server/plugin";
import {
  liveRequest,
  modelProfile,
  type ProviderRequest,
} from "../server/live";
import { providerResponse } from "../server/provider-execution";
import { latencyPolicy } from "../src/latency-policy";

const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function endpoint(onRequest: () => void = () => {}) {
  let handle!: RequestListener;
  const configure = realServices().configureServer;
  if (typeof configure !== "function") throw new Error("missing-server-hook");
  configure.call(
    {} as ThisParameterType<typeof configure>,
    {
      middlewares: {
        use(_path: string, handler: RequestListener) {
          handle = handler;
        },
      },
    } as unknown as ViteDevServer,
  );
  const server = createServer((req, res) => {
    handle(req, res);
    onRequest();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function exchange(url: string, body?: string, keepBodyOpen = false) {
  let finish!: (value: { status: number; body: string }) => void;
  let fail!: (reason: unknown) => void;
  const done = new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      finish = resolve;
      fail = reject;
    },
  );
  const req = request(
    url,
    { method: body === undefined ? "GET" : "POST" },
    (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("error", fail);
      res.on("end", () => finish({ status: res.statusCode!, body: text }));
    },
  );
  req.on("error", fail);
  if (keepBodyOpen) req.write(body);
  else req.end(body);
  return { req, done };
}

it("advertises the base budgets and exact provisional model configuration on the actual config route", async () => {
  vi.stubEnv("CUELAYER_V2_OBSERVATION_MS", "");
  vi.stubEnv("OPENAI_MODEL", "");
  const url = await endpoint();
  const response = await exchange(url + "/config").done;
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({
    model: "gpt-6-astra",
    reasoning: "medium",
    stageReasoning: "medium",
    serviceTier: "default",
    maxOutputTokens: 8192,
    latencyPolicyVersion: "v2-latency-policy-1",
    latencyPolicy,
    effectiveLatencyPolicy: latencyPolicy,
    providerTimeoutMs: 12000,
    clientTimeoutMs: 15000,
    observationOnly: false,
    modelOverrideUnqualified: false,
  });
  expect(latencyPolicy.lanes.Live.freshness).toEqual({
    firstAnswerMs: 5000,
    completeMs: 7000,
    acceptedMs: 7500,
    visibleMs: 8000,
  });
  expect(latencyPolicy.lanes.Stage.freshness).toEqual({
    completeMs: 8000,
    acceptedMs: 10000,
  });
  expect(latencyPolicy.attention).toEqual({
    admissionMs: 7500,
    publishedTtlMs: 750,
  });
  for (const version of ["v2-live-request-5", "v2-stage-request-6"])
    expect(await liveRequest({ version } as ProviderRequest)).toMatchObject({
      model: "gpt-6-astra",
      reasoning: { effort: "medium" },
      service_tier: "default",
      max_output_tokens: 8192,
    });
});

it.each([12000, 45000])(
  "keeps an explicit %ims observation override separate from the base policy",
  async (duration) => {
    vi.stubEnv("CUELAYER_V2_OBSERVATION_MS", String(duration));
    vi.stubEnv("OPENAI_MODEL", "unqualified-offline-model");
    const url = await endpoint();
    const config = JSON.parse((await exchange(url + "/config").done).body);
    expect(config.latencyPolicy).toEqual(latencyPolicy);
    expect(config).toMatchObject({
      observationOnly: true,
      providerTimeoutMs: duration,
      clientTimeoutMs: duration + 2000,
      model: "unqualified-offline-model",
      modelOverrideUnqualified: true,
      effectiveLatencyPolicy: {
        version: "v2-latency-observation-1",
        observationOnly: true,
        lanes: {
          Live: { providerHardMs: duration, hostTotalMs: duration + 2000 },
          Stage: { providerHardMs: duration, hostTotalMs: duration + 2000 },
        },
      },
    });
    expect(config.effectiveLatencyPolicy.attention).toEqual(
      latencyPolicy.attention,
    );
    expect(config.effectiveLatencyPolicy.lanes.Live.freshness).toEqual(
      latencyPolicy.lanes.Live.freshness,
    );
  },
);

it("aborts a stalled real-route body at the pre-parse deadline without dispatching a provider", async () => {
  vi.stubEnv("CUELAYER_V2_OBSERVATION_MS", "");
  vi.stubEnv("OPENAI_API_KEY", "offline-no-provider-call");
  const transport = vi.fn(() => {
    throw new Error("provider-dispatch-forbidden");
  });
  vi.stubGlobal("fetch", transport);
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const url = await endpoint(arrived);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = exchange(url + "/live", "{", true);
  await started;
  let ended = false;
  void pending.done.then(() => {
    ended = true;
  });
  await vi.advanceTimersByTimeAsync(11999);
  expect(ended).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const response = await pending.done;
  expect(response.status).toBe(502);
  expect(JSON.parse(response.body).error).toBe("model-timeout");
  expect(transport).not.toHaveBeenCalled();
  pending.req.destroy();
});

it("keeps the provider deadline active after headers and answer bytes until terminal completion", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let providerSignal!: AbortSignal;
  const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
    providerSignal = init!.signal!;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"response.output_text.delta","delta":"{"}\n\n',
            ),
          );
          providerSignal.addEventListener(
            "abort",
            () => controller.error(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof fetch;
  const response = await providerResponse(
    { version: "v2-live-request-5" } as ProviderRequest,
    {
      apiKey: "offline",
      model: modelProfile.model,
      signal: new AbortController().signal,
      fetch: transport,
    },
  );
  const body = response.text();
  await vi.advanceTimersByTimeAsync(11999);
  expect(providerSignal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(providerSignal.aborted).toBe(true);
  expect(await body).toContain('"reason":"model-timeout"');
  expect(transport).toHaveBeenCalledTimes(1);
});

it("cancels a pending SDK body at the deadline and prevents late completion", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const response = await providerResponse(
    { version: "v2-live-request-5" } as ProviderRequest,
    {
      apiKey: "offline",
      model: modelProfile.model,
      signal: new AbortController().signal,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              stream = controller;
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    },
  );
  const body = response.text();
  await vi.advanceTimersByTimeAsync(12000);
  expect(() =>
    stream.enqueue(
      new TextEncoder().encode(
        'data: {"type":"response.completed","response":{"status":"completed","model":"gpt-6-astra","id":"late"}}\n\n',
      ),
    ),
  ).toThrow();
  const forwarded = await body;
  expect(forwarded).toContain('"reason":"model-timeout"');
  expect(forwarded).not.toContain('"type":"response.completed"');
});
