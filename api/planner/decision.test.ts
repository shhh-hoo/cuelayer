import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannerInput, RuntimeDecision } from "../../src/planner/contracts";

const mocks = vi.hoisted(() => ({ deepSeek: vi.fn(), openAI: vi.fn() }));

vi.mock("./deepseek-planner.ts", () => ({
  deepSeekPlannerFailureReason: () => "planner-provider-unavailable",
  requestDeepSeekPlannerResult: mocks.deepSeek,
}));
vi.mock("./openai-planner.ts", () => ({ requestOpenAIPlannerResult: mocks.openAI }));
vi.mock("../trace/api-trace.ts", () => ({
  traceHeaders: () => ({ sessionId: "session-api-test", apiRequestId: "api-test", plannerRequestId: "planner-test" }),
  traceExternalCall: (_options: unknown, call: () => Promise<unknown>) => call(),
}));

import handler from "./decision";

const input: PlannerInput = { recentSpeech: [{ id: "speech-span-0", text: "A useful proposition.", words: [] }] };
const decision: RuntimeDecision = { display: { kind: "TEXT" }, learner: { kind: "NONE" } };

function responseCapture() {
  let code = 0;
  let body: unknown;
  return {
    response: {
      setHeader: vi.fn(),
      status(statusCode: number) { code = statusCode; return { json(value: unknown) { body = value; } }; },
    },
    result: () => ({ code, body }),
  };
}

describe("live planner provider selection", () => {
  const originalDeepSeek = process.env.DEEPSEEK_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const originalOpenAIModel = process.env.OPENAI_MODEL;

  beforeEach(() => {
    mocks.deepSeek.mockReset();
    mocks.openAI.mockReset();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  afterEach(() => {
    if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalDeepSeek;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalOpenAIModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = originalOpenAIModel;
  });

  it("uses OpenAI rather than sending an OpenAI key to DeepSeek", async () => {
    process.env.OPENAI_API_KEY = "openai-key";
    mocks.openAI.mockResolvedValue({ decision });
    const captured = responseCapture();

    await handler({ method: "POST", body: input }, captured.response);

    expect(mocks.openAI).toHaveBeenCalledWith(input, "openai-key", "gpt-5.6-luna", { signal: undefined });
    expect(mocks.deepSeek).not.toHaveBeenCalled();
    expect(captured.result()).toEqual({ code: 200, body: { decision } });
  });

  it("prefers a dedicated DeepSeek key when both providers are configured", async () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-key";
    process.env.OPENAI_API_KEY = "openai-key";
    mocks.deepSeek.mockResolvedValue({ decision });
    const captured = responseCapture();

    await handler({ method: "POST", body: input }, captured.response);

    expect(mocks.deepSeek).toHaveBeenCalledWith(input, "deepseek-key", "deepseek-v4-flash", { signal: undefined });
    expect(mocks.openAI).not.toHaveBeenCalled();
  });
});
