import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts";

const mocks = vi.hoisted(() => ({ openAI: vi.fn(), buildRequest: vi.fn(), trace: vi.fn(), traceResponse: vi.fn(), traceDelivery: { events: [] as unknown[] } }));
vi.mock("./openai-planner.ts", () => ({ requestOpenAIPlannerResult: mocks.openAI, createOpenAIPlannerRequest: mocks.buildRequest }));
vi.mock("../trace/api-trace.ts", () => ({
  traceHeaders: () => ({ sessionId: "session-api-test", apiRequestId: "api-test", plannerRequestId: "planner-test" }),
  traceExternalCall: async (options: { responsePayload(value: unknown): unknown }, call: () => Promise<unknown>) => {
    mocks.trace(options); const result = await call(); mocks.traceResponse(options.responsePayload(result)); return { result, traceDelivery: mocks.traceDelivery };
  },
}));

import handler from "../../api/planner/decision";

const input: PlannerInput = { recentSpeech: [{ id: "speech-span-0", text: "A useful proposition.", words: [] }] };
const decision: RuntimeDecision = { display: { kind: "TEXT" }, learner: { kind: "NONE" } };
function responseCapture() { let code = 0; let body: unknown; return { response: { setHeader: vi.fn(), status(statusCode: number) { code = statusCode; return { json(value: unknown) { body = value; } }; } }, result: () => ({ code, body }) }; }

describe("live planner OpenAI contract", () => {
  const originalOpenAI = process.env.OPENAI_API_KEY; const originalModel = process.env.OPENAI_MODEL;
  beforeEach(() => { mocks.openAI.mockReset(); mocks.buildRequest.mockReset(); mocks.trace.mockReset(); mocks.traceResponse.mockReset(); mocks.buildRequest.mockImplementation((plannerInput, model) => ({ model, input: plannerInput })); mocks.traceDelivery = { events: [] }; delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_MODEL; });
  afterEach(() => { if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI; if (originalModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalModel; });

  it("reports planner-not-configured without an OpenAI key", async () => {
    const captured = responseCapture(); await handler({ method: "POST", body: input }, captured.response);
    expect(captured.result()).toEqual({ code: 503, body: { error: "planner-not-configured" } }); expect(mocks.openAI).not.toHaveBeenCalled();
  });

  it("uses OpenAI Luna by default and traces the OpenAI provider", async () => {
    process.env.OPENAI_API_KEY = "openai-key"; mocks.openAI.mockResolvedValue({ decision, providerResponse: { output_parsed: { display: { kind: "TEXT" }, learner: { kind: "NONE" } } } }); const captured = responseCapture();
    await handler({ method: "POST", body: input }, captured.response);
    const providerRequest = mocks.buildRequest.mock.results[0]?.value;
    expect(mocks.openAI).toHaveBeenCalledWith(providerRequest, "openai-key", { signal: undefined });
    expect(mocks.trace).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai", model: "gpt-5.6-luna", operation: "teaching_planner.decision", requestPayload: providerRequest }));
    expect(captured.result()).toEqual({ code: 200, body: { decision, traceEvents: [] } });
  });

  it("honours an explicit OpenAI model override", async () => {
    process.env.OPENAI_API_KEY = "openai-key"; process.env.OPENAI_MODEL = "gpt-5.6-sol"; mocks.openAI.mockResolvedValue({ decision, providerResponse: { output_parsed: decision } }); const captured = responseCapture();
    await handler({ method: "POST", body: input }, captured.response);
    expect(mocks.openAI).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-sol" }), "openai-key", { signal: undefined });
  });

  it("returns sanitized API facts for the browser local trace store", async () => {
    process.env.OPENAI_API_KEY = "openai-key"; mocks.openAI.mockResolvedValue({ decision, providerResponse: { output_parsed: decision } });
    mocks.traceDelivery = { events: [{ id: "server:api-test:started", stage: "api", type: "api_call.started", source: "server", sourceInstanceId: "server:api-test", sourceSeq: 1, payload: { provider: "openai" } }] };
    const captured = responseCapture(); await handler({ method: "POST", body: input }, captured.response);
    expect(captured.result()).toMatchObject({ code: 200, body: { decision, traceEvents: [{ id: "server:api-test:started" }] } });
  });

  it("keeps raw provider output separate from CueLayer's normalized planner completion", async () => {
    process.env.OPENAI_API_KEY = "openai-key";
    const providerResponse = { id: "resp_1", output_parsed: { display: { kind: "QUIET", reason: "filler" }, learner: { kind: "NONE", target: null }, evidence: null } };
    const normalized: RuntimeDecision = { display: { kind: "QUIET", reason: "filler" }, learner: { kind: "NONE" } };
    mocks.openAI.mockResolvedValue({ decision: normalized, providerResponse });
    const captured = responseCapture(); await handler({ method: "POST", body: input }, captured.response);
    const traceOptions = mocks.trace.mock.calls[0]?.[0] as { responsePayload(value: unknown): unknown };
    expect(traceOptions.responsePayload({ providerResponse })).toEqual(providerResponse);
    expect(mocks.traceResponse).toHaveBeenCalledWith(providerResponse);
    expect(captured.result()).toMatchObject({ body: { decision: normalized } });
  });
});
